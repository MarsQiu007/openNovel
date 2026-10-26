import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import { invalidateAllKnownLocations } from "@opennovel-ai/server/location"
import { Effect, Exit } from "effect"
import { Event } from "./event"

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (options?: { swallowErrors?: boolean }) {
    const store = yield* InstanceStore.Service
    yield* Effect.gen(function* () {
      // disposed 表示"实例已全部释放"，下游会据此行动（刷新或退出进程），
      // 因此释放失败时只能记日志，不能广播一个不成立的事件。
      const exit = yield* store.disposeAll().pipe(Effect.exit)
      if (Exit.isFailure(exit)) {
        if (!options?.swallowErrors) return yield* Effect.failCause(exit.cause)
        yield* Effect.logWarning("global disposal failed", { cause: exit.cause })
        return
      }
      // instance 全部释放后，连带失效 location 层缓存：core Config 在 location 层
      // 构建时一次性快照 configs，若只清 instance 不清 location 层，下一次
      // LocationServiceMap.get(ref) 仍复用 60 分钟内的旧快照，全局配置变更对
      // agent.list 等查询不可见，必须等 idleTimeToLive 到期或重启 server 才生效。
      // 单 ref 失效失败仅记日志（在 invalidateAllKnownLocations 内），不阻断
      // 整体流程与 disposed 事件广播。
      yield* invalidateAllKnownLocations()
      yield* emitGlobalDisposed
    }).pipe(Effect.uninterruptible)
  },
)

export * as GlobalLifecycle from "./global-lifecycle"
