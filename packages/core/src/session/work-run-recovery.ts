export * as SessionWorkRunRecovery from "./work-run-recovery"

import { and, eq, inArray } from "drizzle-orm"
import { Cause, Context, Effect, Layer } from "effect"
import type { Run } from "@opennovel-ai/schema/session-work-run"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionContextEpoch } from "./context-epoch"
import { SessionExecution } from "./execution"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { WorkRunItemTable, WorkRunTable } from "./sql"
import { publishUpdate, SessionWorkRun, WORK_RUN_RECOVERY_PROMPT } from "./work-run"

export interface Interface {
  readonly resumeWorkRun: (sessionID: SessionSchema.ID) => Effect.Effect<Run, SessionWorkRun.NoActiveRun>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionWorkRunRecovery") {}

/**
 * 启动对账（design D9）：location 层构建时扫描本库遗留的 active 工作队列——排除本进程
 * 仍在执行（持有活动 drain）的会话后，把遗留运行簿翻为挂起并把被杀的进行中单元回退
 * 待处理；已完成/跳过/受阻单元不受影响，已挂起运行簿的进行中单元也不回退（同进程
 * 暂停语义是「先结算进行中单元」）。对账只收敛状态：不投递指令、不唤醒会话，恢复一律
 * 是用户显式动作。集合式 UPDATE 幂等，且 pause() 本身不清计数，翻挂起须显式重置守卫计数。
 */
export const reconcile = Effect.fn("SessionWorkRunRecovery.reconcile")(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const execution = yield* SessionExecution.Service
  const active = yield* execution.active
  const stale = yield* db
    .select()
    .from(WorkRunTable)
    .where(eq(WorkRunTable.status, "active"))
    .all()
    .pipe(Effect.orDie)
  const targets = stale.filter((row) => !active.has(SessionSchema.ID.make(row.session_id)))
  if (targets.length === 0) return
  const ids = targets.map((row) => row.id)
  // time_updated 由 drizzle $onUpdate 自动刷新，无需显式携带
  yield* db
    .update(WorkRunTable)
    .set({ status: "paused", continuation_count: 0, no_progress_count: 0 })
    .where(inArray(WorkRunTable.id, ids))
    .run()
    .pipe(Effect.orDie)
  yield* db
    .update(WorkRunItemTable)
    .set({ status: "pending" })
    .where(and(inArray(WorkRunItemTable.run_id, ids), eq(WorkRunItemTable.status, "in_progress")))
    .run()
    .pipe(Effect.orDie)
  yield* Effect.forEach(
    targets,
    (row) =>
      Effect.gen(function* () {
        yield* SessionContextEpoch.reset(db, row.session_id)
        yield* publishUpdate(db, events, row.id)
      }),
    { discard: true },
  )
})

/**
 * 用户显式恢复编排（design D6）：翻回 active（计数与上下文 epoch 重置）→ steer 投递恢复
 * 指令（合成来源、指示按注入的队列状态与进度笔记续跑）→ 唤醒执行，恢复后无需用户再发
 * 消息。admit/wake 失败时补偿翻回挂起再上报，避免「已 active 无指令」的半提交状态。
 * 以 location 服务形态导出：编排依赖的 Database/EventV2/SessionExecution 是全局节点，
 * 在单元层内部接线，handler 层只暴露本服务（决策 8 先例：compaction-recovery）。
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workrun = yield* SessionWorkRun.Service
    const execution = yield* SessionExecution.Service
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const resumeWorkRun = Effect.fn("SessionWorkRunRecovery.resumeWorkRun")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const run = yield* workrun.resume(sessionID)
      const instructAndWake = Effect.gen(function* () {
        yield* SessionInput.admit(db, events, {
          id: SessionMessage.ID.create(),
          sessionID,
          prompt: Prompt.fromUserMessage({ text: WORK_RUN_RECOVERY_PROMPT }),
          delivery: "steer",
        }).pipe(Effect.asVoid)
        yield* execution.wake(sessionID)
      }).pipe(Effect.as(run))
      // 补偿回滚：指令未送达（含 admit/wake 缺陷与中断）就翻回挂起再原样上报，
      // 避免「已 active 无指令」的半提交状态——面板与守卫都不会把队列当成活动队列
      return yield* instructAndWake.pipe(
        Effect.catchCause((cause: Cause.Cause<never>) =>
          Effect.gen(function* () {
            yield* db
              .update(WorkRunTable)
              .set({ status: "paused" })
              .where(eq(WorkRunTable.id, run.id))
              .run()
              .pipe(Effect.orDie)
            yield* publishUpdate(db, events, run.id)
            return yield* Effect.failCause(cause)
          }),
        ),
      )
    })
    return Service.of({ resumeWorkRun })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, SessionExecution.node, SessionWorkRun.node],
})

export const reconcileNode = makeLocationNode({
  name: "workrun-reconcile",
  layer: Layer.effectDiscard(reconcile()),
  deps: [Database.node, EventV2.node, SessionExecution.node],
})
