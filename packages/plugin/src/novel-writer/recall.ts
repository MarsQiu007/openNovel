/**
 * 历史召回模块 — 按本章大纲相关性召回历史章节摘要
 *
 * 三路混合召回：
 * 1. 实体重叠（最高权重）：通过 entity_refs 反查引用了相同实体的历史章节
 * 2. FTS5 短语检索：在 chapter_summary_fts 上用大纲关键短语检索
 * 3. 伏笔强制召回：本章涉及的伏笔，若埋设章不在最近 3 章则强制召回
 *
 * 2 字专名（人名等）由实体召回兜底（scanReferences 用 indexOf 精确匹配，
 * 不依赖分词）；FTS5 trigram 负责 3 字以上短语。
 */

import { eq, and, inArray, sql } from "drizzle-orm"
import {
  getDb,
  EntityRefTable,
  ChapterTable,
  ChapterSummaryTable,
  CharacterTable,
  WorldEntryTable,
  PlotThreadTable,
  ForeshadowingTable,
} from "./session-store.js"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { RecalledHistoryItem, WorldEntrySummary, WorldEntryIndexItem, ContextPacket } from "./context.js"
import { assembleSnapshot } from "./context.js"
import { applyBudget } from "./budget.js"

// ─── 类型定义 ───

/** 从大纲文本中提取的提及实体 */
type MentionedEntities = {
  characterIds: string[]
  worldEntryIds: string[]
  plotThreadIds: string[]
  foreshadowIds: string[]
  /** 用于 FTS 查询的 3-8 字中文关键短语 */
  keyPhrases: string[]
  /** 所有命中的实体名（用于标注 matchedEntities） */
  names: string[]
}

/** 召回所需的 DB 行数据 */
type RecalledChapterRow = {
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  summary: string
  keyEvents: string[]
  matchedBy: "entity" | "fts" | "foreshadow"
  matchedEntities: string[]
  score: number
}

// ─── 大纲实体提取 ───

/**
 * 从大纲文本中提取提及的实体 ID 和关键短语。
 *
 * 用各实体表的 name/title 做 indexOf 精确匹配（与 scanReferences 一致）。
 */
export async function extractMentionedEntities(
  db: ReturnType<typeof getDb>,
  novelId: string,
  outlineText: string,
): Promise<MentionedEntities> {
  const [characters, worldEntries, plotThreads, foreshadows] = await Promise.all([
    db.select({ id: CharacterTable.id, name: CharacterTable.name }).from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all(),
    db.select({ id: WorldEntryTable.id, title: WorldEntryTable.title }).from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, novelId)).all(),
    db.select({ id: PlotThreadTable.id, title: PlotThreadTable.title }).from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all(),
    db.select({ id: ForeshadowingTable.id, content: ForeshadowingTable.content }).from(ForeshadowingTable).where(eq(ForeshadowingTable.novel_id, novelId)).all(),
  ])

  const result: MentionedEntities = {
    characterIds: [],
    worldEntryIds: [],
    plotThreadIds: [],
    foreshadowIds: [],
    keyPhrases: [],
    names: [],
  }

  const text = outlineText
  for (const c of characters) {
    if (c.name.length >= 2 && text.includes(c.name)) {
      result.characterIds.push(c.id)
      result.names.push(c.name)
    }
  }
  for (const w of worldEntries) {
    if (w.title.length >= 2 && text.includes(w.title)) {
      result.worldEntryIds.push(w.id)
      result.names.push(w.title)
    }
  }
  for (const p of plotThreads) {
    if (p.title.length >= 2 && text.includes(p.title)) {
      result.plotThreadIds.push(p.id)
      result.names.push(p.title)
    }
  }
  for (const f of foreshadows) {
    // 伏笔按 content 前 20 字做模糊匹配
    const snippet = f.content.slice(0, 20)
    if (snippet.length >= 3 && text.includes(snippet)) {
      result.foreshadowIds.push(f.id)
      result.names.push(snippet)
    }
  }

  // 提取 3-8 字中文关键短语（去掉标点、停用词后按句子切分）
  result.keyPhrases = extractKeyPhrases(text, result.names)

  return result
}

