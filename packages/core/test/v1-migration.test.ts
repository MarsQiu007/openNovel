import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opennovel-ai/core/database/database"
import { DataMigrationTable } from "@opennovel-ai/core/data-migration.sql"
import { EventSequenceTable, EventTable } from "@opennovel-ai/core/event/sql"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { SessionMessageTable, SessionTable } from "@opennovel-ai/core/session/sql"
import { V1Migration } from "@opennovel-ai/core/session/v1-migration"

const decodeV2 = Schema.decodeUnknownSync(SessionMessage.Message)

const withDb = <A, E>(effect: Effect.Effect<A, E, Database.Service>) =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(Database.layerFromPath(":memory:")))))

const run = <A, E>(effect: Effect.Effect<A, E, Database.Service>) =>
  withDb(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* seedProject(database.db)
      return yield* effect
    }),
  )

function seedProject(db: Database.Interface["db"]) {
  return db
    .insert(ProjectTable)
    .values({ id: "global" as never, worktree: "/project" as never, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
}

function seedSession(db: Database.Interface["db"], id: string) {
  return db
    .insert(SessionTable)
    .values({
      id: SessionSchema.ID.make(id),
      project_id: "global" as never,
      slug: id,
      directory: "/project" as never,
      title: `session ${id}`,
      version: "0.0.1",
    })
    .run()
    .pipe(Effect.orDie)
}

function v1user(text: string, created: number) {
  return {
    message: { role: "user", agent: "build", model: { providerID: "p", modelID: "m" }, time: { created } },
    parts: [{ type: "text", text }],
  }
}

function v1assistant(parentID: string, created: number, overrides?: Record<string, unknown>) {
  return {
    message: {
      role: "assistant",
      parentID,
      agent: "build",
      providerID: "p",
      modelID: "m",
      cost: 0.5,
      tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 2 } },
      time: { created, completed: created + 1 },
      ...overrides,
    },
    parts: [] as Array<Record<string, unknown>>,
  }
}

function seedThread(
  db: Database.Interface["db"],
  sessionID: string,
  entries: ReadonlyArray<{ message: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>,
) {
  return Effect.forEach(
    entries.map((entry, index) => ({ ...entry, id: `msg_${sessionID}_${index}`, created: 1000 + index, index })),
    (entry) =>
      Effect.gen(function* () {
        yield* db
          .insert(V1Migration.V1MessageTable)
          .values({
            id: entry.id,
            session_id: SessionSchema.ID.make(sessionID),
            time_created: entry.created,
            data: JSON.stringify(entry.message),
          })
          .run()
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          entry.parts.map((part, partIndex) => ({ ...part, id: `prt_${sessionID}_${entry.index}_${partIndex}` })),
          (part) =>
            db
              .insert(V1Migration.V1PartTable)
              .values({
                id: part.id,
                message_id: entry.id,
                session_id: SessionSchema.ID.make(sessionID),
                time_created: entry.created,
                data: JSON.stringify(part),
              })
              .run()
              .pipe(Effect.orDie),
        )
      }),
    { discard: true },
  )
}

function migrated(db: Database.Interface["db"], sessionID: string) {
  return db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, SessionSchema.ID.make(sessionID)))
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.map((row) => ({ row, decoded: decodeV2({ ...row.data, id: row.id, type: row.type }) }))),
    )
}

