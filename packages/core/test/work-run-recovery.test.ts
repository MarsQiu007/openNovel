import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { EventTable } from "@opennovel-ai/core/event/sql"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionEvent } from "@opennovel-ai/core/session/event"
import { SessionInputTable, SessionTable, WorkRunItemTable } from "@opennovel-ai/core/session/sql"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionWorkRun } from "@opennovel-ai/core/session/work-run"
import { SessionWorkRunRecovery } from "@opennovel-ai/core/session/work-run-recovery"
import { testEffect } from "./lib/effect"

// 对账/恢复编排只读活跃集合并按需唤醒：可变 mock 模拟「本进程是否持有该会话 drain」
// 与 wake 成败，覆盖「在跑会话被跳过」与「恢复失败补偿回滚」两条路径
let activeSessions = new Set<SessionV2.ID>()
let wakeCalls: SessionV2.ID[] = []
let wakeImpl: (sessionID: SessionV2.ID) => Effect.Effect<void> = () => Effect.void

const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: (sessionID) => wakeImpl(sessionID),
    wait: () => Effect.void,
  }),
)

// SessionExecution 是恢复服务/对账节点的依赖（经 replacement 注入节点实现），测试体内
// 直接 yield* reconcile() 需要外层再提供一份；resumeWorkRun 经 location 服务暴露
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionWorkRun.node,
      SessionWorkRunRecovery.node,
      SessionWorkRunRecovery.reconcileNode,
    ]),
    [[SessionExecution.node, execution]],
  ).pipe(Layer.provideMerge(execution)),
)
const sessionID = SessionV2.ID.make("ses_workrun_recovery")
const drainedSessionID = SessionV2.ID.make("ses_workrun_recovery_drained")

const setup = Effect.gen(function* () {
  activeSessions = new Set<SessionV2.ID>()
  wakeCalls = []
  wakeImpl = (sessionID) =>
    Effect.sync(() => {
      wakeCalls.push(sessionID)
    })
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: sessionID,
        project_id: Project.ID.global,
        slug: "workrun-recovery",
        directory: "/project",
        title: "workrun-recovery",
        version: "test",
      },
      {
        id: drainedSessionID,
        project_id: Project.ID.global,
        slug: "workrun-recovery-drained",
        directory: "/project",
        title: "workrun-recovery-drained",
        version: "test",
      },
    ])
    .run()
    .pipe(Effect.orDie)
})

// workrun.updated 非持久化（仅事件总线广播），计数走监听；PromptAdmitted 为持久化
// 事件，入站送达断言走 EventTable 落库行
const listenUpdated = Effect.gen(function* () {
  const published: Array<unknown> = []
  const events = yield* EventV2.Service
  const unsubscribe = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === "workrun.updated") published.push(event.data)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return published
})

const admittedRows = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)),
      ),
    )
    .all()
    .pipe(Effect.orDie)
})

// 模拟强退现场：活动队列 + 被杀的进行中单元 + 已消耗的守卫计数
const seedInterruptedRun = Effect.gen(function* () {
  const workrun = yield* SessionWorkRun.Service
  const run = yield* workrun.create({ sessionID, goal: "逐章审查", items: ["第 1 章", "第 2 章"] })
  const claimed = yield* workrun.claimNext(run.id)
  yield* workrun.recordProgress(run.id, "第 1 章审查中")
  yield* workrun.guardDecide(sessionID, { continuationLimit: 100, noProgressLimit: 3 })
  return { run, claimed }
})