/**
 * 从大纲文本中提取用于 FTS 查询的关键短语。
 * 取 3-8 字的中文片段，过滤纯标点和过短片段。
 */
function extractKeyPhrases(text: string, knownNames: string[]): string[] {
  const phrases = new Set<string>()
  // 已知实体名直接作为短语（>= 3 字的）
  for (const name of knownNames) {
    if (name.length >= 3) phrases.add(name)
  }
  // 按标点切句，取每句中 3-8 字的中文片段
  const sentences = text.split(/[，。！？、；：\n\r,.;:!?\-\—\(\)\[\]{}""''\s]+/).filter(Boolean)
  for (const s of sentences) {
    const chinese = s.match(/[\u4e00-\u9fff]{3,8}/g)
    if (chinese) {
      for (const c of chinese) {
        phrases.add(c)
      }
    }
  }
  return [...phrases].slice(0, 12)
}

// ─── 三路召回 ───

/**
 * 执行三路混合召回，返回去重排序后的历史章节摘要。
 *
 * @param db 数据库连接
 * @param novelId 小说 ID
 * @param currentChapterOrder 当前章节序号（排除最近 N 章，它们已在 P2）
 * @param mentioned 从大纲提取的提及实体
 * @param recentChapterOrders 最近章节序号集合（已在 P2 中，不重复召回）
 * @param limit 最多返回条数
 */
export async function runRecall(
  db: ReturnType<typeof getDb>,
  novelId: string,
  currentChapterOrder: number,
  mentioned: MentionedEntities,
  recentChapterOrders: Set<number>,
  limit = 7,
): Promise<RecalledHistoryItem[]> {
  const candidates = new Map<string, RecalledChapterRow>()

  // 第 1 路：实体重叠
  await recallByEntityRefs(db, novelId, currentChapterOrder, mentioned, recentChapterOrders, candidates)

  // 第 2 路：FTS5 短语检索
  await recallByFts(db, novelId, currentChapterOrder, mentioned.keyPhrases, recentChapterOrders, candidates)

  // 第 3 路：伏笔强制召回
  await recallByForeshadow(db, novelId, currentChapterOrder, mentioned.foreshadowIds, recentChapterOrders, candidates)

  // 排序：score 降序，同分时章节近的优先
  const sorted = [...candidates.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.chapterOrder - a.chapterOrder
  })

  // 填充摘要内容
  const top = sorted.slice(0, limit)
  const chapterIds = top.map((c) => c.chapterId)
  if (chapterIds.length === 0) return []

  const summaries = await db
    .select()
    .from(ChapterSummaryTable)
    .where(inArray(ChapterSummaryTable.chapter_id, chapterIds))
    .all()
  const summaryMap = new Map(summaries.map((s) => [s.chapter_id, s]))

  return top.map((c) => {
    const s = summaryMap.get(c.chapterId)
    const keyEvents = Array.isArray(s?.key_events) ? s.key_events.map(String) : []
    return {
      chapterOrder: c.chapterOrder,
      chapterTitle: c.chapterTitle,
      summary: s?.summary ?? "",
      keyEvents,
      matchedBy: c.matchedBy,
      matchedEntities: c.matchedEntities,
      score: c.score,
    }
  })
}