describe("V1Migration.transformSession", () => {
  const session = { id: "ses_a", agent: null, model: null }

  test("user 消息：text 拼接、file→uri 附件、agent→agents、回填 agent/model", () => {
    const result = V1Migration.transformSession({
      session,
      messages: [
        {
          id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1001,
          data: JSON.stringify({
            role: "user",
            agent: "writer",
            model: { providerID: "p", modelID: "m", variant: "v" },
            time: { created: 1000 },
          }),
        },
      ],
      parts: [
        {
          id: "prt_1",
          message_id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({ type: "text", text: "第一章" }),
        },
        {
          id: "prt_2",
          message_id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({
            type: "file",
            mime: "image/png",
            filename: "cover.png",
            url: "file:///cover.png",
            source: { type: "file", path: "/cover.png", text: { value: "@cover.png", start: 3, end: 14 } },
          }),
        },
        {
          id: "prt_3",
          message_id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({ type: "agent", name: "writer", source: { value: "@writer", start: 0, end: 7 } }),
        },
      ],
    })
    expect(result.warnings).toEqual([])
    expect(result.messages).toHaveLength(1)
    const message = result.messages[0]
    expect(message.type).toBe("user")
    expect(message.seq).toBe(0)
    expect(message.data).toMatchObject({
      text: "第一章",
      files: [
        {
          uri: "file:///cover.png",
          mime: "image/png",
          name: "cover.png",
          source: { text: "@cover.png", start: 3, end: 14 },
        },
      ],
      agents: [{ name: "writer", source: { text: "@writer", start: 0, end: 7 } }],
    })
    expect(result.session).toMatchObject({
      agent: "writer",
      model: { id: "m", providerID: "p", variant: "v" },
      cost: 0,
      tokens_input: 0,
    })
    expect(result.watermark).toBe(0)
  })

  test("assistant 消息：task→subagent 连名带参数改写、read 的 filePath→path、structured 兜底、汇总求和", () => {
    const result = V1Migration.transformSession({
      session,
      messages: [
        {
          id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1001,
          data: JSON.stringify({
            role: "user",
            agent: "build",
            model: { providerID: "p", modelID: "m" },
            time: { created: 1000 },
          }),
        },
        {
          id: "msg_2",
          session_id: "ses_a",
          time_created: 1002,
          time_updated: 1003,
          data: JSON.stringify({
            role: "assistant",
            parentID: "msg_1",
            agent: "build",
            providerID: "p",
            modelID: "m",
            finish: "tool-calls",
            cost: 0.5,
            tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 1, write: 2 } },
            time: { created: 1002, completed: 1003 },
          }),
        },
      ],
      parts: [
        {
          id: "prt_1",
          message_id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({ type: "text", text: "去查" }),
        },
        {
          id: "prt_2",
          message_id: "msg_2",
          session_id: "ses_a",
          time_created: 1002,
          time_updated: 1002,
          data: JSON.stringify({ type: "text", text: "调用工具" }),
        },
        {
          id: "prt_3",
          message_id: "msg_2",
          session_id: "ses_a",
          time_created: 1002,
          time_updated: 1002,
          data: JSON.stringify({
            type: "tool",
            callID: "call_1",
            tool: "task",
            state: {
              status: "completed",
              input: { subagent_type: "explore", task_id: "ses_child", prompt: "找" },
              output: "找到了",
              title: "task",
              metadata: {},
              time: { start: 1002, end: 1003 },
            },
          }),
        },
        {
          id: "prt_4",
          message_id: "msg_2",
          session_id: "ses_a",
          time_created: 1002,
          time_updated: 1002,
          data: JSON.stringify({
            type: "tool",
            callID: "call_2",
            tool: "read",
            state: {
              status: "error",
              input: { filePath: "/a.txt" },
              error: "boom",
              time: { start: 1002, end: 1003 },
            },
          }),
        },
      ],
    })
    expect(result.warnings).toEqual([])
    const assistant = result.messages.find((message) => message.type === "assistant")
    expect(assistant).toBeDefined()
    const content = (assistant!.data as Record<string, unknown>).content as Array<Record<string, unknown>>
    expect(content[0]).toMatchObject({ type: "text", text: "调用工具" })
    expect(content[0].id).toBeTruthy()
    expect(content[1]).toMatchObject({
      type: "tool",
      id: "call_1",
      name: "subagent",
      state: {
        status: "completed",
        input: { agent: "explore", sessionID: "ses_child", prompt: "找" },
        structured: {},
        content: [{ type: "text", text: "找到了" }],
      },
    })
    expect(content[2]).toMatchObject({
      type: "tool",
      id: "call_2",
      name: "read",
      state: {
        status: "error",
        input: { path: "/a.txt" },
        structured: {},
        error: { type: "unknown", message: "boom" },
      },
    })
    expect(result.session).toMatchObject({
      cost: 0.5,
      tokens_input: 10,
      tokens_output: 20,
      tokens_reasoning: 3,
      tokens_cache_read: 1,
      tokens_cache_write: 2,
    })
    expect(assistant!.data).toMatchObject({ finish: "tool-calls" })
  })

  test("compaction：配对 summary assistant 折叠为 Compaction（recent 必填）", () => {
    const result = V1Migration.transformSession({
      session,
      messages: [
        {
          id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({
            role: "user",
            agent: "build",
            model: { providerID: "p", modelID: "m" },
            time: { created: 1000 },
          }),
        },
        {
          id: "msg_2",
          session_id: "ses_a",
          time_created: 1001,
          time_updated: 1002,
          data: JSON.stringify({
            role: "assistant",
            parentID: "msg_1",
            summary: true,
            agent: "build",
            providerID: "p",
            modelID: "m",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1001, completed: 1002 },
          }),
        },
      ],
      parts: [
        {
          id: "prt_1",
          message_id: "msg_1",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({ type: "compaction", auto: true }),
        },
        {
          id: "prt_2",
          message_id: "msg_2",
          session_id: "ses_a",
          time_created: 1001,
          time_updated: 1001,
          data: JSON.stringify({ type: "text", text: "前文摘要" }),
        },
      ],
    })
    expect(result.warnings).toEqual([])
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      type: "compaction",
      data: { reason: "auto", summary: "前文摘要", recent: "" },
    })
  })

  test("无效行进 warnings 不炸迁移", () => {
    const result = V1Migration.transformSession({
      session,
      messages: [
        {
          id: "msg_bad",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: "{not json",
        },
      ],
      parts: [
        {
          id: "prt_orphan",
          message_id: "msg_gone",
          session_id: "ses_a",
          time_created: 1000,
          time_updated: 1000,
          data: JSON.stringify({ type: "text", text: "orphan" }),
        },
      ],
    })
    expect(result.messages).toEqual([])
    expect(result.warnings).toEqual([
      { reason: "invalid-message", sessionID: "ses_a", messageID: "msg_bad" },
      { reason: "orphan-part", sessionID: "ses_a", messageID: "msg_gone", partID: "prt_orphan", observedType: "text" },
    ])
  })
})

