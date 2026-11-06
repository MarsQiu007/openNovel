/**
 * 章节序号重排事务原语（chapter-sequence-guard · design D1）。
 *
 * chapters.order 是全书阅读顺序定位键。本原语把「摘出 → 区间平移 → 落位 → 派生序号同步
 * → 检索索引重建」收口为单事务，删除（摘出不插）、移卷/交换（摘出落位）都是其参数化形态。
 *
 * 实现说明：主表重排用逐章主键点更新而非区间 ranged UPDATE——按号定位的派生表需要
 * 旧号→新号映射，映射必须按行维护；逐章点更新互不相干，无需 design 中的临时负值摘出
 * （落点区间对向互不相交，最终态为 1..N 排列，中途瞬态无碍）。
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import {
  ArcBeatTable,
  ChapterTable,
  MemoryInjectionSnapshotTable,
  SegmentSummaryTable,
  StoryArcTable,
  StorySpineEntryTable,
  TechniqueShadowLogTable,
  TensionLogTable,
  WritingBatchTable,
  cancelWritingBatchTx,
  getDb,
} from "./index.js"
import { withTransaction, type Tx } from "./tx.js"

/** 重排计划：move 把章搬到目标号（落点即最终号）；remove 的章记录已由调用方删除，仅作摘出点后补位。 */
export type RelocatePlan =
  | { kind: "move"; chapterId: string; targetOrder: number }
  | { kind: "remove"; afterOrder: number }

export interface ChapterOrderChange {
  chapterId: string
  oldOrder: number
  newOrder: number
}

export interface RelocateResult {
  novelId: string
  /** 序号发生变化的章（旧→新映射）；未变化的章不在其中 */
  changes: ChapterOrderChange[]
  /** 本次重排是否作废了 running 批量（调用方据此提示重新登记） */
  batchCancelled: boolean
}