/** 第 1 路：通过 entity_refs 反查引用了相同实体的历史章节 */
async function recallByEntityRefs(
  db: ReturnType<typeof getDb>,
  novelId: string,
  currentChapterOrder: number,
  mentioned: MentionedEntities,
  recentChapterOrders: Set<number>,
  candidates: Map<string, RecalledChapterRow>,
): Promise<void> {
  const targetIds = [...mentioned.characterIds, ...mentioned.worldEntryIds, ...mentioned.plotThreadIds]
  if (targetIds.length === 0) return

  const refs = await db
    .select({
      source_id: EntityRefTable.source_id,
      target_id: EntityRefTable.target_id,
      target_type: EntityRefTable.target_type,
    })
    .from(EntityRefTable)
    .where(
      and(
        eq(EntityRefTable.novel_id, novelId),
        eq(EntityRefTable.source_type, "chapter"),
        inArray(EntityRefTable.target_id, targetIds),
      ),
    )
    .all()

  // 按章节分组统计重叠实体数
  const chapterHits = new Map<string, { targetIds: Set<string>; targetNames: string[] }>()
  const idToName = new Map<string, string>()
  let nameIndex = 0
  for (const ids of [mentioned.characterIds, mentioned.worldEntryIds, mentioned.plotThreadIds]) {
    for (const id of ids) idToName.set(id, mentioned.names[nameIndex++] ?? "")
  }
  for (const ref of refs) {
    const existing = chapterHits.get(ref.source_id) ?? { targetIds: new Set<string>(), targetNames: [] }
    if (!existing.targetIds.has(ref.target_id)) {
      existing.targetIds.add(ref.target_id)
      existing.targetNames.push(idToName.get(ref.target_id) ?? ref.target_id.slice(0, 6))
    }
    chapterHits.set(ref.source_id, existing)
  }

  // 查章节元信息
  const chapterIds = [...chapterHits.keys()]
  if (chapterIds.length === 0) return
  const chapters = await db
    .select({ id: ChapterTable.id, "order": ChapterTable.order, title: ChapterTable.title })
    .from(ChapterTable)
    .where(inArray(ChapterTable.id, chapterIds))
    .all()

  const cutoff = recentChapterOrders.size > 0 ? Math.max(...recentChapterOrders) : currentChapterOrder
  for (const ch of chapters) {
    if (recentChapterOrders.has(ch.order) || ch.order >= cutoff) continue
    const hit = chapterHits.get(ch.id)
    if (!hit) continue
    const overlapCount = hit.targetIds.size
    // 时效衰减：越近权重越高，每远离一章衰减 5%
    const distance = Math.max(1, cutoff - ch.order)
    const recencyBoost = Math.max(0.3, 1 - distance * 0.05)
    const score = overlapCount * 10 * recencyBoost

    mergeCandidate(candidates, {
      chapterId: ch.id,
      chapterOrder: ch.order,
      chapterTitle: ch.title,
      summary: "",
      keyEvents: [],
      matchedBy: "entity",
      matchedEntities: hit.targetNames,
      score,
    })
  }
}

/** 第 2 路：FTS5 trigram 短语检索 */
async function recallByFts(
  db: ReturnType<typeof getDb>,
  novelId: string,
  currentChapterOrder: number,
  keyPhrases: string[],
  recentChapterOrders: Set<number>,
  candidates: Map<string, RecalledChapterRow>,
): Promise<void> {
  const validPhrases = keyPhrases.filter((p) => p.length >= 3)
  if (validPhrases.length === 0) return
  const cutoff = recentChapterOrders.size > 0 ? Math.max(...recentChapterOrders) : currentChapterOrder

  for (const phrase of validPhrases.slice(0, 6)) {
    try {
      const rows = db.all(
        sql`SELECT chapter_id, chapter_order, title, rank FROM chapter_summary_fts WHERE novel_id = ${novelId} AND body MATCH ${phrase} ORDER BY rank LIMIT 5`,
      ) as Array<{ chapter_id: string; chapter_order: number; title: string; rank: number }>

      for (const row of rows) {
        if (recentChapterOrders.has(row.chapter_order) || row.chapter_order >= cutoff) continue
        // FTS rank 越小越相关（BM25），转为正分
        const score = Math.max(1, 10 - Math.abs(row.rank))
        mergeCandidate(candidates, {
          chapterId: row.chapter_id,
          chapterOrder: row.chapter_order,
          chapterTitle: row.title,
          summary: "",
          keyEvents: [],
          matchedBy: "fts",
          matchedEntities: [phrase],
          score: score * 0.8,
        })
      }
    } catch {
      // FTS 查询失败（表不存在/查询语法），静默降级
    }
  }
}

