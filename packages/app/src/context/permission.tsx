import { createEffect, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opennovel-ai/ui/context"
import { Persist, removePersisted } from "@/utils/persist"
import type { ServerSDK } from "@/context/server-sdk"
import type { ServerSync } from "./server-sync"
import { useParams } from "@solidjs/router"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { useSettings } from "./settings"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"
import { usePlatform } from "@/context/platform"
import type { Platform } from "@/context/platform"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const global = useGlobal()
    const server = useServer()
    const settings = useSettings()
    const platform = usePlatform()
    const owner = getOwner()
    const states = new Map<ServerScope, { key: ServerConnection.Key; dispose: () => void; state: PermissionState }>()

    const activeServer = createMemo(() => {
      if (params.serverKey && settings.general.newLayoutDesigns()) return requireServerKey(params.serverKey)
      return server.key
    })

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Permission server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing && global.servers.list().some((item) => ServerConnection.key(item) === existing.key)) {
        return existing.state
      }
      if (existing) {
        existing.dispose()
        states.delete(ctx.sdk.scope)
      }
      const root = createRoot(
        (dispose) => ({
          key,
          dispose,
          state: createServerPermissionState({ sdk: ctx.sdk, sync: ctx.sync, platform: platform }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const list = global.servers.list()
      const keys = new Set(list.map(ServerConnection.key))
      states.forEach((value, scope) => {
        if (keys.has(value.key)) return
        value.dispose()
        states.delete(scope)
        const replacement = list.find((conn) => server.scope(ServerConnection.key(conn)) === scope)
        if (replacement) ensure(ServerConnection.key(replacement))
      })
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    let lastSelected: PermissionState | undefined
    const selected = () => {
      const key = activeServer()
      if (global.servers.list().some((conn) => ServerConnection.key(conn) === key)) {
        lastSelected = ensure(key)
      }
      if (lastSelected) return lastSelected
      return ensure(server.key)
    }

    return {
      ready: () => selected().ready(),
      ensureServerState: (key: ServerConnection.Key) => ensure(key).api,
      currentServerState: () => selected().api,
      respond(input: Parameters<PermissionRespondFn>[0]) {
        selected().respond(input)
      },
      judgeSuggestion(sessionID: string, callID: string) {
        return selected().judgeSuggestion(sessionID, callID)
      },
    }
  },
})

type PermissionState = ReturnType<typeof createServerPermissionState>
type PermissionEvent = Parameters<Parameters<ServerSDK["event"]["listen"]>[0]>[0]

function createServerPermissionState(input: { sdk: ServerSDK; sync: ServerSync; platform: Platform }) {
  // 旧 auto-accept 机制的本地持久化数据（permission / permission.v3 键）随机制删除一并清除
  removePersisted(Persist.serverGlobal(input.sdk.scope, "permission", ["permission.v3"]), input.platform)

  // 裁判标注（shadow 建议）：按会话内存保留，不进持久化存储；key 为 `${sessionID}:${callID}`
  const [judged, setJudged] = createStore<
    Record<string, { mode: "judge-shadow" | "judge"; effect: "allow" | "deny"; reason?: string }>
  >({})

  function recordJudged(properties: {
    sessionID: string
    decision: "allow" | "deny" | "ask"
    mode: "judge-shadow" | "judge"
    reason?: string
    source?: { type: "tool"; messageID: string; callID: string }
  }) {
    if (meta.disposed || !properties.source || properties.decision === "ask") return
    setJudged({
      [`${properties.sessionID}:${properties.source.callID}`]: {
        mode: properties.mode,
        effect: properties.decision,
        reason: properties.reason,
      },
    })
  }

  const meta = { disposed: false }

  const handlePermission = (e: PermissionEvent) => {
    const event = e.details
    if (event?.type !== "permission.v2.judged") return
    recordJudged(event.properties)
  }

  const unsubscribe = input.sdk.event.listen(handlePermission)
  onCleanup(() => {
    meta.disposed = true
    unsubscribe()
  })

  const respond: PermissionRespondFn = (request) => {
    if (meta.disposed) return
    input.sdk.client.v2.session.permission
      .reply({ sessionID: request.sessionID, requestID: request.permissionID, reply: request.response })
      .catch(() => {})
  }

  const api = {
    ready: () => !meta.disposed,
    respond,
    judgeSuggestion(sessionID: string, callID: string) {
      const annotation = judged[`${sessionID}:${callID}`]
      if (!annotation || annotation.mode !== "judge-shadow") return undefined
      return { ...annotation, reason: annotation.reason }
    },
  }

  return {
    ...api,
    api,
    sync: input.sync,
  }
}
