/**
 * 冲突单两方向影响成本对比（agent-memory-system §4）。
 *
 * 原则：已写正文 > 设定（读者只见正文）。系统摆成本，作者定方向——
 * - 方向 A（顺正文改设定/旧记忆）：受影响的记忆卡清单（动 N 张卡）
 * - 方向 B（逆设定改正文）：受影响章节清单（引用关系可查询，结构化存储的核心红利）
 *
 * 下沉 novel-store 的原因与 memory-injection 相同：冲突产生点（plugin state-commit）
 * 与裁决闸门（setting-review / server 可达的审批面）都要读同一份成本对比。
 */

import { and, eq, inArray, ne } from "drizzle-orm"
import { ChapterTable, EntityRefTable, MemoryFactTable, WorldEntryTable, type Db } from "./index.js"
import type { Tx } from "./tx.js"

export interface ConflictImpactChapter {
  id: string
  order: number
  title: string
}

export interface ConflictImpact {
  /** 方向 A（顺正文改设定）：受影响的记忆卡数与事实 ID 清单（含设定本体一张） */
  directionA: { cards: number; factIds: string[] }
  /** 方向 B（逆设定改正文）：受影响章节清单（章序升序） */
  directionB: { chapters: ConflictImpactChapter[] }
}

/**
 * 计算设定条目的两方向影响成本。scope 可为调用方事务对象（只读查询，不开事务）。
 * entity_hint 可能存条目 id 或标题（observer 未解析的原始引用），两种键都匹配；
 * retired 事实不计入（留痕终态，不再是活卡）。
 */
export function buildConflictImpact(scope: Db | Tx, novelId: string, entryId: string): ConflictImpact {
  const entry = scope
    .select({ title: WorldEntryTable.title })
    .from(WorldEntryTable)
    .where(eq(WorldEntryTable.id, entryId))
    .get()
  const hints = entry ? [entryId, entry.title] : [entryId]

  const facts = scope
    .select({ id: MemoryFactTable.id, chapter_id: MemoryFactTable.chapter_id })
    .from(MemoryFactTable)
    .where(
      and(
        eq(MemoryFactTable.novel_id, novelId),
        inArray(MemoryFactTable.entity_hint, hints),
        ne(MemoryFactTable.status, "retired"),
      ),
    )
    .all()

  // 方向 B 双源：entity_refs 的章节引用 ∪ 记忆事实所属章节
  const refChapters = scope
    .select({ id: ChapterTable.id, order: ChapterTable.order, title: ChapterTable.title })
    .from(EntityRefTable)
    .innerJoin(ChapterTable, eq(ChapterTable.id, EntityRefTable.source_id))
    .where(
      and(
        eq(EntityRefTable.novel_id, novelId),
        eq(EntityRefTable.target_type, "world_entry"),
        eq(EntityRefTable.target_id, entryId),
        eq(EntityRefTable.source_type, "chapter"),
      ),
    )
    .all()
  const factChapterIds = facts.flatMap((fact) => (fact.chapter_id ? [fact.chapter_id] : []))
  const factChapters =
    factChapterIds.length === 0
      ? []
      : scope
          .select({ id: ChapterTable.id, order: ChapterTable.order, title: ChapterTable.title })
          .from(ChapterTable)
          .where(and(eq(ChapterTable.novel_id, novelId), inArray(ChapterTable.id, factChapterIds)))
          .all()

  const seen = new Set<string>()
  const chapters = [...refChapters, ...factChapters]
    .filter((chapter) => {
      if (seen.has(chapter.id)) return false
      seen.add(chapter.id)
      return true
    })
    .sort((a, b) => a.order - b.order)

  return {
    directionA: { cards: facts.length + 1, factIds: facts.map((fact) => fact.id) },
    directionB: { chapters },
  }
}

/** 安全解析冲突单上的成本对比缓存；缺失或损坏时返回 null（调用方现算兜底）。 */
export function parseConflictImpact(impactJson: string): ConflictImpact | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(impactJson)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  if (!("directionA" in parsed) || !("directionB" in parsed)) return null
  const a = parsed.directionA
  const b = parsed.directionB
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return null
  if (!("cards" in a) || typeof a.cards !== "number") return null
  if (!("factIds" in a) || !Array.isArray(a.factIds)) return null
  if (!("chapters" in b) || !Array.isArray(b.chapters)) return null
  return parsed as ConflictImpact
}

/** 供裁决 B 复用：冲突单上缓存失效时现算受影响章节清单。 */
export function conflictImpactChapters(scope: Db | Tx, novelId: string, entryId: string, impactJson: string): ConflictImpactChapter[] {
  const cached = parseConflictImpact(impactJson)
  if (cached) return cached.directionB.chapters
  return buildConflictImpact(scope, novelId, entryId).directionB.chapters
}