/** 第 3 路：伏笔强制召回埋设章 */
async function recallByForeshadow(
  db: ReturnType<typeof getDb>,
  novelId: string,
  currentChapterOrder: number,
  foreshadowIds: string[],
  recentChapterOrders: Set<number>,
  candidates: Map<string, RecalledChapterRow>,
): Promise<void> {
  if (foreshadowIds.length === 0) return
  const cutoff = recentChapterOrders.size > 0 ? Math.max(...recentChapterOrders) : currentChapterOrder

  const foreshadows = await db
    .select({ id: ForeshadowingTable.id, content: ForeshadowingTable.content, planted_chapter_id: ForeshadowingTable.planted_chapter_id })
    .from(ForeshadowingTable)
    .where(inArray(ForeshadowingTable.id, foreshadowIds))
    .all()

  for (const f of foreshadows) {
    if (!f.planted_chapter_id) continue
    const [ch] = await db
      .select({ id: ChapterTable.id, "order": ChapterTable.order, title: ChapterTable.title })
      .from(ChapterTable)
      .where(eq(ChapterTable.id, f.planted_chapter_id))
      .limit(1)
      .all()
    if (!ch || recentChapterOrders.has(ch.order) || ch.order >= cutoff) continue

    mergeCandidate(candidates, {
      chapterId: ch.id,
      chapterOrder: ch.order,
      chapterTitle: ch.title,
      summary: "",
      keyEvents: [],
      matchedBy: "foreshadow",
      matchedEntities: [f.content.slice(0, 15)],
      score: 50, // 强制高优先级
    })
  }
}

/** 合并候选：同章节取最高分和并集 matchedEntities */
function mergeCandidate(
  candidates: Map<string, RecalledChapterRow>,
  row: RecalledChapterRow,
): void {
  const existing = candidates.get(row.chapterId)
  if (!existing) {
    candidates.set(row.chapterId, { ...row })
    return
  }
  existing.score = Math.max(existing.score, row.score)
  existing.matchedEntities = [...new Set([...existing.matchedEntities, ...row.matchedEntities])]
  // 如果已有 entity 召回，保留 entity 标记
  if (existing.matchedBy === "entity" || row.matchedBy === "foreshadow") {
    existing.matchedBy = row.matchedBy === "foreshadow" ? "foreshadow" : existing.matchedBy
  }
}

// ─── P5 世界观相关性筛选 ───

/**
 * 从全量 worldEntries 中筛选本章核心设定。
 *
 * 信号：
 * 1. 章纲文本中 indexOf 匹配 title
 * 2. 出场角色的 entity_refs（character description 引用的 world_entry）
 * 3. 最近章节 entity_refs 引用的 world_entry（延续性）
 */
export async function selectRelevantWorldEntries(
  db: ReturnType<typeof getDb>,
  novelId: string,
  allEntries: WorldEntrySummary[],
  outlineText: string,
  activeCharacterIds: string[],
  recentChapterIds: string[],
): Promise<{ core: WorldEntrySummary[]; index: WorldEntryIndexItem[] }> {
  const relevantIds = new Set<string>()

  // 信号 1：章纲匹配
  for (const entry of allEntries) {
    if (entry.title.length >= 2 && outlineText.includes(entry.title)) {
      relevantIds.add(entry.id)
    }
  }

  // 信号 2：角色描述引用的 world_entry
  if (activeCharacterIds.length > 0) {
    const charRefs = await db
      .select({ target_id: EntityRefTable.target_id })
      .from(EntityRefTable)
      .where(
        and(
          eq(EntityRefTable.novel_id, novelId),
          eq(EntityRefTable.source_type, "character"),
          inArray(EntityRefTable.source_id, activeCharacterIds),
          eq(EntityRefTable.target_type, "world_entry"),
        ),
      )
      .all()
    for (const ref of charRefs) relevantIds.add(ref.target_id)
  }

  // 信号 3：最近章节引用的 world_entry
  if (recentChapterIds.length > 0) {
    const chapterRefs = await db
      .select({ target_id: EntityRefTable.target_id })
      .from(EntityRefTable)
      .where(
        and(
          eq(EntityRefTable.novel_id, novelId),
          eq(EntityRefTable.source_type, "chapter"),
          inArray(EntityRefTable.source_id, recentChapterIds),
          eq(EntityRefTable.target_type, "world_entry"),
        ),
      )
      .all()
    for (const ref of chapterRefs) relevantIds.add(ref.target_id)
  }

  const core = allEntries.filter((e) => relevantIds.has(e.id))
  const index: WorldEntryIndexItem[] = allEntries
    .filter((e) => !relevantIds.has(e.id))
    .map((e) => ({ category: e.category, title: e.title }))

  return { core, index }
}