export function relocateChaptersTx(tx: Tx, novelId: string, plan: RelocatePlan): RelocateResult {
  const rows = tx
    .select({ id: ChapterTable.id, order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .orderBy(asc(ChapterTable.order), asc(ChapterTable.created_at), asc(ChapterTable.id))
    .all()
  const orders = computeOrders(rows, novelId, plan)
  const changes = rows.flatMap((row) => {
    const next = orders.get(row.id)!
    if (next === row.order) return []
    return [{ chapterId: row.id, oldOrder: row.order, newOrder: next }]
  })
  if (changes.length === 0) return { novelId, changes, batchCancelled: false }
  assertContiguous(rows, orders)
  const now = Date.now()
  for (const change of changes) {
    tx.update(ChapterTable)
      .set({ order: change.newOrder, updated_at: now })
      .where(eq(ChapterTable.id, change.chapterId))
      .run()
  }
  syncDerived(tx, novelId, changes)
  rebuildChapterFts(tx, novelId)
  cancelWritingBatchTx(tx, novelId)
  const batch = tx
    .select({ status: WritingBatchTable.status })
    .from(WritingBatchTable)
    .where(eq(WritingBatchTable.novel_id, novelId))
    .get()
  return { novelId, changes, batchCancelled: batch?.status === "cancelled" }
}

/** 重排原语（自包形态）：单事务执行全书序号重排与派生同步。 */
export function relocateChapters(novelId: string, plan: RelocatePlan, directory?: string | null): RelocateResult {
  return withTransaction(getDb(directory), (tx) => relocateChaptersTx(tx, novelId, plan))
}

function computeOrders(
  rows: Array<{ id: string; order: number }>,
  novelId: string,
  plan: RelocatePlan,
): Map<string, number> {
  if (plan.kind === "remove") {
    const orders = new Map<string, number>()
    for (const row of rows) orders.set(row.id, row.order > plan.afterOrder ? row.order - 1 : row.order)
    return orders
  }
  const moved = rows.find((row) => row.id === plan.chapterId)
  if (!moved) throw new Error(`Chapter not found in novel ${novelId}: ${plan.chapterId}`)
  if (plan.targetOrder < 1 || plan.targetOrder > rows.length) {
    throw new Error(`目标序号越界：${plan.targetOrder}（全书共 ${rows.length} 章）`)
  }
  const extract = moved.order
  const orders = new Map<string, number>()
  for (const row of rows) {
    if (row.id === plan.chapterId) {
      orders.set(row.id, plan.targetOrder)
      continue
    }
    if (plan.targetOrder < extract && row.order >= plan.targetOrder && row.order < extract) {
      orders.set(row.id, row.order + 1)
      continue
    }
    if (plan.targetOrder > extract && row.order > extract && row.order <= plan.targetOrder) {
      orders.set(row.id, row.order - 1)
      continue
    }
    orders.set(row.id, row.order)
  }
  return orders
}

/**
 * 终态硬校验：写入前断言新书号为 1..N 排列（唯一且连续的不变量自检）。
 * 前置序号已脏（存量重号/缺口库）时跳过——区间平移只动涉及区间、区外旧号原样保留，
 * 脏库由 repair 工具显式闭环，普通移动不越权全量改写。
 */
function assertContiguous(rows: Array<{ id: string; order: number }>, orders: Map<string, number>): void {
  const preOrders = rows.map((row) => row.order)
  if (new Set(preOrders).size !== preOrders.length) return
  const sorted = rows
    .map((row) => orders.get(row.id)!)
    .sort((a, b) => a - b)
  for (const [index, order] of sorted.entries()) {
    if (order !== index + 1) {
      throw new Error(`章节重排结果不连续：期望 1..${sorted.length}，实际 ${sorted.join(",")}`)
    }
  }
}

function syncDerived(tx: Tx, novelId: string, changes: ChapterOrderChange[]): void {
  // 按号定位的表旧号→新号可能成环（交换即 3↔4），先整体置负暂存再落新号，避免互相覆盖
  const pairs = uniquePairs(changes)
  shiftNumberField(tx, TensionLogTable, novelId, TensionLogTable.novel_id, TensionLogTable.chapter_number, pairs)
  shiftNumberField(
    tx,
    TechniqueShadowLogTable,
    novelId,
    TechniqueShadowLogTable.novel_id,
    TechniqueShadowLogTable.chapter_number,
    pairs,
  )
  for (const field of [
    StoryArcTable.planned_start_chapter,
    StoryArcTable.planned_end_chapter,
    StoryArcTable.actual_start_chapter,
    StoryArcTable.actual_end_chapter,
  ]) {
    shiftNumberField(tx, StoryArcTable, novelId, StoryArcTable.novel_id, field, pairs)
  }
  // 按 chapter_id 定位的表直接回写，不受旧号是否重复影响
  for (const change of changes) {
    tx.update(ArcBeatTable)
      .set({ chapter_order: change.newOrder })
      .where(eq(ArcBeatTable.chapter_id, change.chapterId))
      .run()
    tx.update(StorySpineEntryTable)
      .set({ chapter_order: change.newOrder })
      .where(eq(StorySpineEntryTable.chapter_id, change.chapterId))
      .run()
  }
  // 与受影响区间相交的汇总段内嵌旧号区间，删除后由既有汇总流程懒重建
  const affected = changes.flatMap((change) => [change.oldOrder, change.newOrder])
  const lo = Math.min(...affected)
  const hi = Math.max(...affected)
  tx.delete(SegmentSummaryTable)
    .where(
      and(
        eq(SegmentSummaryTable.novel_id, novelId),
        lte(SegmentSummaryTable.start_chapter, hi),
        gte(SegmentSummaryTable.end_chapter, lo),
      ),
    )
    .run()
  // 快照 payload 内嵌前序章旧号，受影响章删行，下章审批时经 rebuildNextChapterSnapshot 重建
  tx.delete(MemoryInjectionSnapshotTable)
    .where(
      and(
        eq(MemoryInjectionSnapshotTable.novel_id, novelId),
        inArray(
          MemoryInjectionSnapshotTable.chapter_id,
          changes.map((change) => change.chapterId),
        ),
      ),
    )
    .run()
}

/** 旧号→新号映射；存量重号库中同一旧号多章时取先者（按号表无法区分归属，为可接受残留）。 */
function uniquePairs(changes: ChapterOrderChange[]): Map<number, number> {
  const pairs = new Map<number, number>()
  for (const change of changes) {
    if (!pairs.has(change.oldOrder)) pairs.set(change.oldOrder, change.newOrder)
  }
  return pairs
}

function shiftNumberField(
  tx: Tx,
  table: SQLiteTable,
  novelId: string,
  novelIdColumn: AnySQLiteColumn,
  numberColumn: AnySQLiteColumn,
  pairs: ReadonlyMap<number, number>,
): void {
  const olds = [...pairs.keys()]
  tx.update(table)
    .set({ [numberColumn.name]: sql`-${numberColumn} - 1` })
    .where(and(eq(novelIdColumn, novelId), inArray(numberColumn, olds)))
    .run()
  for (const [oldOrder, newOrder] of pairs) {
    tx.update(table)
      .set({ [numberColumn.name]: newOrder })
      .where(and(eq(novelIdColumn, novelId), eq(numberColumn, -oldOrder - 1)))
      .run()
  }
}

/** 重建该书的章节摘要检索行（先删后 INSERT-SELECT，同步 DDL 建表时的回填写法）。 */
function rebuildChapterFts(tx: Tx, novelId: string): void {
  tx.run(sql`DELETE FROM chapter_summary_fts WHERE novel_id = ${novelId}`)
  tx.run(sql`
    INSERT INTO chapter_summary_fts(novel_id, chapter_id, chapter_order, title, body)
    SELECT c.novel_id, s.chapter_id, c."order", c.title, COALESCE(s.summary, '') || ' ' || COALESCE(s.key_events, '[]')
    FROM chapter_summaries s
    JOIN chapters c ON c.id = s.chapter_id
    WHERE c.novel_id = ${novelId}
  `)
}
