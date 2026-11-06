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
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm"
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import {
  AnnotationRoundTable,
  AnnotationTable,
  ArcBeatTable,
  ChapterReviewTable,
  ChapterSummaryTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterStateTable,
  EntityRefTable,
  ForeshadowingTable,
  HookRotationTable,
  MemoryInjectionSnapshotTable,
  NovelStateLogTable,
  SegmentSummaryTable,
  StoryArcTable,
  StorySpineEntryTable,
  TechniqueShadowLogTable,
  TensionLogTable,
  VolumeTable,
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

// ─── 章纲落位（design D3：跳号拒绝下沉插入路径） ───

/** 章纲落位结果：gap = 前置章缺失须先补（拒绝生成）；reused / created 均含章 ID。 */
export type ChapterSlotResult =
  | { kind: "reused"; chapterId: string }
  | { kind: "created"; chapterId: string }
  | { kind: "gap"; missingOrder: number }

/** 跳号拒绝的 typed error：工具层据 missingOrder 翻译为用户可读指引。 */
export class ChapterSequenceGapError extends Error {
  readonly missingOrder: number
  constructor(missingOrder: number) {
    super(`章节序号跳号：第 ${missingOrder} 章记录不存在，须先补前置章`)
    this.name = "ChapterSequenceGapError"
    this.missingOrder = missingOrder
  }
}

export interface ChapterSlotInput {
  novelId: string
  /** 目标章节序号（从 1 开始） */
  order: number
  /** 章标题；缺省按「第N章」落库 */
  title?: string
  /** 调用方已解析的落卷（章纲流程经 ensureVolume 保证非空） */
  volumeId: string
  /** 是否显式指定卷号：决定复用记录的 volume_id 回写分支（保持既有工具语义） */
  hasExplicitVolume: boolean
}

/**
 * 章纲生成落位（组合形态）：跳号校验 → 按 (novel_id, order) 查重 → 复用更新或插入，事务内执行。
 *
 * 跳号校验报告 [1, N) 的**首个**缺口（存量脏库下 N-1 之外可能还有更早缺口，报最早缺失章
 * 才能顺序补齐）；N-1 存在即视为连续，跨卷连续号合法（卷归属不参与序号约束）。
 */
export function resolveChapterSlotTx(tx: Tx, input: ChapterSlotInput): ChapterSlotResult {
  if (input.order < 1) throw new Error(`章节序号非法：${input.order}（须从 1 开始）`)
  const below = tx
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, input.novelId), lt(ChapterTable.order, input.order)))
    .all()
  const present = new Set(below.map((row) => row.order))
  for (let order = 1; order < input.order; order++) {
    if (!present.has(order)) return { kind: "gap", missingOrder: order }
  }
  const title = input.title ?? `第${input.order}章`
  const existing = tx
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, input.novelId), eq(ChapterTable.order, input.order)))
    .get()
  if (existing) {
    const shouldRename = input.title !== undefined && input.title !== existing.title
    if (shouldRename || input.hasExplicitVolume) {
      tx.update(ChapterTable)
        .set({
          ...(shouldRename ? { title, status: "outline" } : {}),
          volume_id: input.volumeId,
          updated_at: Date.now(),
        })
        .where(eq(ChapterTable.id, existing.id))
        .run()
    }
    return { kind: "reused", chapterId: existing.id }
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  tx.insert(ChapterTable)
    .values({
      id,
      novel_id: input.novelId,
      volume_id: input.volumeId,
      title,
      content: "",
      word_count: 0,
      status: "outline",
      order: input.order,
      created_at: now,
      updated_at: now,
    })
    .run()
  return { kind: "created", chapterId: id }
}

/** 章纲落位（自包形态）：跳号校验、查重、插入单事务完成。 */
export function resolveChapterSlot(input: ChapterSlotInput, directory?: string | null): ChapterSlotResult {
  return withTransaction(getDb(directory), (tx) => resolveChapterSlotTx(tx, input))
}

// ─── 统一删除帮手（design D4：工具与服务端接口共用，消除两条删除路径分叉） ───

export interface ChapterDeletion {
  novelId: string
  oldOrder: number
  /** 删除引发的补位是否作废了 running 批量（调用方据此提示重新登记） */
  batchCancelled: boolean
}