describe("SessionWorkRunRecovery.reconcile", () => {
  it.effect("遗留活动运行簿翻挂起、被杀单元回退待处理、计数重置并发布变更", () =>
    Effect.gen(function* () {
      yield* setup
      const published = yield* listenUpdated
      yield* seedInterruptedRun

      yield* SessionWorkRunRecovery.reconcile()

      const workrun = yield* SessionWorkRun.Service
      const reloaded = yield* workrun.current(sessionID)
      expect(reloaded?.status).toBe("paused")
      expect(reloaded?.items.map((item) => item.status)).toEqual(["pending", "pending"])
      expect(reloaded?.progressNote).toBe("第 1 章审查中")
      expect(reloaded?.continuationCount).toBe(0)
      expect(reloaded?.noProgressCount).toBe(0)
      // 变更事件已广播：面板刷新为挂起快照（此前 create/claim/progress/guard 各发一次）
      expect(published).toHaveLength(5)
      const last = published[4] as { readonly run: { readonly status: string } }
      expect(last.run.status).toBe("paused")
      // 对账只收敛状态：不投递指令、不唤醒会话
      expect((yield* admittedRows).length).toBe(0)
      expect(wakeCalls).toEqual([])

      // 重复对账幂等：已收敛状态不被二次改动、不重复发布
      yield* SessionWorkRunRecovery.reconcile()
      const again = yield* workrun.current(sessionID)
      expect(again?.status).toBe("paused")
      expect(again?.items.map((item) => item.status)).toEqual(["pending", "pending"])
      expect(published).toHaveLength(5)
    }),
  )

  it.effect("本进程持有活动 drain 的会话被对账跳过", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a"] })
      yield* workrun.claimNext(run.id)
      activeSessions = new Set([sessionID])

      yield* SessionWorkRunRecovery.reconcile()

      const untouched = yield* workrun.current(sessionID)
      expect(untouched?.status).toBe("active")
      expect(untouched?.items.map((item) => item.status)).toEqual(["in_progress"])
      expect(run.status).toBe("active")
    }),
  )

  it.effect("已挂起运行簿的进行中单元不被对账回退", () =>
    Effect.gen(function* () {
      yield* setup
      const published = yield* listenUpdated
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a"] })
      yield* workrun.claimNext(run.id)
      yield* workrun.pause(sessionID)

      yield* SessionWorkRunRecovery.reconcile()

      // 同进程暂停语义是「先结算进行中单元」：挂起运行簿的进行中单元保留
      const { db } = yield* Database.Service
      const rows = yield* db
        .select()
        .from(WorkRunItemTable)
        .where(eq(WorkRunItemTable.run_id, run.id))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.status)).toEqual(["in_progress"])
      // paused 不在对账扫描范围，无新增变更事件（此前 create/claim/pause 各发一次）
      expect(published).toHaveLength(3)
    }),
  )

  it.effect("对账只扫描本库运行簿，跨会话互不干扰", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      yield* workrun.create({ sessionID, goal: "g", items: ["a"] })
      const drained = yield* workrun.create({ sessionID: drainedSessionID, goal: "g", items: ["b"] })
      yield* workrun.claimNext(drained.id)
      activeSessions = new Set([drainedSessionID])

      yield* SessionWorkRunRecovery.reconcile()

      expect((yield* workrun.current(sessionID))?.status).toBe("paused")
      const kept = yield* workrun.current(drainedSessionID)
      expect(kept?.status).toBe("active")
      expect(kept?.items.map((item) => item.status)).toEqual(["in_progress"])
    }),
  )
})

describe("SessionWorkRunRecovery.resumeWorkRun", () => {
  it.effect("恢复编排：翻回活动并投递 steer 恢复指令、落库入站记录、唤醒执行", () =>
    Effect.gen(function* () {
      yield* setup
      const published = yield* listenUpdated
      yield* seedInterruptedRun
      yield* SessionWorkRunRecovery.reconcile()

      const recovery = yield* SessionWorkRunRecovery.Service
      const run = yield* recovery.resumeWorkRun(sessionID)

      expect(run.status).toBe("active")
      expect(run.continuationCount).toBe(0)
      expect(run.items.map((item) => item.status)).toEqual(["pending", "pending"])
      // steer 恢复指令入站：事件落库 + durable 入站行，指令文本与合成来源可辨
      const admitted = yield* admittedRows
      expect(admitted).toHaveLength(1)
      const payload = admitted[0].data as { readonly delivery: string; readonly prompt: unknown }
      expect(payload.delivery).toBe("steer")
      expect(JSON.stringify(payload.prompt)).toContain("工作队列恢复")
      const { db } = yield* Database.Service
      const inbox = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(inbox).toHaveLength(1)
      // 恢复动作唤醒会话执行：恢复后无需用户再发消息
      expect(wakeCalls).toEqual([sessionID])
      // 恢复翻状态并发布：reconcile 发布 1 次 + resume 自身发布 1 次
      expect(published).toHaveLength(6)
    }),
  )

  it.effect("无挂起运行簿时报 NoActiveRun，不投递不唤醒", () =>
    Effect.gen(function* () {
      yield* setup

      const recovery = yield* SessionWorkRunRecovery.Service
      const failed = yield* recovery.resumeWorkRun(sessionID).pipe(Effect.flip)

      expect(failed._tag).toBe("SessionWorkRun.NoActiveRun")
      expect((yield* admittedRows).length).toBe(0)
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("恢复指令送达失败时补偿翻回挂起再上报", () =>
    Effect.gen(function* () {
      yield* setup
      const published = yield* listenUpdated
      yield* seedInterruptedRun
      yield* SessionWorkRunRecovery.reconcile()
      wakeImpl = () => Effect.die(new Error("wake transport down"))

      const recovery = yield* SessionWorkRunRecovery.Service
      const exit = yield* recovery.resumeWorkRun(sessionID).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")

      // 半提交被收敛：队列回到挂起，面板快照同步刷新
      // （reconcile 1 次 + resume 翻状态 1 次 + 补偿回滚 1 次）
      const workrun = yield* SessionWorkRun.Service
      const reloaded = yield* workrun.current(sessionID)
      expect(reloaded?.status).toBe("paused")
      expect(published).toHaveLength(7)
    }),
  )
})
