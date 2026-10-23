/**
 * 记忆生命周期原语（agent-memory-system §3 状态机的挂钩落点）。
 *
 * 下沉 novel-store 的原因与 memory-injection 相同：章审批（server 路由）与
 * 写作工具（plugin）两条路径都要触发状态流转，存储层是双方唯一共同依赖。
 *
 * 状态机：pending → reviewed → approved → stale → （重新提取）/ retired（留痕不删行）。
 * FTS 索引不含 status 列，状态流转无需动 FTS。
 */

import { and, eq, gt, ne } from "drizzle-orm"
import { ChapterTable, CharacterTable, MemoryFactTable, TechniqueTable, WorldEntryTable, type Db } from "./index.js"
import { withTransaction, type Tx } from "./tx.js"
import { rebuildMemoryInjectionSnapshot } from "./memory-injection.js"

/**
 * 审计校准（§3）：章节评审提交后，本章 observer 提取的未决事实 pending → reviewed。
 * 返回流转条数。作者手记（created_by=author）不随审计流转。
 */
export function markChapterFactsReviewed(db: Db, novelId: string, chapterId: string): number {
  return withTransaction(db, (tx) => {
    const ids = tx
      .select({ id: MemoryFactTable.id })
      .from(MemoryFactTable)
      .where(
        and(
          eq(MemoryFactTable.novel_id, novelId),
          eq(MemoryFactTable.chapter_id, chapterId),
          eq(MemoryFactTable.status, "pending"),
          eq(MemoryFactTable.created_by, "observer"),
        ),
      )
      .all()
      .map((row) => row.id)
    if (ids.length === 0) return 0
    for (const id of ids) {
      tx
        .update(MemoryFactTable)
        .set({ status: "reviewed", updated_at: Date.now() })
        .where(eq(MemoryFactTable.id, id))
        .run()
    }
    return ids.length
  })
}

/**
 * 文本变更失效（§3 diff 范围语义）：章节正文改写后，逐字引句已不在正文中的
 * 事实 → stale。只失效引句命中的卡——无引句的事实无法定位，保持原状（防修订抖动）。
 * retired 行不动（留痕终态）。返回新失效的事实 id。
 */
export function invalidateChapterFactsByQuote(db: Db, novelId: string, chapterId: string, content: string): string[] {
  const rows = db
    .select({ id: MemoryFactTable.id, quote: MemoryFactTable.quote, status: MemoryFactTable.status })
    .from(MemoryFactTable)
    .where(and(eq(MemoryFactTable.novel_id, novelId), eq(MemoryFactTable.chapter_id, chapterId)))
    .all()
  const staleIds = rows
    .filter((row) => row.quote !== null && row.quote.length > 0 && row.status !== "retired" && !content.includes(row.quote))
    .map((row) => row.id)
  if (staleIds.length === 0) return []
  withTransaction(db, (tx) => {
    for (const id of staleIds) {
      tx
        .update(MemoryFactTable)
        .set({ status: "stale", updated_at: Date.now() })
        .where(eq(MemoryFactTable.id, id))
        .run()
    }
  })
  return staleIds
}

/**
 * 设定被删（§3 retired 留痕，组合形态）：entity_hint 指向该实体的事实 → retired，不删行。
 * 首参可为调用方事务对象：已被外层事务包裹时复用其事务，函数体同步、不得再开事务。
 * 返回留痕条数。
 */
export function retireFactsForEntityTx(scope: Db | Tx, novelId: string, entityHint: string): number {
  const ids = scope
    .select({ id: MemoryFactTable.id })
    .from(MemoryFactTable)
    .where(
      and(
        eq(MemoryFactTable.novel_id, novelId),
        eq(MemoryFactTable.entity_hint, entityHint),
        ne(MemoryFactTable.status, "retired"),
      ),
    )
    .all()
    .map((row) => row.id)
  for (const id of ids) {
    scope
      .update(MemoryFactTable)
      .set({ status: "retired", updated_at: Date.now() })
      .where(eq(MemoryFactTable.id, id))
      .run()
  }
  return ids.length
}

