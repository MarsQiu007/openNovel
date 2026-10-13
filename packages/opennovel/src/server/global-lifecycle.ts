import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
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
      yield* emitGlobalDisposed
    }).pipe(Effect.uninterruptible)
  },
)

export * as GlobalLifecycle from "./global-lifecycle"
