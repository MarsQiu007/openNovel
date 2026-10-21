export * as SubagentJob from "./subagent-job"

import { Context, Effect, Layer, Scope } from "effect"
import { BackgroundJob } from "../background-job"
import { makeGlobalNode } from "../effect/app-node"
import { SessionV2 } from "../session"
import { SessionMessage } from "./message"
import { SubagentCompletion } from "./subagent-completion"

type Recovery = Extract<BackgroundJob.Recovery, { kind: "subagent" }>

export interface Interface {
  start: (recovery: Recovery) => Effect.Effect<BackgroundJob.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SubagentJob") {}

const make: Effect.Effect<Interface, never, SessionV2.Service | BackgroundJob.Service | Scope.Scope> = Effect.gen(
  function* () {
    const sessions = yield* SessionV2.Service
    const jobs = yield* BackgroundJob.Service
    const scope = yield* Scope.Scope
    // 作业与其完成观察者都要活得比发起方（工具调用方的 Scope）更久；同时捕获
    // 发起时的 context，避免保留调用方的位置范围
    const context = yield* Effect.context()
    // 每个作业代际一个观察者，含同一 child 的续聊延伸
    const notifications = new Set<string>()

    const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
      const key = `${recovery.childSessionID}:${startedAt}`
      if (notifications.has(key)) return
      notifications.add(key)
      yield* Effect.gen(function* () {
        const result = yield* jobs.wait({ id: recovery.childSessionID })
        if (result.info) yield* SubagentCompletion.deliver(sessions, jobs, { ...result.info, recovery })
      }).pipe(
        Effect.ensuring(Effect.sync(() => notifications.delete(key))),
        Effect.forkIn(scope, { startImmediately: true }),
        Effect.provideContext(context),
      )
    })

    return Service.of({
      start: (recovery: Recovery) =>
        jobs
          .start({
            id: recovery.childSessionID,
            type: "subagent",
            title: recovery.description,
            metadata: {},
            recovery,
            run: Effect.gen(function* () {
              yield* sessions.resume(recovery.childSessionID)
              const messages = yield* sessions.messages({
                sessionID: recovery.childSessionID,
                order: "desc",
                limit: 20,
              })
              const assistant = messages.find(
                (message): message is SessionMessage.Assistant =>
                  message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
              )
              return SubagentCompletion.text(assistant)
            }),
          })
          .pipe(Effect.provideContext(context)),
      background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
        const info = yield* jobs.background(recovery.childSessionID)
        if (info) yield* notify(recovery, info.started_at)
      }),
      notify,
    })
  },
)

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionV2.node, BackgroundJob.node],
})