/** 设定被删（§3 retired 留痕，自包裹形态）：自开事务，供事务外的调用点使用。 */
export function retireFactsForEntity(db: Db, novelId: string, entityHint: string): number {
  return withTransaction(db, (tx) => retireFactsForEntityTx(tx, novelId, entityHint))
}

/**
 * 章审批通过（§2.4 预计算）：为下一章重建物化注入快照。
 * 下一章行不存在（本书已到末章）时 no-op 返回 false。
 */
export async function rebuildNextChapterSnapshot(db: Db, novelId: string, chapterId: string): Promise<boolean> {
  const [chapter] = await db
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.id, chapterId), eq(ChapterTable.novel_id, novelId)))
    .limit(1)
    .all()
  if (!chapter) return false
  const [next] = await db
    .select({ id: ChapterTable.id })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), gt(ChapterTable.order, chapter.order)))
    .orderBy(ChapterTable.order)
    .limit(1)
    .all()
  if (!next) return false
  return rebuildMemoryInjectionSnapshot(db, novelId, next.id)
}

// ─── §6 整理与维护 ───────────────────────────────────────────────────────────

/** 整理合并结果单元：保留卡 ID + 被并退休的卡 ID 清单 */
export interface ConsolidateGroup {
  kept: string
  retired: string[]
}

/** 横切确认级别排序：approved > reviewed > pending > stale（同级取最早创建、id 升序，确定性） */
const STATUS_RANK: Record<string, number> = { approved: 3, reviewed: 2, pending: 1, stale: 0 }

/**
 * 事件驱动整理（§6 主触发，组合形态）：章审批通过时本章相关卡去重合并。
 *
 * 自动 + 可撤销：只并剔除全部空白后文本相同的卡（中文稿空白无语义），语义级
 * 同义合并需模型判断、不在自动路径。被并卡 status → retired 且 retired_into
 * 指向保留卡（留痕不删行，可据此撤销还原）；retired 行不参与再分组（终态）。
 */
export function consolidateChapterFactsTx(scope: Db | Tx, novelId: string, chapterId: string): ConsolidateGroup[] {
  const rows = scope
    .select({
      id: MemoryFactTable.id,
      fact_type: MemoryFactTable.fact_type,
      entity_hint: MemoryFactTable.entity_hint,
      text: MemoryFactTable.text,
      status: MemoryFactTable.status,
      created_at: MemoryFactTable.created_at,
    })
    .from(MemoryFactTable)
    .where(
      and(
        eq(MemoryFactTable.novel_id, novelId),
        eq(MemoryFactTable.chapter_id, chapterId),
        ne(MemoryFactTable.status, "retired"),
      ),
    )
    .all()

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = JSON.stringify([row.fact_type, row.entity_hint ?? "", row.text.replace(/\s+/g, "")])
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }

  const merged: ConsolidateGroup[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort(
      (a, b) =>
        (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || a.created_at - b.created_at || (a.id < b.id ? -1 : 1),
    )
    const [kept, ...dupes] = sorted
    for (const dupe of dupes) {
      scope
        .update(MemoryFactTable)
        .set({ status: "retired", retired_into: kept.id, updated_at: Date.now() })
        .where(eq(MemoryFactTable.id, dupe.id))
        .run()
    }
    merged.push({ kept: kept.id, retired: dupes.map((d) => d.id) })
  }
  return merged
}

/** 事件驱动整理（§6，自包裹形态）：自开事务，供事务外的调用点使用。 */
export function consolidateChapterFacts(db: Db, novelId: string, chapterId: string): ConsolidateGroup[] {
  return withTransaction(db, (tx) => consolidateChapterFactsTx(tx, novelId, chapterId))
}

