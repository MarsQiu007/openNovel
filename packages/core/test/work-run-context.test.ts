import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { EventTable } from "@opennovel-ai/core/event/sql"
import { EventV2 } from "@opennovel-ai/core/event"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionContextEpoch } from "@opennovel-ai/core/session/context-epoch"
import { SessionTable, SessionMessageTable } from "@opennovel-ai/core/session/sql"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionWorkRun } from "@opennovel-ai/core/session/work-run"
import { WorkRunContext } from "@opennovel-ai/core/session/work-run-context"
import { SystemContext } from "@opennovel-ai/core/system-context"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionWorkRun.node, SessionProjector.node]), []),
)

const sessionID = SessionV2.ID.make("ses_workrun_ctx")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "workrun-ctx",
      directory: "/project",
      title: "workrun-ctx",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

// 模拟 runner loadSystemContext 的 WorkRun 条件项：active 队列组合本源，否则 empty
const loadContext = Effect.gen(function* () {
  const workrun = yield* SessionWorkRun.Service
  const run = yield* workrun.current(sessionID)
  return run !== undefined && run.status === "active" ? WorkRunContext.forRun(run) : SystemContext.empty
})

const contextUpdatedTexts = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select({ data: EventTable.data })
    .from(EventTable)
    .where(eq(EventTable.type, "session.next.context.updated.1"))
    .all()
    .pipe(Effect.orDie)
  return rows.map((row) => (row.data as { text: string }).text)
})

const systemMessageTexts = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select({ data: SessionMessageTable.data })
    .from(SessionMessageTable)
    .all()
    .pipe(Effect.orDie)
  return rows.map((row) => (row.data as { text?: string }).text ?? "")
})

describe("WorkRunContext 条件注入", () => {
  it.effect("队列创建当回合注入约束，状态迁移当回合更新，挂起终结当回合解除", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const workrun = yield* SessionWorkRun.Service
      const turn = Effect.gen(function* () {
        const context = yield* loadContext
        return yield* SessionContextEpoch.prepare(db, events, Effect.succeed(context), sessionID)
      })

      // 回合 1：无队列——注入零开销，无 context 更新事件
      yield* turn
      expect(yield* contextUpdatedTexts).toEqual([])

      // 回合 2：创建队列当回合——baseline 两条约束渲染为更新注入
      yield* workrun.create({ sessionID, goal: "逐章审查全书", items: ["第 1 章", "第 2 章"] })
      yield* turn
      const injected = yield* contextUpdatedTexts
      expect(injected).toHaveLength(1)
      expect(injected[0]).toContain("【工作队列进行中】目标：逐章审查全书")
      expect(injected[0]).toContain("禁止以纯文本结束回合")
      expect(injected[0]).toContain("workrun progress")
      expect(injected[0]).toContain("pending / pending")
      // 经 SessionProjector 落库为 system 消息进入历史近端
      const messages = yield* systemMessageTexts
      expect(messages.filter((text) => text.includes("禁止以纯文本结束回合"))).toHaveLength(1)

      // 回合 3：领取单元并写进度当回合——update 渲染最新状态与进度笔记
      const run = (yield* workrun.current(sessionID))!
      yield* workrun.claimNext(run.id)
      yield* workrun.recordProgress(run.id, "第 1 章审查完成一半")
      yield* turn
      const updated = yield* contextUpdatedTexts
      expect(updated).toHaveLength(2)
      expect(updated[1]).toContain("【工作队列进度已更新】")
      expect(updated[1]).toContain("in_progress / pending")
      expect(updated[1]).toContain("第 1 章审查完成一半")

      // 回合 4：挂起同步 epoch 失效——下回合 initialize 重新生成 baseline，无事件、约束消失
      yield* workrun.pause(sessionID)
      const pausedTurn = yield* turn
      expect(pausedTurn.baseline).not.toContain("禁止以纯文本结束回合")
      expect(yield* contextUpdatedTexts).toHaveLength(2)

      // 回合 5：仍挂起——baseline 持续干净，不污染后续普通对话
      const stillPausedTurn = yield* turn
      expect(stillPausedTurn.baseline).not.toContain("禁止以纯文本结束回合")
      expect(yield* contextUpdatedTexts).toHaveLength(2)

      // 回合 6：恢复同步 epoch 失效——下回合 baseline 重新注入两条约束，无事件
      yield* workrun.resume(sessionID)
      const resumedTurn = yield* turn
      expect(resumedTurn.baseline).toContain("【工作队列进行中】目标：逐章审查全书")
      expect(resumedTurn.baseline).toContain("禁止以纯文本结束回合")
      expect(yield* contextUpdatedTexts).toHaveLength(2)

      // 回合 7：全部单元终结——终结同步 epoch 失效，下回合 baseline 约束消失
      const active = (yield* workrun.current(sessionID))!
      yield* workrun.completeItem(active.id, 0)
      yield* workrun.claimNext(active.id)
      yield* workrun.completeItem(active.id, 1)
      yield* workrun.complete(active.id)
      const finishedTurn = yield* turn
      expect(finishedTurn.baseline).not.toContain("禁止以纯文本结束回合")
      expect(yield* contextUpdatedTexts).toHaveLength(2)
      yield* turn
      expect(yield* contextUpdatedTexts).toHaveLength(2)
      // 增量路径只有创建与进度更新两种：解除走 baseline 重生成，不发事件
      const finalMessages = yield* systemMessageTexts
      expect(finalMessages.filter((text) => text.includes("【工作队列已停止】"))).toHaveLength(0)
    }),
  )
})
