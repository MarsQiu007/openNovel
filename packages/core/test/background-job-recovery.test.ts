import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opennovel-ai/core/background-job"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { Deferred, Effect, Fiber, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(BackgroundJob.node))

const subagentRecovery = (parentSessionID: string, childSessionID: string) => ({
  kind: "subagent" as const,
  parentSessionID: SessionSchema.ID.make(parentSessionID),
  childSessionID: SessionSchema.ID.make(childSessionID),
  agent: "writer",
  description: "写一章",
})

describe("BackgroundJob recovery surface", () => {
  it.live("settles jobs into completed, error, and cancelled states", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const completed = yield* jobs.start({ type: "test", run: Effect.succeed("ok") })
      expect(yield* jobs.wait({ id: completed.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "ok" },
      })

      const failed = yield* jobs.start({ type: "test", run: Effect.fail(new Error("boom")) })
      const failure = yield* jobs.wait({ id: failed.id })
      expect(failure.info?.status).toBe("error")
      expect(failure.info?.error).toContain("boom")

      const cancelled = yield* jobs.start({ type: "test", run: Effect.never })
      yield* jobs.cancel(cancelled.id)
      expect(yield* jobs.wait({ id: cancelled.id })).toMatchObject({
        timedOut: false,
        info: { status: "cancelled" },
      })
    }),
  )

  it.live("block resolves with backgrounded when the job is backgrounded", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const scope = yield* Effect.scope
      const job = yield* jobs.start({ type: "test", run: Effect.never })
      const blocked = yield* jobs
        .block({ id: job.id, sessionID: SessionSchema.ID.make("ses_parent") })
        .pipe(Effect.forkIn(scope))
      yield* Effect.yieldNow
      expect(yield* jobs.background(job.id)).toMatchObject({ id: job.id, status: "running" })
      expect(yield* Fiber.join(blocked)).toEqual({ type: "backgrounded", info: expect.objectContaining({ id: job.id }) })
    }),
  )

  it.live("block resolves with finished when the job completes first", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const scope = yield* Effect.scope
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
      const blocked = yield* jobs
        .block({ id: job.id, sessionID: SessionSchema.ID.make("ses_parent") })
        .pipe(Effect.forkIn(scope))
      yield* Effect.yieldNow
      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(blocked)).toEqual({
        type: "finished",
        info: expect.objectContaining({ id: job.id, status: "completed", output: "done" }),
      })
    }),
  )

  it.live("backgroundAll backgrounds exactly the jobs blocked by the session", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const scope = yield* Effect.scope
      const sessionID = SessionSchema.ID.make("ses_a")
      const other = SessionSchema.ID.make("ses_b")
      const first = yield* jobs.start({ type: "test", run: Effect.never })
      const second = yield* jobs.start({ type: "test", run: Effect.never })
      const third = yield* jobs.start({ type: "test", run: Effect.never })
      for (const id of [first.id, second.id, third.id])
        yield* jobs
          .block({ id, sessionID: id === third.id ? other : sessionID })
          .pipe(Effect.forkIn(scope))
      yield* Effect.yieldNow

      const backgrounded = yield* jobs.backgroundAll({ sessionID })
      expect(backgrounded.map((info) => info.id).toSorted()).toEqual([first.id, second.id].toSorted())
      expect((yield* jobs.get(third.id))?.status).toBe("running")

      expect(yield* jobs.backgroundAll({ sessionID })).toEqual([])
      expect(yield* jobs.backgroundAll({ sessionID, type: "other" })).toEqual([])
    }),
  )

  it.live("trims the consumed completed history to the last 25 entries", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const ids: string[] = []
      for (let index = 0; index < 30; index++) {
        const job = yield* jobs.start({ type: "test", run: Effect.succeed(`out-${index}`) })
        ids.push(job.id)
        yield* jobs.wait({ id: job.id })
      }
      expect(yield* jobs.get(ids[0]!)).toBeUndefined()
      expect(yield* jobs.get(ids[4]!)).toBeUndefined()
      expect(yield* jobs.get(ids[5]!)).toMatchObject({ status: "completed" })
      expect(yield* jobs.get(ids[29]!)).toMatchObject({ status: "completed" })
    }),
  )

  it.live("persists recoverable records to KV and clears them on completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const notificationID = SessionMessage.ID.create()
      const recovery = subagentRecovery("ses_parent", "ses_child")
      const job = yield* jobs.start({ type: "subagent", recovery, notificationID, run: Effect.never })

      expect(yield* jobs.background(job.id)).toMatchObject({ id: job.id, notificationID })
      expect(yield* jobs.runningBackground).toEqual([recovery])

      expect(yield* jobs.pendingBackground).toEqual([{ id: job.id, notificationID, recovery, status: "running" }])

      yield* jobs.completeBackground(notificationID)
      expect(yield* jobs.pendingBackground).toEqual([])
      // 作业仍在运行，completeBackground 只清账不终止
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )

  it.live("persists settled recoverable records and drops the memory entry on completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const notificationID = SessionMessage.ID.create()
      const recovery = subagentRecovery("ses_parent", "ses_child")
      const job = yield* jobs.start({
        type: "subagent",
        recovery,
        notificationID,
        run: Effect.succeed("章节产出"),
      })
      yield* jobs.wait({ id: job.id })

      expect(yield* jobs.pendingBackground).toEqual([
        { id: job.id, notificationID, recovery, status: "completed", output: "章节产出" },
      ])

      yield* jobs.completeBackground(notificationID)
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* jobs.get(job.id)).toBeUndefined()
    }),
  )
})