/**
 * 删除章节（组合形态）：解锚 → 级联清理 → 删章 → 补位重排与派生同步，全部单事务。
 *
 * - 解锚先行：弧线节拍/故事主线保留条目但清空章号（FK SET NULL 会清 chapter_id，
 *   必须先于删章按 chapter_id 定位清号，杜绝孤儿旧号被 syncArcProgress 错配）；
 * - 级联覆盖既有插件工具的全部清理面（版本/摘要/评审/角色状态/状态日志/钩子轮值/
 *   实体引用/批注×2/伏笔置空/张力按旧号删），快照与检索行随章删除（relocate 的
 *   重建只覆盖幸存章，末章删除等空 changes 场景不会触达）；
 * - 删章后走 relocate 补位重排：幸存章 -1 且派生表同步新号。
 */
export function deleteChapterTx(tx: Tx, chapterId: string): ChapterDeletion {
  const chapter = tx.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  tx.update(ArcBeatTable).set({ chapter_order: null }).where(eq(ArcBeatTable.chapter_id, chapterId)).run()
  tx.update(StorySpineEntryTable).set({ chapter_order: null }).where(eq(StorySpineEntryTable.chapter_id, chapterId)).run()
  tx.delete(ChapterVersionTable).where(eq(ChapterVersionTable.chapter_id, chapterId)).run()
  tx.delete(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapterId)).run()
  tx.delete(ChapterReviewTable).where(eq(ChapterReviewTable.chapter_id, chapterId)).run()
  tx.delete(CharacterStateTable).where(eq(CharacterStateTable.chapter_id, chapterId)).run()
  tx.delete(NovelStateLogTable).where(eq(NovelStateLogTable.chapter_id, chapterId)).run()
  tx.delete(HookRotationTable).where(eq(HookRotationTable.chapter_id, chapterId)).run()
  tx.delete(EntityRefTable)
    .where(and(eq(EntityRefTable.source_type, "chapter"), eq(EntityRefTable.source_id, chapterId)))
    .run()
  tx.delete(AnnotationTable)
    .where(and(eq(AnnotationTable.target_type, "chapter"), eq(AnnotationTable.target_id, chapterId)))
    .run()
  tx.delete(AnnotationRoundTable)
    .where(and(eq(AnnotationRoundTable.target_type, "chapter"), eq(AnnotationRoundTable.target_id, chapterId)))
    .run()
  tx.update(ForeshadowingTable).set({ planted_chapter_id: null }).where(eq(ForeshadowingTable.planted_chapter_id, chapterId)).run()
  tx.update(ForeshadowingTable).set({ resolved_chapter_id: null }).where(eq(ForeshadowingTable.resolved_chapter_id, chapterId)).run()
  tx.delete(TensionLogTable)
    .where(and(eq(TensionLogTable.novel_id, chapter.novel_id), eq(TensionLogTable.chapter_number, chapter.order)))
    .run()
  // technique_shadow_log 与张力同形按旧号记账：不删则旧号重指派后检索归属张冠李戴
  tx.delete(TechniqueShadowLogTable)
    .where(and(eq(TechniqueShadowLogTable.novel_id, chapter.novel_id), eq(TechniqueShadowLogTable.chapter_number, chapter.order)))
    .run()
  tx.delete(MemoryInjectionSnapshotTable).where(eq(MemoryInjectionSnapshotTable.chapter_id, chapterId)).run()
  tx.run(sql`DELETE FROM chapter_summary_fts WHERE chapter_id = ${chapterId}`)
  tx.delete(ChapterTable).where(eq(ChapterTable.id, chapterId)).run()
  const result = relocateChaptersTx(tx, chapter.novel_id, { kind: "remove", afterOrder: chapter.order })
  return { novelId: chapter.novel_id, oldOrder: chapter.order, batchCancelled: result.batchCancelled }
}

/** 删除章节（自包形态）：级联清理、补位重排、派生同步单事务完成。 */
export function deleteChapterWithSequence(chapterId: string, directory?: string | null): ChapterDeletion {
  return withTransaction(getDb(directory), (tx) => deleteChapterTx(tx, chapterId))
}

// ─── 移卷与同卷交换（design D2：全书单事务重排收口 relocate 原语） ───

