import { Cause, DateTime, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { EventV2 } from "../../event"
import { SessionEvent } from "../event"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) => {
            // 用户中断不算失败（coordinator.wait 本就不传播 drain 错误）；其余失败
            // 必须发布会话级终态事件，让 CLI/桌面端把假成功变成显式失败。
            if (Cause.hasInterruptsOnly(cause)) return Effect.void
            return Effect.gen(function* () {
              yield* Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID }))
              const failure = Cause.squash(cause)
              yield* events
                .publish(SessionEvent.Failed, {
                  sessionID,
                  timestamp: yield* DateTime.now,
                  error: {
                    type: "unknown",
                    message: failure instanceof Error ? failure.message : String(failure),
                  },
                })
                .pipe(
                  // 事件写库失败不掩盖原始 drain 错误；logError 已留痕
                  Effect.ignore,
                )
            })
          }),
        )
      }),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
      wait: coordinator.wait,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, EventV2.node],
})

export * as SessionExecutionLocal from "./local"
