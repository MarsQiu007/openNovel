/**
 * 记忆卡 HTTP 业务实现（agent-memory-ui design D2）：直查 novel-store，
 * 不开 opennovel 服务层（无 plugin 依赖需求；review-inbox 放 opennovel 是因复用 plugin 服务）。
 *
 * 写路径全部走 withTransaction（novel-store 事务纪律）；状态流转以当前行状态为前置校验，
 * 冲突返回 ok:false 而非覆盖。FTS 应用级同步（D4）：手记创建 INSERT、编辑 text 时
 * DELETE+INSERT；approve/retire/unmerge 不动 FTS（虚表无 status 列）。
 */

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { ChapterNotFoundError, NovelNotFoundError } from "@opennovel-ai/protocol/groups/novel"
import type {
  MemoryFactCounts,
  MemoryFactCreateInput,
  MemoryFactEditInput,
  MemoryFactItem,
  MemoryFactListResult,
  MemoryFactOperationResult,
  MemoryFactStatus,
  MemoryMaintenanceReport,
} from "@opennovel-ai/schema/novel"
import {
  ChapterTable,
  MemoryFactTable,
  NovelTable,
  PLANNED_STALL_CHAPTER_THRESHOLD,
  buildMaintenanceReport,
  getDb,
  withTransaction,
  type Db,
  type Tx,
} from "@opennovel-ai/novel-store"

export interface MemoryFactListQuery {
  status?: MemoryFactStatus
  factType?: string
  chapterId?: string
  /** 关键词：走 memory_fact_fts（trigram 分词，text + quote 两列） */
  q?: string
  limit?: number
  offset?: number
}

function novelNotFound(novelId: string): NovelNotFoundError {
  return new NovelNotFoundError({
    name: "NovelNotFoundError",
    data: { message: `Novel not found: ${novelId}`, novelId },
  })
}

function chapterNotFound(chapterId: string, novelId: string): ChapterNotFoundError {
  return new ChapterNotFoundError({
    name: "ChapterNotFoundError",
    data: { message: `Chapter not found: ${chapterId}`, novelId, chapterId },
  })
}

function novelExists(db: Db, novelID: string): boolean {
  return !!db.select({ id: NovelTable.id }).from(NovelTable).where(eq(NovelTable.id, novelID)).get()
}

/** 待办口径（D：pending+reviewed+stale），设定树徽标与列表结果共用。 */
function readCounts(db: Db, novelID: string): MemoryFactCounts {
  const rows = db
    .select({ status: MemoryFactTable.status, n: count() })
    .from(MemoryFactTable)
    .where(eq(MemoryFactTable.novel_id, novelID))
    .groupBy(MemoryFactTable.status)
    .all()
  const byStatus = new Map(rows.map((row) => [row.status, row.n]))
  const pending = byStatus.get("pending") ?? 0
  const reviewed = byStatus.get("reviewed") ?? 0
  const stale = byStatus.get("stale") ?? 0
  return { pending, reviewed, stale, total: pending + reviewed + stale }
}

function ftsHitIds(db: Db, novelID: string, q: string): string[] {
  // bun 驱动下 db.all(sql``) 同步返回数组（同 archive.ts memorySearch 先例）
  const rows = db.all(
    sql`SELECT fact_id FROM memory_fact_fts WHERE memory_fact_fts MATCH ${q} AND novel_id = ${novelID}`,
  )
  return rows.flatMap((row) =>
    typeof row === "object" && row !== null && "fact_id" in row ? [String(row.fact_id)] : [],
  )
}

function loadFactTx(tx: Tx, novelID: string, factID: string) {
  return tx
    .select()
    .from(MemoryFactTable)
    .where(and(eq(MemoryFactTable.id, factID), eq(MemoryFactTable.novel_id, novelID)))
    .get()
}