/** planned 滞留阈值：设定创建之后新增章数达到此值视为滞留（§6 定时兜底提醒口径） */
export const PLANNED_STALL_CHAPTER_THRESHOLD = 10

/** 维护报告（§6 定时兜底，报告制不自动删）：僵尸卡清单 + planned 滞留 + retired 归档统计 */
export interface MemoryMaintenanceReport {
  /** 僵尸卡：stale（失效未消化）的记忆事实，按章序升序 */
  zombieFacts: Array<{ id: string; chapterOrder: number | null; text: string }>
  /** planned 设定（角色 + 世界观条目）：按创建后新增章数降序，stalled 标记达到滞留阈值 */
  planned: Array<{ kind: "character" | "world_entry"; id: string; title: string; chaptersSince: number; stalled: boolean }>
  /** retired 归档统计（本书库口径；全局技法库不在本书 DB 内） */
  retiredStats: { facts: number; techniques: number }
}

/** 构建维护报告（§6）：纯读，不开事务。 */
export function buildMaintenanceReport(db: Db, novelId: string): MemoryMaintenanceReport {
  const zombieRows = db
    .select({ id: MemoryFactTable.id, text: MemoryFactTable.text, chapterOrder: ChapterTable.order })
    .from(MemoryFactTable)
    .leftJoin(ChapterTable, eq(MemoryFactTable.chapter_id, ChapterTable.id))
    .where(and(eq(MemoryFactTable.novel_id, novelId), eq(MemoryFactTable.status, "stale")))
    .all()
  const zombieFacts = zombieRows
    .map((row) => ({ id: row.id, chapterOrder: row.chapterOrder, text: row.text }))
    .sort((a, b) => (a.chapterOrder ?? Number.MAX_SAFE_INTEGER) - (b.chapterOrder ?? Number.MAX_SAFE_INTEGER))

  // 创建时间锚点：设定 planned 之后新增了几章（章数口径比自然日更贴合写作进度）
  const chapterCreatedAts = db
    .select({ created_at: ChapterTable.created_at })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .all()
    .map((row) => row.created_at)
  const chaptersSince = (createdAt: number) => chapterCreatedAts.filter((t) => t > createdAt).length

  const plannedCharacters = db
    .select({ id: CharacterTable.id, name: CharacterTable.name, created_at: CharacterTable.created_at })
    .from(CharacterTable)
    .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.establishment, "planned")))
    .all()
    .map((row) => ({ kind: "character" as const, id: row.id, title: row.name, created_at: row.created_at }))
  const plannedEntries = db
    .select({ id: WorldEntryTable.id, title: WorldEntryTable.title, created_at: WorldEntryTable.created_at })
    .from(WorldEntryTable)
    .where(and(eq(WorldEntryTable.novel_id, novelId), eq(WorldEntryTable.establishment, "planned")))
    .all()
    .map((row) => ({ kind: "world_entry" as const, id: row.id, title: row.title, created_at: row.created_at }))
  const planned = [...plannedCharacters, ...plannedEntries]
    .map((row) => {
      const since = chaptersSince(row.created_at)
      return { kind: row.kind, id: row.id, title: row.title, chaptersSince: since, stalled: since >= PLANNED_STALL_CHAPTER_THRESHOLD }
    })
    .sort((a, b) => b.chaptersSince - a.chaptersSince)

  const retiredFacts = db
    .select({ id: MemoryFactTable.id })
    .from(MemoryFactTable)
    .where(and(eq(MemoryFactTable.novel_id, novelId), eq(MemoryFactTable.status, "retired")))
    .all().length
  const retiredTechniques = db
    .select({ id: TechniqueTable.id })
    .from(TechniqueTable)
    .where(eq(TechniqueTable.status, "retired"))
    .all().length

  return { zombieFacts, planned, retiredStats: { facts: retiredFacts, techniques: retiredTechniques } }
}
