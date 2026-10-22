export * as V1Migration from "./v1-migration"

import { createHash } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect, Layer, Option, Schema, Semaphore } from "effect"
import { Database } from "../database/database"
import { DataMigrationTable } from "../data-migration.sql"
import { EventSequenceTable, EventTable } from "../event/sql"
import { makeGlobalNode } from "../effect/app-node"
import { KVTable } from "../kv/sql"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"

// ============================================================================
// 冻结 V1 契约——仅迁移使用，禁止新引用
//
// 以下形状机械复制自 schema/src/v1/session.ts 与 core/src/session/sql.ts 的
// message/part 表定义（v1-removal G5 后源头已删）。只保留迁移消费的字段，
// 解码统一 onExcessProperty: "ignore"。物理表按「不删行原则」继续存在，
// 因此表结构定义必须与既有数据库布局保持一致。
// ============================================================================

const V1MessageTable = sqliteTable("message", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
  data: text().notNull(),
})

const V1PartTable = sqliteTable("part", {
  id: text().primaryKey(),
  message_id: text().notNull(),
  session_id: text().notNull(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
  data: text().notNull(),
})

const V1_EVENT_TYPES = [
  "session.created.1",
  "session.updated.1",
  "session.deleted.1",
  "message.updated.1",
  "message.removed.1",
  "message.part.updated.1",
  "message.part.removed.1",
] as const

const Mention = Schema.Struct({ value: Schema.String, start: Schema.Finite, end: Schema.Finite })

const V1TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
})

const V1ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  time: Schema.Struct({ start: Schema.Finite, end: Schema.optional(Schema.Finite) }),
})

const V1FilePart = Schema.Struct({
  type: Schema.Literal("file"),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(Schema.Struct({ text: Mention })),
})

const V1AgentPart = Schema.Struct({
  type: Schema.Literal("agent"),
  name: Schema.String,
  source: Schema.optional(Mention),
})

const V1CompactionPart = Schema.Struct({
  type: Schema.Literal("compaction"),
  auto: Schema.Boolean,
  tail_start_id: Schema.optional(Schema.String),
})

const V1SubtaskPart = Schema.Struct({ type: Schema.Literal("subtask") })

const V1SnapshotPart = Schema.Struct({ type: Schema.Literal("snapshot"), snapshot: Schema.String })

const V1PatchPart = Schema.Struct({
  type: Schema.Literal("patch"),
  hash: Schema.String,
  files: Schema.Array(Schema.String),
})

const V1StepStartPart = Schema.Struct({
  type: Schema.Literal("step-start"),
  snapshot: Schema.optional(Schema.String),
})

const V1StepFinishPart = Schema.Struct({
  type: Schema.Literal("step-finish"),
  snapshot: Schema.optional(Schema.String),
})

const V1ToolInput = Schema.Record(Schema.String, Schema.Unknown)

const V1ToolState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), input: V1ToolInput }),
  Schema.Struct({
    status: Schema.Literal("running"),
    input: V1ToolInput,
    time: Schema.Struct({ start: Schema.Finite }),
  }),
  Schema.Struct({
    status: Schema.Literal("completed"),
    input: V1ToolInput,
    output: Schema.String,
    time: Schema.Struct({
      start: Schema.Finite,
      end: Schema.Finite,
      compacted: Schema.optional(Schema.Finite),
    }),
    attachments: Schema.optional(Schema.Array(V1FilePart)),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    input: V1ToolInput,
    error: Schema.String,
    time: Schema.Struct({ start: Schema.Finite, end: Schema.Finite }),
  }),
])

const V1ToolPart = Schema.Struct({
  type: Schema.Literal("tool"),
  callID: Schema.String,
  tool: Schema.String,
  state: V1ToolState,
})

const V1Part = Schema.Union([
  V1TextPart,
  V1ReasoningPart,
  V1FilePart,
  V1AgentPart,
  V1CompactionPart,
  V1SubtaskPart,
  V1SnapshotPart,
  V1PatchPart,
  V1StepStartPart,
  V1StepFinishPart,
  V1ToolPart,
])
type V1Part = typeof V1Part.Type

