import { onCleanup } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { useServerSDK } from "./server-sdk"
import { useNovel } from "./novel"
import type { Event } from "@opennovel-ai/sdk/v2/client"

// Query keys matching novel-queries.ts pattern
const novelKeys = {
  detail: (directory: string, novelID: string) => ["novel", "detail", directory, novelID] as const,
  chapters: (directory: string, novelID: string) => ["novel", "chapters", directory, novelID] as const,
  outline: (directory: string, novelID: string) => ["novel", "outline", directory, novelID] as const,
  tension: (directory: string, novelID: string) => ["novel", "tension", directory, novelID] as const,
}

/**
 * Subscribes to directory SSE events and invalidates novel query keys.
 *
 * - `session.status` for a session bound to this novel → immediate broad invalidation
 * - `message.part.updated` for a bound session → 5s debounce then broad invalidate
 * - Active (busy/retry) bound sessions → 15s polling broad invalidation
 * - 单章正文/版本/批注不在实时失效范围内，挂载时自行刷新
 */
export function useNovelLiveInvalidation(directory: string, novelID: string) {
  const serverSDK = useServerSDK()
  const sdk = serverSDK()
  const queryClient = useQueryClient()
  const novel = useNovel()

  // ---- helpers ----

  // 失效本小说下的查询。AI 在写作过程中可能改动角色、世界观、伏笔、
  // 结构线/弧光、关系等任意实体，只失效少量 key 会导致这些面板停留在旧数据。
  // 用 predicate 覆盖所有 ["novel", *, directory, novelID, ...] 形态的 key；
  // 但排除单章正文/版本/批注这类 per-chapter 查询——它们会在对应面板挂载时
  // 凭借 refetchOnMount 拉取最新数据，实时失效可能覆盖编辑器里未保存的改动。
  const EXCLUDED_LIVE = new Set(["chapter", "chapter-versions", "chapter-reviews", "annotations"])
  const invalidateNovel = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey
        return (
          Array.isArray(key) &&
          key[0] === "novel" &&
          !EXCLUDED_LIVE.has(String(key[1])) &&
          key.includes(directory) &&
          key.includes(novelID)
        )
      },
    })
  }

  // ---- bound session tracking ----
  // 之前依赖 getQueryData(for-session) 判断会话归属，但该 hook 从未被组件调用，
  // 导致所有 session.status 事件被跳过、UI 不刷新。改为主动拉取 bindings。

  const boundSessionIds = new Set<string>()

  async function refreshBindings() {
    const bindings = await novel.listSessionBindings()
    boundSessionIds.clear()
    if (bindings) {
      for (const b of bindings) {
        if (b.novelID === novelID) boundSessionIds.add(b.sessionID)
      }
    }
  }

  void refreshBindings()

  // ---- message.part.updated: 5s debounce ----

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleDebouncedInvalidate = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      invalidateNovel()
    }, 5000)
  }

  // ---- active session polling: 15s refetchInterval ----

  const busySessions = new Set<string>()
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let bindingsTimer: ReturnType<typeof setInterval> | undefined

  const startPolling = () => {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      invalidateNovel()
    }, 15000)
  }

  const stopPolling = () => {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  // Periodically refresh bindings so newly created sessions are picked up
  bindingsTimer = setInterval(() => {
    void refreshBindings()
  }, 10000)

  // ---- SSE subscription ----

  const unsub = sdk.event.on(directory, (event: Event) => {
    if (event.type === "session.status") {
      const { sessionID, status } = event.properties
      // Refresh bindings if we don't know this session yet (may be newly bound)
      if (!boundSessionIds.has(sessionID)) {
        void refreshBindings().then(() => {
          if (boundSessionIds.has(sessionID)) {
            invalidateNovel()
            trackBusy(sessionID, status.type)
          }
        })
        return
      }

      invalidateNovel()
      trackBusy(sessionID, status.type)
      return
    }

    if (event.type === "message.part.updated") {
      const { sessionID } = event.properties
      if (sessionID && boundSessionIds.has(sessionID)) {
        scheduleDebouncedInvalidate()
      }
    }
  })

  function trackBusy(sessionID: string, statusType: string) {
    if (statusType === "busy" || statusType === "retry") {
      busySessions.add(sessionID)
      startPolling()
    } else {
      busySessions.delete(sessionID)
      if (busySessions.size === 0) stopPolling()
    }
  }

  onCleanup(() => {
    unsub()
    if (debounceTimer) clearTimeout(debounceTimer)
    if (bindingsTimer) clearInterval(bindingsTimer)
    stopPolling()
  })
}