/**
 * 移动章节（组合形态）：to-volume 落到目标卷阅读末位，up/down 同卷相邻交换，均走 relocate。
 *
 * - 落点在摘出后计算（目标卷末章不含被移章）：目标卷非空 → 末章 + 1；空卷回退卷序更近的
 *   前一个有章卷末章 + 1，前无卷则为 1；
 * - 移到「未分组」仅改归属保号，不重排、不触碰派生表；同卷/组界无交换对象均为 no-op；
 * - 重排部分整体收口 relocateChaptersTx：补位、派生同步、running 批量作废一并完成。
 */
export function moveChapterTx(
  tx: Tx,
  chapterId: string,
  action: "up" | "down" | "to-volume",
  volumeId: string | undefined,
): typeof ChapterTable.$inferSelect {
  const chapter = tx.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)

  if (action === "to-volume") {
    if (volumeId == null) {
      if (chapter.volume_id == null) return chapter
      tx.update(ChapterTable)
        .set({ volume_id: null, updated_at: Date.now() })
        .where(eq(ChapterTable.id, chapterId))
        .run()
      return tx.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
    }
    if (volumeId === chapter.volume_id) return chapter
    const volume = tx.select().from(VolumeTable).where(eq(VolumeTable.id, volumeId)).get()
    if (!volume || volume.novel_id !== chapter.novel_id) throw new Error(`Volume not found: ${volumeId}`)
    const targetOrder = landingOrderInVolume(tx, chapter, volume)
    tx.update(ChapterTable)
      .set({ volume_id: volumeId, updated_at: Date.now() })
      .where(eq(ChapterTable.id, chapterId))
      .run()
    relocateChaptersTx(tx, chapter.novel_id, { kind: "move", chapterId, targetOrder })
    return tx.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
  }

  const group = tx
    .select()
    .from(ChapterTable)
    .where(
      chapter.volume_id
        ? and(eq(ChapterTable.novel_id, chapter.novel_id), eq(ChapterTable.volume_id, chapter.volume_id))
        : and(eq(ChapterTable.novel_id, chapter.novel_id), isNull(ChapterTable.volume_id)),
    )
    .orderBy(asc(ChapterTable.order))
    .all()
  const index = group.findIndex((c) => c.id === chapterId)
  const swapWith = action === "up" ? group[index - 1] : group[index + 1]
  if (!swapWith) return chapter
  relocateChaptersTx(tx, chapter.novel_id, { kind: "move", chapterId, targetOrder: swapWith.order })
  return tx.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
}

/** 落点 = 目标卷末章序号 + 1（摘出后口径：高于原位的章先 -1 再取末位）；目标卷为空时
 * 回退卷序更近的前一个有章卷，前无卷则为 1。 */
function landingOrderInVolume(
  tx: Tx,
  chapter: typeof ChapterTable.$inferSelect,
  volume: typeof VolumeTable.$inferSelect,
): number {
  const targetMax = maxChapterOrderInVolume(tx, chapter, volume.id)
  if (targetMax !== undefined) return targetMax + 1
  const earlier = tx
    .select()
    .from(VolumeTable)
    .where(and(eq(VolumeTable.novel_id, chapter.novel_id), lt(VolumeTable.order, volume.order)))
    .orderBy(desc(VolumeTable.order))
    .all()
  for (const prev of earlier) {
    const max = maxChapterOrderInVolume(tx, chapter, prev.id)
    if (max !== undefined) return max + 1
  }
  return 1
}

/** 卷内排除被移章后的末位序号，按摘出口径折算（高于被移章原号的先 -1 补位）。 */
function maxChapterOrderInVolume(
  tx: Tx,
  chapter: typeof ChapterTable.$inferSelect,
  volumeId: string,
): number | undefined {
  const rows = tx
    .select({ id: ChapterTable.id, order: ChapterTable.order })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, chapter.novel_id), eq(ChapterTable.volume_id, volumeId)))
    .all()
  return rows.reduce<number | undefined>((max, row) => {
    if (row.id === chapter.id) return max
    const effective = row.order > chapter.order ? row.order - 1 : row.order
    return max === undefined || effective > max ? effective : max
  }, undefined)
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