const V1Model = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
})

const V1User = Schema.Struct({
  role: Schema.Literal("user"),
  agent: Schema.String,
  model: V1Model,
  time: Schema.Struct({ created: Schema.Finite }),
})

const V1Assistant = Schema.Struct({
  role: Schema.Literal("assistant"),
  parentID: Schema.String,
  summary: Schema.optional(Schema.Boolean),
  agent: Schema.String,
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
  finish: Schema.optional(Schema.String),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite }),
  }),
  error: Schema.optional(Schema.Struct({ name: Schema.String, data: Schema.Record(Schema.String, Schema.Unknown) })),
  time: Schema.Struct({ created: Schema.Finite, completed: Schema.optional(Schema.Finite) }),
})

const V1Message = Schema.Union([V1User, V1Assistant])
type V1Message = typeof V1Message.Type

const decodeOptions = { onExcessProperty: "ignore" } as const
const decodeV1Message = Schema.decodeUnknownOption(V1Message, decodeOptions)
const decodeV1Part = Schema.decodeUnknownOption(V1Part, decodeOptions)
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeV2Message = Schema.decodeUnknownOption(SessionMessage.Message)
const encodeV2Message = Schema.encodeSync(SessionMessage.Message)

// ============================================================================
// Transform（移植自上游 v1-migration.bun.ts transformSession，按 fork V2 形状改造：
// content 项带 id、ToolState 无 metadata 且 structured 必填、错误词汇塌缩 unknown、
// FileAttachment 用 uri、Compaction.recent 必填、工具名改写仅 task→subagent 与 filePath→path）
// ============================================================================

export type SourceMessage = typeof V1MessageTable.$inferSelect
export type SourcePart = typeof V1PartTable.$inferSelect

export type TransformInput = {
  readonly session: {
    readonly id: string
    readonly agent: string | null
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }
  readonly messages: ReadonlyArray<SourceMessage>
  readonly parts: ReadonlyArray<SourcePart>
}

export type Warning = {
  readonly reason: string
  readonly sessionID: string
  readonly messageID?: string
  readonly partID?: string
  readonly observedType?: string
}

type SessionMessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "type" | "id">

/** 验证前的中间产物：data 为未编码的宽松形状，经 SessionMessage.Message 往返后收敛。 */
type ProjectedMessage = {
  readonly id: string
  readonly type: SessionMessage.Type
  readonly time_created: number
  readonly time_updated: number
  readonly data: Record<string, unknown>
}

export type TransformResult = {
  readonly messages: ReadonlyArray<{
    readonly id: string
    readonly type: SessionMessage.Type
    readonly seq: number
    readonly time_created: number
    readonly time_updated: number
    readonly data: SessionMessageData
  }>
  readonly session: Pick<
    typeof SessionTable.$inferInsert,
    | "agent"
    | "model"
    | "cost"
    | "tokens_input"
    | "tokens_output"
    | "tokens_reasoning"
    | "tokens_cache_read"
    | "tokens_cache_write"
  >
  readonly watermark: number
  readonly warnings: ReadonlyArray<Warning>
}