// ─── recall_history 工具查询 ───

/**
 * 按自然语言查询召回历史章节（recall_history 工具的核心）。
 *
 * @param scope summary=返回摘要, snippet=返回正文匹配片段
 */
export async function recallByQuery(
  db: ReturnType<typeof getDb>,
  novelId: string,
  query: string,
  limit: number,
  scope: "summary" | "snippet",
): Promise<Array<{ chapterNumber: number; chapterTitle: string; snippet: string; score: number; matchedBy: string }>> {
  const results: Array<{ chapterNumber: number; chapterTitle: string; snippet: string; score: number; matchedBy: string }> = []

  if (query.length >= 3) {
    // FTS 检索摘要
    try {
      const rows = db.all(
        sql`SELECT c.chapter_id, c.chapter_order, c.title, c.body, rank FROM chapter_summary_fts c WHERE c.novel_id = ${novelId} AND c.body MATCH ${query} ORDER BY rank LIMIT ${limit}`,
      ) as Array<{ chapter_id: string; chapter_order: number; title: string; body: string; rank: number }>
      for (const row of rows) {
        if (scope === "snippet") {
          const [chapter] = await db
            .select({ content: ChapterTable.content })
            .from(ChapterTable)
            .where(eq(ChapterTable.id, row.chapter_id))
            .limit(1)
            .all()
          const snippet = extractSnippet(chapter?.content ?? "", query)
          results.push({ chapterNumber: row.chapter_order, chapterTitle: row.title, snippet, score: Math.abs(row.rank), matchedBy: "fts" })
        } else {
          results.push({ chapterNumber: row.chapter_order, chapterTitle: row.title, snippet: row.body.slice(0, 300), score: Math.abs(row.rank), matchedBy: "fts" })
        }
      }
    } catch {
      // FTS 失败，降级到实体名称匹配
    }
  }

  // 短查询或 FTS 无结果时，用实体名匹配 entity_refs
  if (results.length === 0) {
    const entities = await Promise.all([
      db.select({ id: CharacterTable.id, name: CharacterTable.name }).from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all(),
      db.select({ id: WorldEntryTable.id, title: WorldEntryTable.title }).from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, novelId)).all(),
    ])
    const matchedNames = [...entities[0], ...entities[1]].filter((e) => {
      const name = "name" in e ? e.name : e.title
      return name.length >= 2 && query.includes(name)
    })

    if (matchedNames.length > 0) {
      const targetIds = matchedNames.map((e) => e.id)
      const refs = await db
        .select({ source_id: EntityRefTable.source_id })
        .from(EntityRefTable)
        .where(
          and(
            eq(EntityRefTable.novel_id, novelId),
            eq(EntityRefTable.source_type, "chapter"),
            inArray(EntityRefTable.target_id, targetIds),
          ),
        )
        .all()
      const chapterIds = [...new Set(refs.map((r) => r.source_id))].slice(0, limit)
      if (chapterIds.length > 0) {
        const chapters = await db
          .select({ id: ChapterTable.id, "order": ChapterTable.order, title: ChapterTable.title, content: ChapterTable.content })
          .from(ChapterTable)
          .where(inArray(ChapterTable.id, chapterIds))
          .all()
        for (const ch of chapters) {
          const snippet = scope === "snippet" ? extractSnippet(ch.content, query) : ""
          results.push({ chapterNumber: ch.order, chapterTitle: ch.title, snippet, score: 1, matchedBy: "entity" })
        }
      }
    }
  }

  return results.slice(0, limit)
}

/** 在正文中提取 query 周围各 200 字的片段 */
function extractSnippet(content: string, query: string): string {
  if (!content) return ""
  const idx = content.indexOf(query)
  if (idx < 0) return content.slice(0, 400)
  const start = Math.max(0, idx - 200)
  const end = Math.min(content.length, idx + query.length + 200)
  return (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "")
}
// ─── 写作快照组装（assembleSnapshot + 召回 + 预算） ───