describe("V1Migration.run", () => {
  test("完整迁移：内容/水位/事件清理/锚点/幂等重跑", () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const db = database.db
        yield* seedSession(db, "ses_a")
        yield* seedThread(db, "ses_a", [
          v1user("写第一章", 1000),
          { ...v1assistant("msg_ses_a_0", 1001), parts: [{ type: "text", text: "好的" }] },
        ])
        yield* db
          .insert(EventSequenceTable)
          .values({ aggregate_id: "ses_a", seq: 7 })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(EventTable)
          .values([
            { id: "evt_1" as never, aggregate_id: "ses_a", seq: 0, type: "session.created.1", data: {} },
            { id: "evt_2" as never, aggregate_id: "ses_a", seq: 1, type: "message.updated.1", data: {} },
          ])
          .run()
          .pipe(Effect.orDie)
        // 无消息会话：不进主循环，V1 事件行走锚点事务的兜底清理
        yield* seedSession(db, "ses_empty")
        yield* db
          .insert(EventSequenceTable)
          .values({ aggregate_id: "ses_empty", seq: 0 })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(EventTable)
          .values({ id: "evt_3" as never, aggregate_id: "ses_empty", seq: 0, type: "session.created.1", data: {} })
          .run()
          .pipe(Effect.orDie)

        yield* V1Migration.run

        const rows = yield* migrated(db, "ses_a")
        expect(rows.map((row) => row.row.type)).toEqual(["user", "assistant"])
        expect(rows.map((row) => row.row.seq)).toEqual([0, 1])
        expect(rows[0].decoded).toMatchObject({ type: "user", text: "写第一章" })
        expect(rows[1].decoded).toMatchObject({ type: "assistant", cost: 0.5 })

        const session = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, SessionSchema.ID.make("ses_a")))
          .get()
          .pipe(Effect.orDie)
        expect(session).toMatchObject({ cost: 0.5, tokens_input: 10, tokens_output: 20 })

        // 水位 = max(既有 7, 内容 1)；V1 事件行已清
        const sequence = yield* db
          .select()
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, "ses_a"))
          .get()
          .pipe(Effect.orDie)
        expect(sequence?.seq).toBe(7)
        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, "ses_a"))
          .all()
          .pipe(Effect.orDie)
        expect(events).toEqual([])
        const emptyEvents = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, "ses_empty"))
          .all()
          .pipe(Effect.orDie)
        expect(emptyEvents).toEqual([])

        const anchor = yield* db
          .select()
          .from(DataMigrationTable)
          .where(eq(DataMigrationTable.name, "v1-session-migration"))
          .get()
          .pipe(Effect.orDie)
        expect(anchor).toBeDefined()

        // 幂等：锚点短路，重跑零变化
        yield* V1Migration.run
        expect(yield* migrated(db, "ses_a")).toHaveLength(2)
      }),
    ))

  test("无 V1 数据：仅落锚点", () =>
    run(
      Effect.gen(function* () {
        yield* V1Migration.run
        const database = yield* Database.Service
        const anchor = yield* database.db
          .select()
          .from(DataMigrationTable)
          .where(eq(DataMigrationTable.name, "v1-session-migration"))
          .get()
          .pipe(Effect.orDie)
        expect(anchor).toBeDefined()
      }),
    ))

  test("已有 V2 内容的会话跳过内容迁移（②格后续聊边界）", () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const db = database.db
        yield* seedSession(db, "ses_b")
        yield* seedThread(db, "ses_b", [v1user("旧内容", 1000)])
        yield* db
          .insert(SessionMessageTable)
          .values({
            id: SessionMessage.ID.make("msg_v2_1"),
            session_id: SessionSchema.ID.make("ses_b"),
            type: "user",
            seq: 3,
            time_created: 2000,
            data: { text: "新内容", time: { created: 2000 } } as never,
          })
          .run()
          .pipe(Effect.orDie)

        yield* db
          .insert(EventSequenceTable)
          .values({ aggregate_id: "ses_b", seq: 0 })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(EventTable)
          .values({ id: "evt_b" as never, aggregate_id: "ses_b", seq: 0, type: "session.created.1", data: {} })
          .run()
          .pipe(Effect.orDie)

        yield* V1Migration.run

        // 既有 V2 行原样保留，V1 内容未混入；V1 事件行保留兜底
        const rows = yield* migrated(db, "ses_b")
        expect(rows).toHaveLength(1)
        expect(rows[0].decoded).toMatchObject({ type: "user", text: "新内容" })
        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, "ses_b"))
          .all()
          .pipe(Effect.orDie)
        expect(events).toHaveLength(1)
        // 锚点照常完成（其他会话不受影响）
        const anchor = yield* db
          .select()
          .from(DataMigrationTable)
          .where(eq(DataMigrationTable.name, "v1-session-migration"))
          .get()
          .pipe(Effect.orDie)
        expect(anchor).toBeDefined()
      }),
    ))
})