export function transformSession(input: TransformInput): TransformResult {
  const warnings: Warning[] = []
  const messages = input.messages
    .map((row) => {
      const value = Option.getOrUndefined(decodeJson(row.data))
      const decoded = value === undefined ? undefined : Option.getOrUndefined(decodeV1Message(value))
      if (decoded) return { row, value: decoded }
      warnings.push({ reason: "invalid-message", sessionID: input.session.id, messageID: row.id })
      return undefined
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((a, b) => a.row.time_created - b.row.time_created || a.row.id.localeCompare(b.row.id))
  const messageIDs = new Set(input.messages.map((row) => row.id))
  const parts = input.parts
    .map((row) => {
      const value = Option.getOrUndefined(decodeJson(row.data))
      const observedType =
        value !== undefined && typeof value === "object" && value !== null && "type" in value
          ? String(value.type)
          : undefined
      if (!messageIDs.has(row.message_id)) {
        warnings.push({
          reason: "orphan-part",
          sessionID: input.session.id,
          messageID: row.message_id,
          partID: row.id,
          observedType,
        })
        return undefined
      }
      const decoded = value === undefined ? undefined : Option.getOrUndefined(decodeV1Part(value))
      if (decoded) return { row, value: decoded }
      warnings.push({
        reason: "invalid-part",
        sessionID: input.session.id,
        messageID: row.message_id,
        partID: row.id,
        observedType,
      })
      return undefined
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
  const byMessage = Map.groupBy(parts, (item) => item.row.message_id)
  const paired = new Set<string>()
  const used = new Set(messages.map((item) => item.row.id))
  const projected = messages.flatMap((item): Array<ProjectedMessage> => {
    if (paired.has(item.row.id)) return []
    const owned = byMessage.get(item.row.id)?.map((part) => part.value) ?? []
    if (item.value.role === "user")
      return projectUser({ row: item.row, value: item.value }, owned, messages, byMessage, paired, used)
    return projectAssistant({ row: item.row, value: item.value }, owned, messages, byMessage)
  })
  const validated = projected.flatMap((message): Array<TransformResult["messages"][number]> => {
    const decoded = Option.getOrUndefined(decodeV2Message({ ...message.data, id: message.id, type: message.type }))
    if (!decoded) {
      warnings.push({ reason: "invalid-output", sessionID: input.session.id, messageID: message.id })
      return []
    }
    const { id, type, ...data } = encodeV2Message(decoded)
    return [
      {
        id,
        type,
        seq: 0,
        time_created: message.time_created,
        time_updated: message.time_updated,
        data,
      },
    ]
  })
  const sequenced = validated.map((item, seq) => ({ ...item, seq }))
  const assistants = messages
    .map((item) => item.value)
    .filter((item): item is Extract<V1Message, { role: "assistant" }> => item.role === "assistant")
  const latestUser = messages.findLast((item) => {
    if (item.value.role !== "user") return false
    const owned = byMessage.get(item.row.id) ?? []
    if (owned.some((part) => part.value.type === "compaction")) return false
    return (
      !owned.some((part) => part.value.type === "subtask") ||
      !owned.every((part) => part.value.type === "subtask")
    )
  })
  return {
    messages: sequenced,
    session: {
      agent: input.session.agent ?? (latestUser?.value.role === "user" ? latestUser.value.agent : null),
      model:
        input.session.model ??
        (latestUser?.value.role === "user"
          ? {
              id: latestUser.value.model.modelID,
              providerID: latestUser.value.model.providerID,
              ...(latestUser.value.model.variant === undefined
                ? {}
                : { variant: latestUser.value.model.variant }),
            }
          : null),
      cost: assistants.reduce((total, item) => total + item.cost, 0),
      tokens_input: assistants.reduce((total, item) => total + item.tokens.input, 0),
      tokens_output: assistants.reduce((total, item) => total + item.tokens.output, 0),
      tokens_reasoning: assistants.reduce((total, item) => total + item.tokens.reasoning, 0),
      tokens_cache_read: assistants.reduce((total, item) => total + item.tokens.cache.read, 0),
      tokens_cache_write: assistants.reduce((total, item) => total + item.tokens.cache.write, 0),
    },
    watermark: sequenced.length - 1,
    warnings,
  }
}

type MessageItem = {
  readonly row: SourceMessage
  readonly value: V1Message
}
type PartMap = ReadonlyMap<string, ReadonlyArray<{ readonly row: SourcePart; readonly value: V1Part }>>

function row(
  source: SourceMessage,
  message: { readonly id: string; readonly type: SessionMessage.Type; readonly [key: string]: unknown },
  timeUpdated = source.time_updated,
): ProjectedMessage {
  const { id, type, ...data } = message
  return { id, type, time_created: source.time_created, time_updated: timeUpdated, data }
}

function projectUser(
  item: MessageItem & { value: Extract<V1Message, { role: "user" }> },
  owned: ReadonlyArray<V1Part>,
  messages: ReadonlyArray<MessageItem>,
  byMessage: PartMap,
  paired: Set<string>,
  used: Set<string>,
): Array<ProjectedMessage> {
  const compaction = owned.find((part): part is typeof V1CompactionPart.Type => part.type === "compaction")
  if (compaction) {
    const summary = messages.find(
      (candidate): candidate is MessageItem & { value: Extract<V1Message, { role: "assistant" }> } =>
        candidate.value.role === "assistant" &&
        candidate.value.parentID === item.row.id &&
        candidate.value.summary === true,
    )
    if (!summary) return []
    paired.add(summary.row.id)
    if (summary.value.error || summary.value.time.completed === undefined) return []
    const summaryText = (byMessage.get(summary.row.id) ?? [])
      .map((part) => part.value)
      .filter((part): part is typeof V1TextPart.Type => part.type === "text" && part.text.length > 0)
      .map((part) => part.text)
      .join("\n\n")
    const tailIndex = compaction.tail_start_id
      ? messages.findIndex((candidate) => candidate.row.id === compaction.tail_start_id)
      : -1
    const compactionIndex = messages.findIndex((candidate) => candidate.row.id === item.row.id)
    const tail = tailIndex < 0 ? [] : messages.slice(tailIndex, compactionIndex)
    return [
      row(
        item.row,
        {
          id: item.row.id,
          type: "compaction",
          reason: compaction.auto ? "auto" : "manual",
          summary: summaryText,
          recent: serializeRecent(tail, byMessage),
          time: { created: item.row.time_created },
        },
        Math.max(item.row.time_updated, summary.row.time_updated),
      ),
    ]
  }
  const subtasks = owned.filter((part) => part.type === "subtask")
  const visible = owned.filter((part): part is typeof V1TextPart.Type => part.type === "text" && !part.ignored)
  const files = owned.filter((part): part is typeof V1FilePart.Type => part.type === "file")
  const agents = owned.filter((part): part is typeof V1AgentPart.Type => part.type === "agent")
  if (subtasks.length > 0 && visible.length === 0 && files.length === 0 && agents.length === 0) return []
  const synthetic = visible.filter((part) => part.synthetic)
  const attachments = files.map((part) => ({
    uri: part.url,
    mime: part.mime,
    ...(part.filename === undefined ? {} : { name: part.filename }),
    ...(part.source
      ? {
          source: {
            text: part.source.text.value,
            start: part.source.text.start,
            end: part.source.text.end,
          },
        }
      : {}),
  }))
  const text = visible.filter((part) => !part.synthetic).map((part) => part.text)
  const agentAttachments = agents.map((part) => ({
    name: part.name,
    ...(part.source ? { source: { text: part.source.value, start: part.source.start, end: part.source.end } } : {}),
  }))
  if (text.length === 0 && synthetic.length > 0 && attachments.length === 0 && agentAttachments.length === 0)
    return [
      row(item.row, {
        id: item.row.id,
        type: "synthetic",
        sessionID: item.row.session_id,
        text: synthetic.map((part) => part.text).join("\n\n"),
        time: { created: item.row.time_created },
      }),
    ]
  const user = row(item.row, {
    id: item.row.id,
    type: "user",
    text: text.join("\n\n"),
    ...(attachments.length ? { files: attachments } : {}),
    ...(agentAttachments.length ? { agents: agentAttachments } : {}),
    time: { created: item.row.time_created },
  })
  if (synthetic.length === 0) return [user]
  return [
    user,
    row(item.row, {
      id: syntheticID(item.row.id, used),
      type: "synthetic",
      sessionID: item.row.session_id,
      text: synthetic.map((part) => part.text).join("\n\n"),
      time: { created: item.row.time_created },
    }),
  ]
}

function projectAssistant(
  item: MessageItem & { value: Extract<V1Message, { role: "assistant" }> },
  owned: ReadonlyArray<V1Part>,
  messages: ReadonlyArray<MessageItem>,
  byMessage: PartMap,
): Array<ProjectedMessage> {
  const parent = messages.find((candidate) => candidate.row.id === item.value.parentID)
  const parentParts = parent ? (byMessage.get(parent.row.id)?.map((part) => part.value) ?? []) : []
  if (parentParts.some((part) => part.type === "subtask") && owned.some((part) => part.type === "tool" && part.tool === "task"))
    return []
  const content = owned.flatMap((part, index): Array<Record<string, unknown>> => {
    if (part.type === "text") return [{ type: "text", id: `${item.row.id}_text_${index}`, text: part.text }]
    if (part.type === "reasoning")
      return [
        {
          type: "reasoning",
          id: `${item.row.id}_reasoning_${index}`,
          text: part.text,
          time: {
            created: part.time.start,
            ...(part.time.end === undefined ? {} : { completed: part.time.end }),
          },
        },
      ]
    if (part.type !== "tool") return []
    return [migrateTool(part, item.row.time_created)]
  })
  const start =
    owned.flatMap((part) => (part.type === "step-start" && part.snapshot ? [part.snapshot] : []))[0] ??
    owned.flatMap((part) => (part.type === "snapshot" ? [part.snapshot] : []))[0] ??
    owned.flatMap((part) => (part.type === "patch" ? [part.hash] : []))[0]
  const end = owned.flatMap((part) => (part.type === "step-finish" && part.snapshot ? [part.snapshot] : [])).at(-1)
  const snapshotFiles = Array.from(new Set(owned.flatMap((part) => (part.type === "patch" ? part.files : []))))
  return [
    row(item.row, {
      id: item.row.id,
      type: "assistant",
      agent: item.value.agent,
      model: {
        providerID: item.value.providerID,
        id: item.value.modelID,
        ...(item.value.variant === undefined ? {} : { variant: item.value.variant }),
      },
      content,
      ...(start || end || snapshotFiles.length
        ? {
            snapshot: {
              ...(start ? { start } : {}),
              ...(end ? { end } : {}),
              ...(snapshotFiles.length ? { files: snapshotFiles } : {}),
            },
          }
        : {}),
      ...(item.value.finish === undefined ? {} : { finish: item.value.finish }),
      cost: item.value.cost,
      tokens: {
        input: item.value.tokens.input,
        output: item.value.tokens.output,
        reasoning: item.value.tokens.reasoning,
        cache: item.value.tokens.cache,
      },
      ...(item.value.error ? { error: migrateError(item.value.error) } : {}),
      time: {
        created: item.row.time_created,
        ...(item.value.time.completed === undefined ? {} : { completed: item.row.time_updated }),
      },
    }),
  ]
}

/** task→subagent 连名带参数改写；read/edit/write 仅改写 filePath→path。 */
function migrateTool(part: typeof V1ToolPart.Type, fallback: number) {
  const input = rewriteInput(part.tool, part.state.input)
  const name = part.tool === "task" ? "subagent" : part.tool
  if (part.state.status === "completed")
    return {
      type: "tool" as const,
      id: part.callID,
      name,
      state: {
        status: "completed" as const,
        input,
        content:
          part.state.time.compacted === undefined
            ? [{ type: "text" as const, text: part.state.output }]
            : [{ type: "text" as const, text: "[Old tool result content cleared]" }],
        structured: {},
        ...(part.state.attachments?.length
          ? {
              attachments: part.state.attachments.map((file) => ({
                uri: file.url,
                mime: file.mime,
                ...(file.filename === undefined ? {} : { name: file.filename }),
              })),
            }
          : {}),
      },
      time: { created: part.state.time.start, completed: part.state.time.end },
    }
  if (part.state.status === "error")
    return {
      type: "tool" as const,
      id: part.callID,
      name,
      state: {
        status: "error" as const,
        input,
        content: [],
        structured: {},
        error: { type: "unknown" as const, message: part.state.error },
      },
      time: { created: part.state.time.start, completed: part.state.time.end },
    }
  return {
    type: "tool" as const,
    id: part.callID,
    name,
    state: {
      status: "error" as const,
      input,
      content: [],
      structured: {},
      error: { type: "unknown" as const, message: "Tool execution was interrupted before V2 migration" },
    },
    time: { created: part.state.status === "running" ? part.state.time.start : fallback },
  }
}

function rewriteInput(tool: string, input: Readonly<Record<string, unknown>>) {
  if (tool === "task") {
    const { subagent_type, task_id, ...rest } = input
    return {
      ...rest,
      ...(subagent_type === undefined ? {} : { agent: subagent_type }),
      ...(task_id === undefined ? {} : { sessionID: task_id }),
    }
  }
  if (tool === "read" || tool === "edit" || tool === "write") {
    const { filePath, ...rest } = input
    return { ...rest, ...(filePath === undefined ? {} : { path: filePath }) }
  }
  return { ...input }
}

function migrateError(error: { readonly name: string; readonly data: Readonly<Record<string, unknown>> }) {
  const message =
    typeof error.data.message === "string"
      ? error.data.message
      : error.name === "MessageOutputLengthError"
        ? "The model exceeded its output limit"
        : error.name
  return { type: "unknown" as const, message }
}

function syntheticID(source: string, used: Set<string>) {
  const prefix = source.slice(0, 16)
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  for (let salt = 0; ; salt++) {
    const hex = createHash("sha256")
      .update(`v1-synthetic:${source}${salt ? `:${salt}` : ""}`)
      .digest("hex")
    let value = BigInt(`0x${hex}`)
    let suffix = ""
    while (suffix.length < 14) {
      suffix = alphabet[Number(value % 62n)] + suffix
      value /= 62n
    }
    const id = prefix + suffix
    if (used.has(id)) continue
    used.add(id)
    return id
  }
}

function serializeRecent(messages: ReadonlyArray<MessageItem>, parts: PartMap) {
  return messages
    .flatMap((message) => {
      const owned = parts.get(message.row.id)?.map((part) => part.value) ?? []
      if (message.value.role === "user")
        return [
          `[User]: ${owned
            .filter((part) => part.type === "text" && !part.ignored)
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("\n\n")}`,
        ]
      return owned.flatMap((part) =>
        part.type === "text"
          ? [`[Assistant]: ${part.text}`]
          : part.type === "reasoning" && part.text
            ? [`[Assistant reasoning]: ${part.text}`]
            : [],
      )
    })
    .join("\n\n")
}

// ============================================================================
// Run（完成锚点 data_migration + KV 游标断点；每会话一事务；Semaphore(1)）
// ============================================================================

const ANCHOR = "v1-session-migration"
const CURSOR_KEY = "migration.v1-sessions"

const lock = Semaphore.makeUnsafe(1)

type Db = Database.Interface["db"]
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export const run: Effect.Effect<void, never, Database.Service> = lock.withPermit(
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const anchored = yield* db
      .select()
      .from(DataMigrationTable)
      .where(eq(DataMigrationTable.name, ANCHOR))
      .get()
      .pipe(Effect.orDie)
    if (anchored) return
    const hasLegacy = yield* db
      .get<{ value: number }>(sql`SELECT 1 AS value FROM message LIMIT 1`)
      .pipe(Effect.orDie)
    if (!hasLegacy) {
      yield* anchor(db)
      return
    }
    while (true) {
      const cursor = yield* readCursor(db)
      const next = yield* (cursor === undefined
        ? db.get<{ session_id: string }>(
            sql`SELECT session_id FROM message ORDER BY session_id DESC LIMIT 1`,
          )
        : db.get<{ session_id: string }>(
            sql`SELECT session_id FROM message WHERE session_id < ${cursor} ORDER BY session_id DESC LIMIT 1`,
          )
      ).pipe(Effect.orDie)
      if (!next) break
      yield* db
        .transaction((tx) => migrateSession(tx, next.session_id), { behavior: "immediate" })
        .pipe(Effect.orDie)
      yield* Effect.yieldNow
    }
    yield* db
      .transaction(
        (tx) =>
          Effect.gen(function* () {
            yield* tx.insert(DataMigrationTable).values({ name: ANCHOR, time_completed: Date.now() }).run()
            yield* tx.delete(KVTable).where(eq(KVTable.key, CURSOR_KEY)).run()
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.orDie)
    yield* Effect.logInfo("V1 session migration completed")
  }).pipe(
    Effect.catchCause((cause) => Effect.logError("V1 session migration failed; will retry on next start", cause)),
  ),
)

function anchor(db: Db) {
  return db
    .insert(DataMigrationTable)
    .values({ name: ANCHOR, time_completed: Date.now() })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
}

function readCursor(db: Db) {
  return db
    .select({ value: KVTable.value })
    .from(KVTable)
    .where(eq(KVTable.key, CURSOR_KEY))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => {
        const value = row?.value
        if (typeof value !== "object" || value === null || !("cursor" in value)) return undefined
        const cursor = value.cursor
        return typeof cursor === "string" ? cursor : undefined
      }),
    )
}

const migrateSession = Effect.fnUntraced(function* (tx: Tx, sessionID: string) {
  yield* tx
    .insert(KVTable)
    .values({ key: CURSOR_KEY, value: { cursor: sessionID } })
    .onConflictDoUpdate({ target: KVTable.key, set: { value: { cursor: sessionID }, time_updated: Date.now() } })
    .run()
    .pipe(Effect.orDie)
  // ②格后已被 V2 续聊的会话（session_message 已有 V2 行）：内容迁移无法保持
  // 时序交错，跳过并保留原表兜底（design D5）。
  const hasV2 = yield* tx
    .get<{ value: number }>(sql`SELECT 1 AS value FROM session_message WHERE session_id = ${sessionID} LIMIT 1`)
    .pipe(Effect.orDie)
  if (hasV2) {
    yield* Effect.logWarning("Skipped V1 session with existing V2 content", { sessionID })
    return
  }
  const session = yield* tx
    .select({
      id: SessionTable.id,
      agent: SessionTable.agent,
      model: SessionTable.model,
      time_updated: SessionTable.time_updated,
    })
    .from(SessionTable)
    .where(eq(SessionTable.id, SessionSchema.ID.make(sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (!session) {
    yield* Effect.logWarning("Skipped V1 session with missing session row", { sessionID })
    return
  }
  const sourceMessages = yield* tx
    .select()
    .from(V1MessageTable)
    .where(eq(V1MessageTable.session_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  const sourceParts = yield* tx
    .select()
    .from(V1PartTable)
    .where(eq(V1PartTable.session_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  const transformed = transformSession({ session, messages: sourceMessages, parts: sourceParts })
  yield* Effect.forEach(transformed.warnings, (warning) => Effect.logWarning("Skipped V1 migration row", warning))
  yield* Effect.forEach(transformed.messages, (message) =>
    tx
      .insert(SessionMessageTable)
      .values({
        id: SessionMessage.ID.make(message.id),
        session_id: SessionSchema.ID.make(sessionID),
        type: message.type,
        seq: message.seq,
        time_created: message.time_created,
        time_updated: message.time_updated,
        data: message.data,
      })
      .run()
      .pipe(Effect.orDie),
  )
  yield* tx
    .update(SessionTable)
    .set({ ...transformed.session, time_updated: session.time_updated })
    .where(eq(SessionTable.id, SessionSchema.ID.make(sessionID)))
    .run()
    .pipe(Effect.orDie)
  const existing = yield* tx
    .select({ seq: EventSequenceTable.seq })
    .from(EventSequenceTable)
    .where(eq(EventSequenceTable.aggregate_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  const watermark = Math.max(existing?.seq ?? -1, transformed.watermark)
  yield* tx
    .insert(EventSequenceTable)
    .values({ aggregate_id: sessionID, seq: watermark })
    .onConflictDoUpdate({ target: EventSequenceTable.aggregate_id, set: { seq: watermark } })
    .run()
    .pipe(Effect.orDie)
  yield* tx
    .delete(EventTable)
    .where(and(eq(EventTable.aggregate_id, sessionID), inArray(EventTable.type, [...V1_EVENT_TYPES])))
    .run()
    .pipe(Effect.orDie)
})

const layer = Layer.effectDiscard(Effect.forkScoped(run))

export const node = makeGlobalNode({ name: "v1-migration", layer, deps: [Database.node] })
