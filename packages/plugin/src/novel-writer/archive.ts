/**
 * 归档查询工具 — 查询休眠角色、已关闭线索和历史卷摘要
 *
 * 提供三个查询函数：
 * - lookupDormantCharacters — 查询休眠角色
 * - lookupClosedThreads — 查询已关闭线索
 * - lookupPastVolumes — 查询历史卷摘要
 *
 * 所有查询只返回摘要信息（不返回完整内容），每个查询最多返回3条记录。
 * 遵循 novel-writer.ts 的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and, like, desc, lt, inArray, sql } from "drizzle-orm"
import {
  getDb,
  CharacterTable,
  CharacterStateTable,
  ChapterTable,
  EntityRefTable,
  MemoryFactTable,
  PlotThreadTable,
  VolumeTable,
  VolumeSummaryTable,
  WorldEntryTable,
} from "./session-store.js"

// ─── 导出类型 ───

/** 角色摘要 */
export interface CharacterSummary {
  id: string
  /** 角色名 */
  name: string
  /** 状态摘要 */
  summary: string
}

/** 线索摘要 */
export interface ThreadSummary {
  id: string
  /** 线索标题 */
  title: string
  /** 线索描述 */
  summary: string
}

/** 卷摘要 */
export interface VolumeSummary {
  id: string
  /** 卷标题 */
  title: string
  /** 卷摘要 */
  summary: string
}

// ─── 导出函数 ───

/**
 * 查询休眠角色
 *
 * 查找小说中处于休眠状态（active = false）的角色，
 * 最多返回3条记录。只返回摘要信息（id, name, summary）。
 *
 * @param novelId 小说 ID
 * @param query 搜索关键词（匹配角色名）
 * @returns 休眠角色摘要列表
 */
export async function lookupDormantCharacters(
  novelId: string,
  query: string,
  directory?: string | null,
): Promise<CharacterSummary[]> {
  const db = getDb(directory)

  // 查询该小说中所有有休眠状态记录的角色 ID
  const dormantRows = await db
    .select({ character_id: CharacterStateTable.character_id })
    .from(CharacterStateTable)
    .innerJoin(CharacterTable, eq(CharacterStateTable.character_id, CharacterTable.id))
    .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterStateTable.active, 0)))
    .all()

  if (dormantRows.length === 0) return []

  // 去重后的角色 ID 列表
  const uniqueIds = [...new Set(dormantRows.map((r) => r.character_id))]

  // 按角色名模糊匹配
  const characters = await db
    .select()
    .from(CharacterTable)
    .where(
      and(
        eq(CharacterTable.novel_id, novelId),
        inArray(CharacterTable.id, uniqueIds),
        like(CharacterTable.name, `%${query}%`),
      ),
    )
    .limit(3)
    .all()

  if (characters.length === 0) return []

  // 获取每个角色的最新休眠状态摘要
  const results: CharacterSummary[] = []
  for (const char of characters) {
    const [latestState] = await db
      .select()
      .from(CharacterStateTable)
      .where(and(eq(CharacterStateTable.character_id, char.id), eq(CharacterStateTable.active, 0)))
      .orderBy(desc(CharacterStateTable.id))
      .limit(1)
      .all()

    results.push({
      id: char.id,
      name: char.name,
      summary: latestState?.summary ?? char.description,
    })
  }

  return results
}

/**
 * 查询已关闭线索
 *
 * 查找小说中已关闭的剧情线索，最多返回3条记录。
 * 只返回摘要信息（id, title, summary）。
 *
 * @param novelId 小说 ID
 * @param query 搜索关键词（匹配线索标题）
 * @returns 已关闭线索摘要列表
 */
export async function lookupClosedThreads(
  novelId: string,
  query: string,
  directory?: string | null,
): Promise<ThreadSummary[]> {
  const db = getDb(directory)

  const threads = await db
    .select()
    .from(PlotThreadTable)
    .where(
      and(
        eq(PlotThreadTable.novel_id, novelId),
        eq(PlotThreadTable.status, "closed"),
        like(PlotThreadTable.title, `%${query}%`),
      ),
    )
    .limit(3)
    .all()

  return threads.map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.description,
  }))
}

