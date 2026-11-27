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
const sessionID = SessionV2.ID.make("ses_workrun_test")
const LIMITS = { continuationLimit: 100, noProgressLimit: 3 }

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
      slug: "workrun",
      directory: "/project",
      title: "workrun",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const statusesOf = (run: { readonly items: ReadonlyArray<{ readonly status: string }> }) =>
  run.items.map((item) => item.status)

describe("SessionWorkRun", () => {
  it.effect("创建队列持久化单元清单并发布变更事件，重复创建被拒绝", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const events = yield* EventV2.Service
      const published: Array<unknown> = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "workrun.updated") published.push(event.data)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      const run = yield* workrun.create({
        sessionID,
        goal: "逐章审查全书",
        items: ["第 1 章", "第 2 章", "第 3 章"],
      })
      expect(run.status).toBe("active")
      expect(run.goal).toBe("逐章审查全书")
      expect(run.continuationCount).toBe(0)
      expect(statusesOf(run)).toEqual(["pending", "pending", "pending"])
      expect(published).toHaveLength(1)
      const first = published[0] as { readonly run: { readonly goal: string; readonly status: string } }
      expect(first.run.goal).toBe("逐章审查全书")

      // 重启后读回：current 每次都从持久层查询
      const reloaded = yield* workrun.current(sessionID)
      expect(reloaded?.goal).toBe("逐章审查全书")
      expect(statusesOf(reloaded ?? { items: [] })).toEqual(["pending", "pending", "pending"])

      const conflict = yield* workrun
        .create({ sessionID, goal: "第二个队列", items: ["x"] })
        .pipe(Effect.flip)
      expect(conflict._tag).toBe("SessionWorkRun.InvalidTransition")
    }),
  )

  it.effect("单元状态机推进与非法跃迁拒绝", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a", "b"] })

      const claimed = yield* workrun.claimNext(run.id)
      expect(statusesOf(claimed)).toEqual(["in_progress", "pending"])

      // 进行中未完成不能再领取
      const doubleClaim = yield* workrun.claimNext(run.id).pipe(Effect.flip)
      expect(doubleClaim._tag).toBe("SessionWorkRun.InvalidTransition")

      const firstSeq = claimed.items[0].seq
      const done = yield* workrun.completeItem(run.id, firstSeq)
      expect(statusesOf(done)).toEqual(["done", "pending"])

      // done 不能直接再转 done
      const recomplete = yield* workrun.completeItem(run.id, firstSeq).pipe(Effect.flip)
      expect(recomplete._tag).toBe("SessionWorkRun.InvalidTransition")
    }),
  )

  it.effect("受阻单元附原因且可重置，blocked-only 队列无可执行单元", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a"] })
      const claimed = yield* workrun.claimNext(run.id)
      const blocked = yield* workrun.blockItem(run.id, claimed.items[0].seq, "前置缺失")
      expect(statusesOf(blocked)).toEqual(["blocked"])
      expect(blocked.items[0].note).toBe("前置缺失")

      const decision = yield* workrun.guardDecide(sessionID, LIMITS)
      expect(decision).toEqual({ action: "stop", reason: "no_executable" })

      const reset = yield* workrun.resetItem(run.id, claimed.items[0].seq)
      expect(statusesOf(reset)).toEqual(["pending"])
      expect(reset.items[0].note).toBeUndefined()
    }),
  )

  it.effect("进度笔记覆盖式更新，终态校验后队列终结", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a"] })

      // 未终结单元时终结被拒绝
      const premature = yield* workrun.complete(run.id).pipe(Effect.flip)
      expect(premature._tag).toBe("SessionWorkRun.InvalidTransition")

      const claimed = yield* workrun.claimNext(run.id)
      yield* workrun.recordProgress(run.id, "第一版笔记")
      yield* workrun.recordProgress(run.id, "覆盖后的最新笔记")
      const skipped = yield* workrun.skipItem(run.id, claimed.items[0].seq)
      expect(skipped.progressNote).toBe("覆盖后的最新笔记")

      const finished = yield* workrun.complete(run.id)
      expect(finished.status).toBe("complete")

      const decision = yield* workrun.guardDecide(sessionID, LIMITS)
      expect(decision).toEqual({ action: "stop", reason: "no_run" })
    }),
  )

  it.effect("未领取的 pending 单元可直接跳过（AI 拆章全书已拆完）", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a", "b", "c"] })

      // AI 拆章「全书已拆完」语义：剩余 pending 单元无需先 claim 即可跳过
      const skipped = yield* workrun.skipItem(run.id, 1)
      expect(statusesOf(skipped)).toEqual(["pending", "skipped", "pending"])
      yield* workrun.skipItem(run.id, 2)
      yield* workrun.claimNext(run.id)
      yield* workrun.completeItem(run.id, 0)
      const finished = yield* workrun.complete(run.id)
      expect(finished.status).toBe("complete")
    }),
  )

  it.effect("守卫续跑递增计数且单元迁移清零无进展计数", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const run = yield* workrun.create({ sessionID, goal: "g", items: ["a", "b"] })

      const first = yield* workrun.guardDecide(sessionID, LIMITS)
      expect(first.action).toBe("continue")
      if (first.action === "continue") {
        expect(first.run.continuationCount).toBe(1)
        expect(first.run.noProgressCount).toBe(1)
      }

      // 无单元迁移的连续续跑累计无进展计数
      const second = yield* workrun.guardDecide(sessionID, LIMITS)
      if (second.action === "continue") expect(second.run.noProgressCount).toBe(2)

      // 单元迁移清零无进展计数，续跑计数保留
      yield* workrun.claimNext(run.id)
      const third = yield* workrun.guardDecide(sessionID, LIMITS)
      if (third.action === "continue") {
        expect(third.run.continuationCount).toBe(3)
        expect(third.run.noProgressCount).toBe(1)
      }
    }),
  )

  it.effect("续跑上限熔断转挂起，恢复重置计数", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      yield* workrun.create({ sessionID, goal: "g", items: ["a"] })

      // 上限 2：两次续跑后第三次触发熔断
      const tight = { continuationLimit: 2, noProgressLimit: 99 }
      yield* workrun.guardDecide(sessionID, tight)
      yield* workrun.guardDecide(sessionID, tight)
      const exceeded = yield* workrun.guardDecide(sessionID, tight)
      expect(exceeded).toEqual({ action: "stop", reason: "limit_reached" })

      // 熔断后转 paused，后续守卫放行
      const afterPause = yield* workrun.guardDecide(sessionID, tight)
      expect(afterPause).toEqual({ action: "stop", reason: "no_run" })

      const resumed = yield* workrun.resume(sessionID)
      expect(resumed.status).toBe("active")
      expect(resumed.continuationCount).toBe(0)
      expect(resumed.noProgressCount).toBe(0)
    }),
  )

  it.effect("同 seq 单元迁移按运行簿隔离，不串改其他运行簿", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const otherID = SessionV2.ID.make("ses_workrun_test_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: otherID,
          project_id: Project.ID.global,
          slug: "workrun-other",
          directory: "/project",
          title: "workrun-other",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const workrun = yield* SessionWorkRun.Service
      const runA = yield* workrun.create({ sessionID, goal: "g", items: ["a"] })
      const claimedA = yield* workrun.claimNext(runA.id)
      yield* workrun.skipItem(runA.id, claimedA.items[0].seq)

      const runB = yield* workrun.create({ sessionID: otherID, goal: "g", items: ["b"] })
      const claimedB = yield* workrun.claimNext(runB.id)
      const doneB = yield* workrun.completeItem(runB.id, claimedB.items[0].seq)
      expect(statusesOf(doneB)).toEqual(["done"])

      // 回归：迁移 UPDATE 曾只按 seq 过滤，runB 的同 seq 完成会串改 runA 的 skipped 单元
      const historyA = yield* workrun.history(sessionID)
      expect(statusesOf(historyA[0] ?? { items: [] })).toEqual(["skipped"])
    }),
  )

  it.effect("续跑上限熔断翻挂起时发布变更事件", () =>
    Effect.gen(function* () {
      yield* setup
      const workrun = yield* SessionWorkRun.Service
      const events = yield* EventV2.Service
      const published: Array<unknown> = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "workrun.updated") published.push(event.data)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* workrun.create({ sessionID, goal: "g", items: ["a"] })
      // 回归：上限 0 时首次守卫即熔断翻挂起，阀门分支曾漏发变更事件导致面板滞留活动快照
      const decision = yield* workrun.guardDecide(sessionID, { continuationLimit: 0, noProgressLimit: 99 })
      expect(decision).toEqual({ action: "stop", reason: "limit_reached" })
      expect(published).toHaveLength(2)
      const last = published[1] as { readonly run: { readonly status: string } }
      expect(last.run.status).toBe("paused")
    }),
  )
})