/**
 * 读章节大纲 Markdown 文件。
 * directory 是项目根，DB 在 directory/.novel/novel.db，大纲在 directory/.novel/outlines/。
 */
function readChapterOutlineFile(directory: string | null | undefined, chapterNumber: number): string | null {
  const base = directory ?? process.cwd()
  const filePath = join(base, ".novel", "outlines", `chapter-${chapterNumber}.md`)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, "utf-8")
    // 空模板（含"待填写"占位符）视为无有效大纲
    if (raw.includes("（待填写）") && raw.length < 2000) return null
    return raw
  } catch {
    return null
  }
}

/**
 * 组装写作专用快照：assembleSnapshot 原始数据 → 章纲读取 → 实体提取 →
 * 三路召回 → P5 相关性筛选 → 预算裁剪。
 *
 * assemble_context_snapshot 工具调用此函数，injectSystemContext 仍用
 * 轻量的 assembleSnapshot（标题导览，无召回）。
 */
export async function assembleWriterSnapshot(
  novelId: string,
  chapterNumber: number,
  directory?: string | null,
): Promise<ContextPacket | null> {
  const db = getDb(directory)
  const raw = await assembleSnapshot(novelId, chapterNumber, directory)
  if (!raw) return null

  // 读章纲文件
  const chapterOutline = readChapterOutlineFile(directory ?? null, chapterNumber)

  // 召回查询文本：有章纲用章纲，否则用 synopsis + open 线索标题 + 角色名
  const queryText =
    chapterOutline ??
    [raw.synopsis, ...raw.plotThreads.map((t) => t.title), ...raw.activeCharacters.map((c) => c.name)].join(" ")

  const mentioned = await extractMentionedEntities(db, novelId, queryText)

  // P1: 出场角色筛选（有命中则只列出场角色，否则保留全部）
  const allChars = await db
    .select({ id: CharacterTable.id, name: CharacterTable.name })
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .all()
  const activeCharacterIds = mentioned.characterIds
  if (activeCharacterIds.length > 0) {
    const mentionedNames = new Set(
      activeCharacterIds.flatMap((id) => allChars.filter((c) => c.id === id).map((c) => c.name)),
    )
    raw.activeCharacters = raw.activeCharacters.filter((c) => mentionedNames.has(c.name))
  }

  // 收集最近章节 ID 和序号（P2 已有，召回排除这些）
  const recentOrders = new Set(raw.recentChapterSummaries.map((c) => c.chapterOrder))
  const recentChapters = await db
    .select({ id: ChapterTable.id, "order": ChapterTable.order })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), inArray(ChapterTable.order, [...recentOrders])))
    .all()
  const recentChapterIds = recentChapters.map((c) => c.id)

  // P6: 三路召回
  raw.recalledHistory = await runRecall(db, novelId, chapterNumber, mentioned, recentOrders, 7)

  // P5: 世界观相关性筛选
  const { core, index } = await selectRelevantWorldEntries(
    db,
    novelId,
    raw.worldEntries,
    queryText,
    activeCharacterIds,
    recentChapterIds,
  )
  raw.worldEntries = core
  raw.worldEntryIndex = index

  // P5: 关系只保留出场角色相关的
  if (activeCharacterIds.length > 0) {
    const activeCharNames = new Set(raw.activeCharacters.map((c) => c.name))
    raw.relationships = raw.relationships.filter(
      (r) => activeCharNames.has(r.charAName) || activeCharNames.has(r.charBName),
    )
  }

  // P5: volumeList 只保留当前卷 ± 1
  const currentVolumeOrder = raw.volumeSummary ? findCurrentVolumeOrder(raw.volumeList, raw.volumeSummary) : null
  if (currentVolumeOrder != null) {
    raw.volumeList = raw.volumeList.filter(
      (v) => Math.abs(v.order - currentVolumeOrder) <= 1,
    )
  }

  raw.chapterOutline = chapterOutline

  // 预算裁剪
  return applyBudget(raw)
}

function findCurrentVolumeOrder(
  volumeList: ContextPacket["volumeList"],
  volumeSummary: string,
): number | null {
  for (const v of volumeList) {
    if (v.summary === volumeSummary) return v.order
  }
  return null
}