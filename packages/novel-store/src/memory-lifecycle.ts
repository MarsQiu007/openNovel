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
import { ChapterTable, MemoryFactTable, type Db } from "./index.js"
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
