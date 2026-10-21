export * as SessionRestart from "./restart"

import { Context, Effect, Layer, Scope } from "effect"
import { BackgroundJob } from "../../background-job"
import { makeGlobalNode } from "../../effect/app-node"
import { KV } from "../../kv"
import { SessionV2 } from "../../session"
import { SessionExecution } from "../execution"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SubagentCompletion } from "../subagent-completion"

const RESUME_EXHAUSTED = "Execution was interrupted repeatedly and will not be resumed automatically."

const DEFAULT_MAX_ATTEMPTS = 10

export interface Options {
  /** 单个作业允许的自动恢复次数上限，超过即终态化，防止反复死亡的作业跨重启 crash-loop。 */
  readonly maxAttempts?: number
}

export interface Interface {
  /**
   * 扫描 KV 中未清账的后台作业并恢复 subagent：child/parent 缺失或 parentID
   * 不匹配的记录直接清账；已完结的重放通知；running 记录预算检查后重启作业并
   * 等待完成通知。inert until called——由启动组合处显式调用一次。
   */
  readonly recover: Effect.Effect<void>
}

/**
 * 针对孤儿后台作业的恢复扫描。作业在转后台/完成时写入 KV（`BackgroundJob`），
 * 扫描无需上一进程配合：崩溃、SIGKILL、优雅重启留下的持久签名一致。恢复是
 * at-least-once：本进程内 coordination 防并发 drain，不防崩溃后的重复外部副作用。
 */
export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionRestart") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const execution = yield* SessionExecution.Service
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* SessionV2.Service
      const kv = yield* KV.Service
      const scope = yield* Scope.Scope
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

      const recoverSubagent = Effect.fn("SessionRestart.recoverSubagent")(function* (
        background: BackgroundJob.Background,
        recovery: Extract<BackgroundJob.Recovery, { kind: "subagent" }>,
      ) {
        const child = yield* store.get(recovery.childSessionID)
        if (!child || child.parentID !== recovery.parentSessionID || !(yield* store.get(recovery.parentSessionID))) {
          yield* jobs.completeBackground(background.notificationID)
          return
        }

        // fork 适配：恢复通知一律 resume:false，父会话的续跑由用户/模型决定（design §5）
        const notify = Effect.fnUntraced(function* (
          result: Pick<BackgroundJob.Background, "status" | "output" | "error">,
        ) {
          yield* SubagentCompletion.deliver(sessions, jobs, {
            ...result,
            recovery,
            notificationID: background.notificationID,
            resume: false,
          }).pipe(Effect.orDie)
        })

        if (background.status !== "running") {
          yield* notify(background)
          return
        }
        if ((yield* execution.active).has(recovery.childSessionID)) return

        // 先持久化预算再 resume：crash 落在 resume 内也会被下次 sweep 计数
        const attempts = (background.attempts ?? 0) + 1
        if (attempts > maxAttempts) {
          yield* kv.set(BackgroundJob.backgroundKey(background.notificationID), {
            ...background,
            status: "error" as const,
            error: RESUME_EXHAUSTED,
            attempts,
          })
          yield* notify({ status: "error", error: RESUME_EXHAUSTED })
          return
        }
        yield* kv.set(BackgroundJob.backgroundKey(background.notificationID), { ...background, attempts })

        yield* jobs.start({
          id: background.id,
          type: "subagent",
          title: recovery.description,
          notificationID: background.notificationID,
          recovery,
          attempts,
          run: execution.resume(recovery.childSessionID).pipe(
            Effect.andThen(store.context(recovery.childSessionID)),
            Effect.map((messages) => {
              const assistant = messages.findLast(
                (message): message is SessionMessage.Assistant =>
                  message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
              )
              return SubagentCompletion.text(assistant)
            }),
          ),
        })
        yield* jobs.background(background.id)
        yield* jobs.wait({ id: background.id }).pipe(
          Effect.flatMap((result) => (result.info ? notify(result.info) : Effect.void)),
          // 观察者必须立即启动，否则要等 scope 关闭才运行，完成通知永远迟到
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      return Service.of({
        recover: Effect.gen(function* () {
          const pending = yield* jobs.pendingBackground
          yield* Effect.forEach(
            pending,
            Effect.fnUntraced(function* (background) {
              // shell 恢复不进本期（对齐 bash durable status 的顺序声明），记录保持 pending
              if (background.recovery.kind !== "subagent") return
              // 活跃作业已在运行（重复 sweep / 已重新注册）→ 跳过
              if ((yield* jobs.get(background.id))?.status === "running") return
              yield* recoverSubagent(background, background.recovery)
            }),
            { discard: true },
          )
        }),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node, BackgroundJob.node, SessionV2.node, KV.node],
})