export function listMemoryFacts(novelID: string, directory: string, query: MemoryFactListQuery) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))

    const hitIds = query.q ? ftsHitIds(db, novelID, query.q) : null
    const empty: MemoryFactListResult = { items: [], total: 0, counts: readCounts(db, novelID) }
    if (hitIds && hitIds.length === 0) return empty

    const conditions = [eq(MemoryFactTable.novel_id, novelID)]
    if (query.status) conditions.push(eq(MemoryFactTable.status, query.status))
    if (query.factType) conditions.push(eq(MemoryFactTable.fact_type, query.factType))
    if (query.chapterId) conditions.push(eq(MemoryFactTable.chapter_id, query.chapterId))
    if (hitIds) conditions.push(inArray(MemoryFactTable.id, hitIds))
    const where = and(...conditions)

    const total =
      db.select({ n: count() }).from(MemoryFactTable).where(where).get()?.n ?? 0
    const rows = db
      .select({
        id: MemoryFactTable.id,
        factType: MemoryFactTable.fact_type,
        entityHint: MemoryFactTable.entity_hint,
        text: MemoryFactTable.text,
        quote: MemoryFactTable.quote,
        chapterId: MemoryFactTable.chapter_id,
        chapterOrder: ChapterTable.order,
        status: MemoryFactTable.status,
        retiredInto: MemoryFactTable.retired_into,
        confidence: MemoryFactTable.confidence,
        proofCount: MemoryFactTable.proof_count,
        createdBy: MemoryFactTable.created_by,
        createdAt: MemoryFactTable.created_at,
        updatedAt: MemoryFactTable.updated_at,
      })
      .from(MemoryFactTable)
      .leftJoin(ChapterTable, eq(ChapterTable.id, MemoryFactTable.chapter_id))
      .where(where)
      .orderBy(desc(MemoryFactTable.created_at), asc(MemoryFactTable.id))
      .limit(query.limit ?? 20)
      .offset(query.offset ?? 0)
      .all()

    const items: MemoryFactItem[] = rows.map((row) => ({ ...row, status: row.status as MemoryFactStatus }))
    return { items, total, counts: readCounts(db, novelID) }
  })
}

export function memoryFactCounts(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))
    return readCounts(db, novelID)
  })
}

export function memoryMaintenance(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))
    const report: MemoryMaintenanceReport = {
      ...buildMaintenanceReport(db, novelID),
      stalledThreshold: PLANNED_STALL_CHAPTER_THRESHOLD,
    }
    return report
  })
}

export function createMemoryFact(novelID: string, directory: string, input: MemoryFactCreateInput) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))
    if (input.chapterId) {
      const chapter = db
        .select({ id: ChapterTable.id })
        .from(ChapterTable)
        .where(and(eq(ChapterTable.id, input.chapterId), eq(ChapterTable.novel_id, novelID)))
        .get()
      if (!chapter) return yield* Effect.fail(chapterNotFound(input.chapterId, novelID))
    }

    return yield* Effect.sync((): MemoryFactOperationResult =>
      withTransaction(db, (tx) => {
        const factId = crypto.randomUUID()
        const now = Date.now()
        tx.insert(MemoryFactTable)
          .values({
            id: factId,
            novel_id: novelID,
            chapter_id: input.chapterId ?? null,
            // 手记缺省 fact_type="note"（D7）；出处锚点 = 可选 quote + chapter_id，quote_span 恒空
            fact_type: input.factType ?? "note",
            quote: input.quote ?? null,
            entity_hint: input.entityHint ?? null,
            text: input.text,
            status: "pending",
            created_by: "author",
            created_at: now,
            updated_at: now,
          })
          .run()
        tx.run(
          sql`INSERT INTO memory_fact_fts (novel_id, fact_id, text, quote) VALUES (${novelID}, ${factId}, ${input.text}, ${input.quote ?? ""})`,
        )
        return { ok: true, factId, status: "pending" }
      }),
    )
  })
}

