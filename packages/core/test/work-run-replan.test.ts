/**
 * WorkRun 待处理尾部重规划（source-driven-import）测试。
 *
 * 覆盖：原子替换 pending 尾部、历史单元（done/in_progress/skipped/blocked）
 * 字段与笔记零修改、空尾部/完成队列拒绝、挂起队列重规划保持挂起。
 */
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { EventV2 } from "@opennovel-ai/core/event"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { SessionWorkRun } from "@opennovel-ai/core/session/work-run"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionWorkRun.node])),
)
const sessionID = SessionV2.ID.make("ses_workrun_replan_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "workrun-replan",
      directory: "/project",
      title: "workrun-replan",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const statusesOf = (run: { readonly items: ReadonlyArray<{ readonly status: string; readonly seq: number; readonly title: string; readonly note?: string }> }) =>
  run.items.map((item) => ({ seq: item.seq, title: item.title, status: item.status, note: item.note }))

describe("SessionWorkRun.replanPending", () => {
  it.effect("原子替换 pending 尾部，进行中与历史单元保持原序号", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "导入", items: ["校准第1章", "校准第2章", "校准第3章"] })
      const claimed = yield* workrun.claimNext(run.id)
      expect(claimed.items[0].status).toBe("in_progress")

      const replanned = yield* workrun.replanPending(claimed.id, ["第2章", "第3章", "第4章"])
      // 新尾部 seq 从保留单元最大序号之后单调递增（3,4,5），不复用被删 pending 的 1/2
      expect(statusesOf(replanned)).toEqual([
        { seq: 0, title: "校准第1章", status: "in_progress", note: undefined },
        { seq: 3, title: "第2章", status: "pending", note: undefined },
        { seq: 4, title: "第3章", status: "pending", note: undefined },
        { seq: 5, title: "第4章", status: "pending", note: undefined },
      ])

      yield* workrun.completeItem(replanned.id, 0)
      const afterComplete = yield* workrun.current(sessionID)
      expect(statusesOf(afterComplete ?? { items: [] })[0]).toMatchObject({ seq: 0, title: "校准第1章", status: "done" })
      expect(statusesOf(afterComplete ?? { items: [] }).map((i) => i.seq)).toEqual([0, 3, 4, 5])
    }),
  )

  it.effect("done/skipped/blocked 单元在重规划中字段与笔记零修改", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a", "b", "c", "d", "e"] })
      yield* workrun.claimNext(run.id)
      yield* workrun.completeItem(run.id, 0)
      const r2 = yield* workrun.claimNext(run.id)
      yield* workrun.skipItem(r2.id, 1)
      const r3 = yield* workrun.claimNext(r2.id)
      yield* workrun.blockItem(r3.id, 2, "受阻原因")

      const before = statusesOf((yield* workrun.current(sessionID)) ?? { items: [] })
      const replanned = yield* workrun.replanPending(run.id, ["x", "y"])
      const after = statusesOf(replanned)
      for (const b of before.slice(0, 3)) {
        const a = after.find((i) => i.seq === b.seq)!
        expect(a).toEqual(b)
      }
      expect(after.filter((i) => i.status === "pending").map((i) => i.title)).toEqual(["x", "y"])
      expect(after.find((i) => i.seq === 2)?.note).toBe("受阻原因")
    }),
  )

  it.effect("空尾部与已终结队列被拒绝", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a"] })

      const empty = yield* workrun.replanPending(run.id, []).pipe(Effect.flip)
      expect(empty._tag).toBe("SessionWorkRun.InvalidTransition")

      const claimed = yield* workrun.claimNext(run.id)
      yield* workrun.completeItem(claimed.id, 0)
      yield* workrun.complete(claimed.id)
      const afterComplete = yield* workrun.replanPending(claimed.id, ["x"]).pipe(Effect.flip)
      expect(afterComplete._tag).toBe("SessionWorkRun.InvalidTransition")
    }),
  )

  it.effect("挂起队列重规划后仍挂起且不唤醒", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a", "b"] })
      const claimed = yield* workrun.claimNext(run.id)
      yield* workrun.pause(sessionID)
      const paused = yield* workrun.replanPending(claimed.id, ["x", "y", "z"])
      expect(paused.status).toBe("paused")
      expect(statusesOf(paused).filter((i) => i.status === "pending").map((i) => i.title)).toEqual(["x", "y", "z"])
      expect(statusesOf(paused).find((i) => i.seq === 0)?.status).toBe("in_progress")
      // 恢复后正常推进
      yield* workrun.resume(sessionID)
      const resumed = yield* workrun.current(sessionID)
      expect(resumed?.status).toBe("active")
    }),
  )
})
