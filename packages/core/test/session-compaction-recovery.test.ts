import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { EventTable } from "@opennovel-ai/core/event/sql"
import { Location } from "@opennovel-ai/core/location"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionCompactionRecovery } from "@opennovel-ai/core/session/compaction-recovery"
import { SessionEvent } from "@opennovel-ai/core/session/event"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionHistory } from "@opennovel-ai/core/session/history"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { Prompt } from "@opennovel-ai/core/session/prompt"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { testEffect } from "./lib/effect"

// 进程恢复结算只读活跃集合：空集合模拟「新进程首建 location cell，尚无本进程 drain」
let activeSessions = new Set<SessionV2.ID>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: () => Effect.void,
    wait: () => Effect.void,
  }),
)

const location = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make("/project"),
    project: { id: Project.ID.global, directory: AbsolutePath.make("/project") },
  }),
)

// Location/SessionExecution 是 recovery 节点的内部依赖（经 Layer.provide 注入节点实现），
// 不出现在构建结果的输出里；测试体内直接 yield* settle() 需要外层再提供一份
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionCompactionRecovery.node]),
    [
      [SessionExecution.node, execution],
      [Location.node, location],
    ],
  ).pipe(Layer.provideMerge(Layer.mergeAll(execution, location))),
)
const sessionID = SessionV2.ID.make("ses_compact_recovery")

const setup = Effect.gen(function* () {
  activeSessions = new Set<SessionV2.ID>()
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
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

// resume:false 的 prompt 只准入不投影；直接发布 Prompted 事件，等效 drain 提升后的用户消息投影
const seedUserMessage = Effect.gen(function* () {
  const bus = yield* EventV2.Service
  yield* bus.publish(SessionEvent.Prompted, {
    sessionID,
    messageID: SessionMessage.ID.create(),
    timestamp: yield* DateTime.now,
    prompt: Prompt.make({ text: "hello" }),
    delivery: "steer",
  })
})

const publishCompaction = Effect.fn("test.publishCompaction")(function* (opID: SessionMessage.ID) {
  const bus = yield* EventV2.Service
  const timestamp = yield* DateTime.now
  yield* bus.publish(SessionEvent.Compaction.Queued, { sessionID, messageID: opID, timestamp, reason: "manual" })
  yield* bus.publish(SessionEvent.Compaction.Started, { sessionID, messageID: opID, timestamp, reason: "manual" })
})

const compactionMessage = (opID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* SessionHistory.message(db, sessionID, opID)
  })

const interruptedEventCount = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        eq(EventTable.type, EventV2.versionedType(SessionEvent.Compaction.Interrupted.type, 1)),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  return rows.length
})

describe("SessionCompactionRecovery.settle", () => {
  it.effect("settles a leftover running operation as interrupted (restart) without touching history", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedUserMessage
      const opID = SessionMessage.ID.create()
      yield* publishCompaction(opID)

      yield* SessionCompactionRecovery.settle()

      const message = yield* compactionMessage(opID)
      expect(message).toMatchObject({ type: "compaction", status: "interrupted", cause: "restart" })
      expect(yield* interruptedEventCount).toBe(1)
      // 原历史保持有效：崩溃点在 Ended 提交之前，用户消息不被截断或改写
      const { db } = yield* Database.Service
      const history = yield* SessionHistory.load(db, sessionID)
      expect(history.find((entry) => entry.type === "user" && entry.text === "hello")).toBeDefined()

      // cell 重建重复结算：终态操作不再匹配扫描过滤器，不产生第二个终态事件
      yield* SessionCompactionRecovery.settle()
      expect(yield* interruptedEventCount).toBe(1)
    }),
  )

  it.effect("leaves a completed operation settled by a committed Ended untouched", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedUserMessage
      const opID = SessionMessage.ID.create()
      yield* publishCompaction(opID)
      yield* (yield* EventV2.Service).publish(SessionEvent.Compaction.Ended, {
        sessionID,
        messageID: opID,
        timestamp: yield* DateTime.now,
        reason: "manual",
        text: "summary",
        recent: "recent",
      })

      yield* SessionCompactionRecovery.settle()

      // 崩溃点在 Ended 提交之后：replay 得到 completed，恢复结算不得覆盖已完成操作
      const message = yield* compactionMessage(opID)
      expect(message).toMatchObject({ type: "compaction", status: "completed", summary: "summary" })
      expect(yield* interruptedEventCount).toBe(0)
    }),
  )

  it.effect("does not settle operations owned by an active drain in this process", () =>
    Effect.gen(function* () {
      yield* setup
      const opID = SessionMessage.ID.create()
      yield* publishCompaction(opID)
      activeSessions = new Set([sessionID])

      yield* SessionCompactionRecovery.settle()

      const message = yield* compactionMessage(opID)
      expect(message).toMatchObject({ type: "compaction", status: "running" })
      expect(yield* interruptedEventCount).toBe(0)
    }),
  )
})