/**
 * 查询历史卷摘要
 *
 * 查找指定卷号之前的历史卷摘要，最多返回3条记录（按卷号降序，最近优先）。
 * 只返回摘要信息（id, title, summary）。
 *
 * @param novelId 小说 ID
 * @param volumeNumber 当前卷号（返回比此卷号小的历史卷）
 * @returns 历史卷摘要列表
 */
export async function lookupPastVolumes(
  novelId: string,
  volumeNumber: number,
  directory?: string | null,
): Promise<VolumeSummary[]> {
  const db = getDb(directory)

  const volumes = await db
    .select()
    .from(VolumeTable)
    .where(and(eq(VolumeTable.novel_id, novelId), lt(VolumeTable.order, volumeNumber)))
    .orderBy(desc(VolumeTable.order))
    .limit(3)
    .all()

  if (volumes.length === 0) return []

  // 获取卷摘要
  const volumeIds = volumes.map((v) => v.id)
  const summaries = await db
    .select()
    .from(VolumeSummaryTable)
    .where(inArray(VolumeSummaryTable.volume_id, volumeIds))
    .all()

  const summaryMap = new Map(summaries.map((s) => [s.volume_id, s.summary]))

  return volumes.map((v) => ({
    id: v.id,
    title: v.title,
    summary: summaryMap.get(v.id) ?? v.summary,
  }))
}

// ─── 记忆检索（agent-memory-system §5.2） ───

/** 记忆事实摘要（检索召回返回单元） */
export interface MemoryFactSummary {
  id: string
  factType: string
  text: string
  quote: string | null
  status: string
  chapterId: string | null
  chapterOrder: number | null
}

/** memory_search 结构化过滤条件；limit 默认 3（librarian 纪律），可按需放宽 */
export interface MemorySearchFilters {
  factType?: string
  status?: string
  entityHint?: string
  /** 章节序号范围（含边界） */
  chapterFrom?: number
  chapterTo?: number
  limit?: number
}

/**
 * 记忆全文检索：memory_fact_fts 全文（text + quote，trigram 分词）+ 结构化过滤。
 *
 * 章节摘要全文检索已由 recall_history 覆盖，本函数只查 memory_fact（避免双检索面）。
 * 结果按章节序号降序（近因优先），limit 条。
 */
