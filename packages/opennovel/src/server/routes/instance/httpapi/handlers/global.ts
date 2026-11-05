import path from "path"
import { Config, globalConfigFile } from "@/config/config"
import { Auth } from "@/auth"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@opennovel-ai/core/event"
import { ConfigHealth } from "@opennovel-ai/core/config/health"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Global } from "@opennovel-ai/core/global"
import { ModelsDev } from "@opennovel-ai/core/models-dev"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opennovel-ai/core/installation/version"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"
import { InvalidRequestError } from "../errors"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function eventResponse() {
  return Effect.gen(function* () {
    yield* Effect.logInfo("global event connected")
    const events = Stream.callback<GlobalBusEvent>((queue) => {
      const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
    })
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
    )

    return HttpServerResponse.stream(
      Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.logInfo("global event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()
    const healthSvc = yield* ConfigHealth.Service
    const fs = yield* FSUtil.Service
    const modelsDev = yield* ModelsDev.Service

    // 体检只读：装载结果只来自 ConfigHealth 注册表（插件装载路径是唯一事实源），此处不做任何 import 复判。
    // 已知提供商目录取全局可达快照：models.dev 内置目录 + 全局配置里的自定义提供商 + 已存凭据的提供商
    //（Provider.Service.list 是实例级服务，全局路由无 InstanceRef，不能在这里调用）。
    const evaluateConfigHealth = Effect.fn("GlobalHttpApi.evaluateConfigHealth")(function* () {
      const info = yield* config.getGlobal()
      const [records, models, auths, agentLegacy, modeLegacy] = yield* Effect.all([
        healthSvc.records(),
        modelsDev.get(),
        auth.all().pipe(Effect.orElseSucceed(() => ({}) as Record<string, Auth.Info>)),
        fs
          .glob("{agent,agents}/**/*.md", { cwd: Global.Path.config, absolute: true, dot: true, symlink: true })
          .pipe(Effect.orElseSucceed(() => [] as string[])),
        fs
          .glob("{mode,modes}/*.md", { cwd: Global.Path.config, absolute: true, dot: true, symlink: true })
          .pipe(Effect.orElseSucceed(() => [] as string[])),
      ])
      const knownProviders = new Set([
        ...Object.keys(models),
        ...Object.keys(auths),
        ...Object.keys(info.provider ?? {}),
      ])
      const legacyFiles = [...agentLegacy, ...modeLegacy].map((file) =>
        path.relative(Global.Path.config, file).split(path.sep).join("/"),
      )
      return ConfigHealth.evaluate({ info, file: globalConfigFile(), records, knownProviders, legacyFiles })
    })

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return yield* eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const configHealth = Effect.fn("GlobalHttpApi.configHealth")(function* () {
      const findings = yield* evaluateConfigHealth()
      return findings.map((finding) => finding.issue)
    })

    const configHealthFix = Effect.fn("GlobalHttpApi.configHealthFix")(function* (ctx) {
      const findings = yield* evaluateConfigHealth()
      const targets = findings.filter(
        (finding) => finding.apply !== undefined && ctx.payload.ids.includes(finding.issue.id),
      )
      if (targets.length !== ctx.payload.ids.length) {
        return yield* Effect.fail(
          new InvalidRequestError({ message: "部分问题不存在或没有可用修复建议，请刷新配置健康状态后重试" }),
        )
      }
      const draft = structuredClone(yield* config.getGlobal())
      for (const finding of targets) finding.apply?.(draft)
      const result = yield* config.updateGlobal(draft)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      const remaining = yield* evaluateConfigHealth()
      return remaining.map((finding) => finding.issue)
    })

    const providerSet = Effect.fn("GlobalHttpApi.providerSet")(function* (ctx) {
      const result = yield* config.updateGlobalProvider(ctx.params.providerID, ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return true
    })

    const providerRemove = Effect.fn("GlobalHttpApi.providerRemove")(function* (ctx) {
      const result = yield* config.removeGlobalProvider(ctx.params.providerID)
      // Auth.remove 内部双清旧版凭据存储与 Integration 凭据库（同 control.ts authRemove 语义）
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return true
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("configHealth", configHealth)
      .handle("configHealthFix", configHealthFix)
      .handle("providerSet", providerSet)
      .handle("providerRemove", providerRemove)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
  }),
)