export function editMemoryFact(novelID: string, directory: string, factID: string, input: MemoryFactEditInput) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))

    return yield* Effect.sync((): MemoryFactOperationResult =>
      withTransaction(db, (tx) => {
        const row = loadFactTx(tx, novelID, factID)
        if (!row) return { ok: false, error: `记忆卡不存在: ${factID}` }
        // retired 留痕只读：改作废卡等于复活，恢复走 unmerge（合并卡）或重新登记
        if (row.status === "retired") return { ok: false, error: "retired 卡不可编辑（留痕只读）" }
        if (input.text === undefined && input.entityHint === undefined)
          return { ok: false, error: "没有要修改的字段" }

        const text = input.text ?? row.text
        const entityHint = input.entityHint === undefined ? row.entity_hint : input.entityHint
        tx.update(MemoryFactTable)
          .set({ text, entity_hint: entityHint, updated_at: Date.now() })
          .where(eq(MemoryFactTable.id, factID))
          .run()
        // FTS 应用级同步：text 变更时整行 DELETE+INSERT（quote 不动）
        if (input.text !== undefined && input.text !== row.text) {
          tx.run(sql`DELETE FROM memory_fact_fts WHERE fact_id = ${factID}`)
          tx.run(
            sql`INSERT INTO memory_fact_fts (novel_id, fact_id, text, quote) VALUES (${novelID}, ${factID}, ${text}, ${row.quote ?? ""})`,
          )
        }
        return { ok: true, factId: factID, status: row.status as MemoryFactStatus }
      }),
    )
  })
}

export function approveMemoryFact(novelID: string, directory: string, factID: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))

    return yield* Effect.sync((): MemoryFactOperationResult =>
      withTransaction(db, (tx) => {
        const row = loadFactTx(tx, novelID, factID)
        if (!row) return { ok: false, error: `记忆卡不存在: ${factID}` }
        // D6：作者裁决是最高确认级别，pending/reviewed 直达 approved；stale 需先核实
        if (row.status !== "pending" && row.status !== "reviewed")
          return { ok: false, error: `仅 pending/reviewed 卡可批准（当前 ${row.status}）` }
        tx.update(MemoryFactTable)
          .set({ status: "approved", updated_at: Date.now() })
          .where(eq(MemoryFactTable.id, factID))
          .run()
        return { ok: true, factId: factID, status: "approved" }
      }),
    )
  })
}

export function retireMemoryFact(novelID: string, directory: string, factID: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))

    return yield* Effect.sync((): MemoryFactOperationResult =>
      withTransaction(db, (tx) => {
        const row = loadFactTx(tx, novelID, factID)
        if (!row) return { ok: false, error: `记忆卡不存在: ${factID}` }
        if (row.status === "retired") return { ok: false, error: "该卡已是 retired" }
        // 留痕不删行；普通作废无合并去向（retired_into 保持 null，D5 边界：无恢复通道）
        tx.update(MemoryFactTable)
          .set({ status: "retired", updated_at: Date.now() })
          .where(eq(MemoryFactTable.id, factID))
          .run()
        return { ok: true, factId: factID, status: "retired" }
      }),
    )
  })
}

export function unmergeMemoryFact(novelID: string, directory: string, factID: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    if (!novelExists(db, novelID)) return yield* Effect.fail(novelNotFound(novelID))

    return yield* Effect.sync((): MemoryFactOperationResult =>
      withTransaction(db, (tx) => {
        const row = loadFactTx(tx, novelID, factID)
        if (!row) return { ok: false, error: `记忆卡不存在: ${factID}` }
        // D5：仅带合并去向留痕的被并卡可撤销；原状态信息已不在，恢复即回 pending 重走生命周期
        if (row.status !== "retired" || row.retired_into === null)
          return { ok: false, error: "仅被整理合并退休的卡（带合并去向留痕）可撤销合并" }
        tx.update(MemoryFactTable)
          .set({ status: "pending", retired_into: null, updated_at: Date.now() })
          .where(eq(MemoryFactTable.id, factID))
          .run()
        return { ok: true, factId: factID, status: "pending" }
      }),
    )
  })
}
