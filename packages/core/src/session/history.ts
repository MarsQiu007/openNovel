import { and, asc, desc, eq, gt, gte, isNull, ne, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

// 只有真正完成的压缩才是历史锚点：旧消息无 status 字段（按 completed 兼容），
// failed/interrupted/queued/running 消息不得截断历史
const completedCompaction = or(
  isNull(sql`json_extract(${SessionMessageTable.data}, '$.status')`),
  eq(sql`json_extract(${SessionMessageTable.data}, '$.status')`, "completed"),
)

// queued/running 是进行中操作：准入 singleflight 用它们去重，但绝不能当历史锚点
const activeCompactionFilter = or(
  eq(sql`json_extract(${SessionMessageTable.data}, '$.status')`, "queued"),
  eq(sql`json_extract(${SessionMessageTable.data}, '$.status')`, "running"),
)

const queuedCompactionFilter = eq(sql`json_extract(${SessionMessageTable.data}, '$.status')`, "queued")

export const latestCompaction = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "compaction"),
        completedCompaction,
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
  baselineSeq?: number,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gte(SessionMessageTable.seq, compaction.seq),
              baselineSeq === undefined
                ? undefined
                : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
            )
          : undefined,
        baselineSeq === undefined
          ? undefined
          : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) =>
  decode({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID: SessionSchema.ID.make(row.session_id),
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )

export const load = Effect.fn("SessionHistory.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const [epoch, compaction] = yield* Effect.all(
    [
      db
        .select({ baselineSeq: SessionContextEpochTable.baseline_seq })
        .from(SessionContextEpochTable)
        .where(eq(SessionContextEpochTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie),
      latestCompaction(db, sessionID),
    ],
    { concurrency: "unbounded" },
  )
  return yield* Effect.forEach(yield* messageRows(db, sessionID, compaction, epoch?.baselineSeq), decodeMessageRow)
})

export const loadForRunner = Effect.fn("SessionHistory.loadForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  return (yield* entriesForRunner(db, sessionID, baselineSeq)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID), baselineSeq)
  return yield* Effect.forEach(rows, (row) =>
    decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
  )
})

/**
 * 最新一条进行中（queued/running）的压缩操作：手动压缩准入的 singleflight 复用游标。
 * 与只取 completed 的历史锚点不同，这里关心尚未闭环的操作。
 */
export const activeCompaction = Effect.fn("SessionHistory.activeCompaction")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "compaction"),
        activeCompactionFilter,
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  const message = yield* decodeMessageRow(row)
  return message.type === "compaction" ? message : undefined
})

/**
 * 最早一条 queued 压缩操作：排队执行的工作队列头部。取最早而非最新，
 * 保证 drain 循环把入队早于 drain 启动的操作全部执行完，不会在最新操作闭环后漏掉旧操作。
 */
export const oldestQueuedCompaction = Effect.fn("SessionHistory.oldestQueuedCompaction")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "compaction"),
        queuedCompactionFilter,
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  const message = yield* decodeMessageRow(row)
  return message.type === "compaction" ? message : undefined
})

/**
 * 按 ID 读取单条消息：压缩撤销与中断结算需要精确核对操作当前状态（queued/running/终态）。
 */
export const message = Effect.fn("SessionHistory.message")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.id, messageID)))
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  return yield* decodeMessageRow(row)
})

export * as SessionHistory from "./history"