export async function memorySearch(
  novelId: string,
  query: string,
  filters: MemorySearchFilters = {},
  directory?: string | null,
): Promise<MemoryFactSummary[]> {
  const db = getDb(directory)
  const limit = filters.limit ?? 3

  // bun 驱动下 db.all(sql``) 同步返回数组
  const hitRows = db.all(
    sql`SELECT fact_id FROM memory_fact_fts WHERE memory_fact_fts MATCH ${query} AND novel_id = ${novelId}`,
  )
  const hits = hitRows.flatMap((row) =>
    typeof row === "object" && row !== null && "fact_id" in row ? [String(row.fact_id)] : [],
  )
  if (hits.length === 0) return []

  const conditions = [inArray(MemoryFactTable.id, hits), eq(MemoryFactTable.novel_id, novelId)]
  if (filters.factType) conditions.push(eq(MemoryFactTable.fact_type, filters.factType))
  if (filters.status) conditions.push(eq(MemoryFactTable.status, filters.status))
  if (filters.entityHint) conditions.push(eq(MemoryFactTable.entity_hint, filters.entityHint))

  const rows = await db
    .select({
      id: MemoryFactTable.id,
      factType: MemoryFactTable.fact_type,
      text: MemoryFactTable.text,
      quote: MemoryFactTable.quote,
      status: MemoryFactTable.status,
      chapterId: MemoryFactTable.chapter_id,
      chapterOrder: ChapterTable.order,
    })
    .from(MemoryFactTable)
    .leftJoin(ChapterTable, eq(ChapterTable.id, MemoryFactTable.chapter_id))
    .where(and(...conditions))
    .all()

  return rows
    .filter(
      (row) =>
        (filters.chapterFrom === undefined || (row.chapterOrder !== null && row.chapterOrder >= filters.chapterFrom)) &&
        (filters.chapterTo === undefined || (row.chapterOrder !== null && row.chapterOrder <= filters.chapterTo)),
    )
    .sort((a, b) => (b.chapterOrder ?? 0) - (a.chapterOrder ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
}

/** 实体全史（memory_lookup 返回单元） */
export interface MemoryEntityHistory {
  entityId: string
  /** 实体形态：character / world_entry / hint_only（仅记忆事实提及） */
  kind: "character" | "world_entry" | "hint_only"
  title: string
  /** 关联记忆事实（entity_hint 命中，按章节降序） */
  facts: MemoryFactSummary[]
  /** 出现章节（entity_refs 引用 + 角色状态记录，按章节序号升序） */
  appearances: Array<{ chapterId: string; chapterOrder: number; source: string }>
}

/**
 * 实体全史查询：回答"某实体在哪几章出现过、关联哪些记忆事实"。
 *
 * entityId 兼容角色 ID / 世界观条目 ID / entity_hint 提示串；三个数据源合并：
 * characters/world_entries 本体、memory_fact（entity_hint）、entity_refs（章节引用）。
 */
export async function memoryLookup(
  novelId: string,
  entityId: string,
  limit = 10,
  directory?: string | null,
): Promise<MemoryEntityHistory | null> {
  const db = getDb(directory)

  const [character] = await db
    .select()
    .from(CharacterTable)
    .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.id, entityId)))
    .limit(1)
    .all()
  const [entry] = character
    ? []
    : await db
        .select()
        .from(WorldEntryTable)
        .where(and(eq(WorldEntryTable.novel_id, novelId), eq(WorldEntryTable.id, entityId)))
        .limit(1)
        .all()
  const kind = character ? "character" : entry ? "world_entry" : "hint_only"
  const title = character?.name ?? entry?.title ?? entityId

  const facts = await db
    .select({
      id: MemoryFactTable.id,
      factType: MemoryFactTable.fact_type,
      text: MemoryFactTable.text,
      quote: MemoryFactTable.quote,
      status: MemoryFactTable.status,
      chapterId: MemoryFactTable.chapter_id,
      chapterOrder: ChapterTable.order,
    })
    .from(MemoryFactTable)
    .leftJoin(ChapterTable, eq(ChapterTable.id, MemoryFactTable.chapter_id))
    .where(and(eq(MemoryFactTable.novel_id, novelId), eq(MemoryFactTable.entity_hint, entityId)))
    .all()

  // 出现章节：entity_refs 中 chapter 来源的引用 + 角色的状态记录章
  const appearances = new Map<string, { chapterId: string; chapterOrder: number; source: string }>()
  const refs = await db
    .select({ chapterId: EntityRefTable.source_id, chapterOrder: ChapterTable.order, field: EntityRefTable.ref_field })
    .from(EntityRefTable)
    .innerJoin(ChapterTable, eq(ChapterTable.id, EntityRefTable.source_id))
    .where(
      and(
        eq(EntityRefTable.novel_id, novelId),
        eq(EntityRefTable.target_id, entityId),
        eq(EntityRefTable.source_type, "chapter"),
      ),
    )
    .all()
  for (const ref of refs) {
    appearances.set(ref.chapterId, { chapterId: ref.chapterId, chapterOrder: ref.chapterOrder, source: ref.field || "reference" })
  }
  if (character) {
    const states = await db
      .select({ chapterId: CharacterStateTable.chapter_id, chapterOrder: ChapterTable.order })
      .from(CharacterStateTable)
      .innerJoin(ChapterTable, eq(ChapterTable.id, CharacterStateTable.chapter_id))
      .where(eq(CharacterStateTable.character_id, character.id))
      .all()
    for (const state of states) {
      if (!appearances.has(state.chapterId)) {
        appearances.set(state.chapterId, { chapterId: state.chapterId, chapterOrder: state.chapterOrder, source: "character_state" })
      }
    }
  }

  if (!character && !entry && facts.length === 0 && appearances.size === 0) return null

  return {
    entityId,
    kind,
    title,
    facts: facts
      .sort((a, b) => (b.chapterOrder ?? 0) - (a.chapterOrder ?? 0) || (a.id < b.id ? -1 : 1))
      .slice(0, limit),
    appearances: [...appearances.values()].sort((a, b) => a.chapterOrder - b.chapterOrder).slice(0, limit),
  }
}
