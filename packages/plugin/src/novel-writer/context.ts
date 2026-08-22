/**
 * 快照组装模块 — 从DB读取小说状态并组装上下文快照
 *
 * 这是层级压缩系统的核心，为 AI 写作提供结构化的上下文数据包。
 * 目标：第100章时快照控制在 8K tokens 以内。
 *
 * 导出：
 * - ContextPacket 类型 — 快照数据结构
 * - assembleSnapshot(novelId, chapterNumber) — 组装快照的主函数
 *
 * 遵循 novel-writer.ts 和 governance.ts 中的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and, lte, desc, sql } from "drizzle-orm"
import type { RetrievedTechnique } from "./technique.js"
import {
  getDb,
  NovelTable,
  VolumeTable,
  ChapterTable,
  CharacterTable,
  CharacterStateTable,
  RelationshipTable,
  PlotThreadTable,
  ForeshadowingTable,
  ChapterSummaryTable,
  VolumeSummaryTable,
  StyleGuideTable,
  WorldEntryTable,
  StoryArcTable,
  ArcBeatTable,
} from "./session-store.js"

/**
 * 解析 style_guide.rules 为对象。
 *
 * rules 列是 json 模式，但历史数据存在双重编码（库里存了 JSON 字符串的字符串），
 * 读取时可能拿到对象也可能拿到 JSON 字符串，这里统一兼容。
 */
export function parseStyleRules(rules: unknown): Record<string, unknown> {
  if (rules == null) return {}
  if (typeof rules === "string") {
    try {
      const parsed: unknown = JSON.parse(rules)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  if (typeof rules === "object") return rules as Record<string, unknown>
  return {}
}

// ─── 类型定义 ───

/** 活跃角色信息 */
export type ActiveCharacter = {
  /** 角色名 */
  name: string
  /** 角色定位（主角/配角/反派等） */
  role: string
  /** 角色描述 */
  description: string
  /** 当前所在位置 */
  location: string
  /** 当前情绪 */
  mood: string
  /** 当前状态摘要 */
  summary: string
}

/** 剧情线索摘要 */
export type PlotThreadSummary = {
  /** 线索标题 */
  title: string
  /** 线索状态（open/resolved/paused） */
  status: string
  /** 优先级（high/medium/low） */
  priority: string
  /** 线索描述 */
  description: string
}

/** 伏笔摘要 */
export type ForeshadowingSummary = {
  /** 伏笔 ID */
  id: string
  /** 伏笔内容 */
  content: string
  /** 伏笔状态（planted/resolved） */
  state: string
  /** 埋设章节 ID */
  plantedChapterId: string | null
}

/** 章节摘要条目 */
export type ChapterSummaryItem = {
  /** 章节序号 */
  chapterOrder: number
  /** 章节标题 */
  chapterTitle: string
  /** 摘要内容 */
  summary: string
  /** 关键事件列表 */
  keyEvents: string[]
}

/** 世界观条目摘要 */
export type WorldEntrySummary = {
  /** 条目 ID */
  id: string
  /** 分类（如：社会制度/力量体系/势力/地理/科技/文化/生物/核心设定） */
  category: string
  /** 条目标题 */
  title: string
  /** 条目完整内容（writer 的硬约束来源） */
  content: string
}

/** 召回的历史章节摘要 */
export type RecalledHistoryItem = {
  /** 章节序号 */
  chapterOrder: number
  /** 章节标题 */
  chapterTitle: string
  /** 摘要内容 */
  summary: string
  /** 关键事件 */
  keyEvents: string[]
  /** 召回途径：entity / fts / foreshadow */
  matchedBy: "entity" | "fts" | "foreshadow"
  /** 匹配到的实体名或查询词 */
  matchedEntities: string[]
  /** 召回得分（越高越相关） */
  score: number
}

/** 世界观导览条目（非核心设定，仅标题） */
export type WorldEntryIndexItem = {
  category: string
  title: string
}

/** 卷纲摘要 */
export type VolumeListItem = {
  /** 卷序号 */
  order: number
  /** 卷标题 */
  title: string
  /** 卷摘要 */
  summary: string
}

/** 关系摘要 */
export type RelationshipSummary = {
  /** 关系类型 */
  type: string
  /** 关系描述 */
  description: string
  /** 角色 A 名称 */
  charAName: string
  /** 角色 B 名称 */
  charBName: string
}

/** 弧光节点摘要 */
export type ArcBeatSummary = {
  label: string
  kind: string
  status: string
  chapterOrder: number | null
  summary: string
}

/** 结构线/弧光摘要 */
export type StoryArcSummary = {
  id: string
  arcType: string
  title: string
  summary: string
  status: string
  targetCharacterName: string | null
  plannedStartChapter: number | null
  plannedEndChapter: number | null
  beats: ArcBeatSummary[]
}

/** 风格指南信息 */
export type StyleGuideInfo = {
  /** 写作风格规则（JSON 对象） */
  rules: Record<string, unknown>
  /** 语气基调 */
  tone: string
  /** 叙述视角 */
  pov: string
  /** 时态 */
  tense: string
}

/**
 * 上下文快照数据包
 *
 * 按优先级分层组装，目标在 ch100 时 under 8K tokens：
 * - P0 蓝图（约1K）：小说名、题材、梗概
 * - P1 活跃角色（约1.5K）：当前活跃角色及其状态
 * - P2 卷+3章摘要（约2K）：当前卷摘要 + 最近3章摘要
 * - P3 线索+伏笔（约2K）：剧情线索和伏笔
 * - P4 风格+规则（约1.5K）：风格指南和题材规则
 * - P5 世界观硬约束（约2K）：worldEntries + volumeList + relationships（writer 必须严格遵守的权威来源）
 */
export type ContextPacket = {
  /** P0: 小说蓝图 */
  novelTitle: string
  genre: string
  synopsis: string

  /** P1: 活跃角色（已过滤 dormant / departed 角色） */
  activeCharacters: ActiveCharacter[]

  /** P1b: 已退场角色名（director 不再安排出场，但历史章节提及仍然有效） */
  departedCharacters: string[]

  /** P2: 卷摘要 + 最近3章摘要 */
  volumeSummary: string | null
  recentChapterSummaries: ChapterSummaryItem[]

  /** P3: 剧情线索 + 伏笔 */
  plotThreads: PlotThreadSummary[]
  foreshadowing: ForeshadowingSummary[]

  /** P3b: 当前章节相关的结构线/弧光及其节点 */
  activeArcs: StoryArcSummary[]

  /** P4: 风格指南 + 题材规则 */
  styleGuide: StyleGuideInfo | null
  genreRules: string[]

  /** P5: 世界观硬约束（writer 创作的权威来源，仅核心相关条目，已裁剪） */
  worldEntries: WorldEntrySummary[]
  volumeList: VolumeListItem[]
  relationships: RelationshipSummary[]

  /** P5 导览：非核心世界观条目（仅分类+标题），需要全文时调用 recall_history */
  worldEntryIndex: WorldEntryIndexItem[]

  /** P6: 按本章大纲相关性召回的历史章节摘要 */
  recalledHistory: RecalledHistoryItem[]

  /** 本章大纲 Markdown 原文（来自 .novel/outlines/chapter-{n}.md），截断 1.5K */
  chapterOutline: string | null

  /** 上一章结尾原文（约600字），writer 必须承接其后展开，严禁重复前文已发生的内容 */
  prevChapterTail: string | null

  /** 目标字数下限（style_guide.rules.chapter_length），writer 不得低于此字数 */
  targetWordCount: number | null

  /** P7: 技法检索结果（shadow mode 阶段不注入 prompt） */
  techniques: RetrievedTechnique[]
}

// ─── 题材 → 文件模块名映射 ───

/** 中文题材名到模块文件名的映射 */
const GENRE_MODULE_MAP: Record<string, string> = {
  玄幻: "xuanhuan",
  都市: "dushi",
  仙侠: "xianxia",
  历史: "lishi",
  科幻: "kehuan",
  悬疑: "xuanyi",
  言情: "yanqing",
  游戏: "youxi",
}

// ─── 导出函数 ───

/**
 * 加载当前章节相关的结构线/弧光及其节点。
 *
 * 选取规则：
 * - completed/abandoned 的弧光不注入；
 * - 有章节区间的弧光，区间覆盖本章附近（前后各 3/5 章）才注入；
 * - 没有章节区间的弧光，仅当 status=active（作者明确标记进行中）才注入，
 *   planned 且无区间的远期规划不占用每章 prompt；
 * - 弧光总数和每弧光节点数均有上限，避免长篇规划数据导致 prompt 无界膨胀。
 */
const MAX_ACTIVE_ARCS = 12
const MAX_BEATS_PER_ARC = 8

export async function loadActiveArcs(
  db: ReturnType<typeof getDb>,
  novelId: string,
  chapterNumber: number,
  charIdToName: Map<string, string>,
): Promise<StoryArcSummary[]> {
  const allArcs = await db
    .select()
    .from(StoryArcTable)
    .where(eq(StoryArcTable.novel_id, novelId))
    .all()
  const allBeats = await db
    .select()
    .from(ArcBeatTable)
    .where(eq(ArcBeatTable.novel_id, novelId))
    .all()
  const beatsByArc = new Map<string, typeof allBeats[number][]>()
  for (const beat of allBeats) {
    const list = beatsByArc.get(beat.arc_id) ?? []
    list.push(beat)
    beatsByArc.set(beat.arc_id, list)
  }

  type ScoredArc = { arc: typeof allArcs[number]; score: number }
  const scored: ScoredArc[] = []
  for (const arc of allArcs) {
    if (arc.status === "completed" || arc.status === "abandoned") continue
    const start = arc.planned_start_chapter ?? arc.actual_start_chapter
    const end = arc.planned_end_chapter ?? arc.actual_end_chapter
    if (start == null && end == null) {
      // 无区间：只注入进行中的；规划中的远期弧不进每章上下文
      if (arc.status !== "active") continue
      scored.push({ arc, score: 1000 })
      continue
    }
    const s = start ?? chapterNumber
    const e = end ?? chapterNumber
    if (chapterNumber < s - 3 || chapterNumber > e + 3) continue
    // 越靠近区间中心/越在区间内，优先级越高
    const center = (s + e) / 2
    const distance = Math.abs(chapterNumber - center)
    scored.push({ arc, score: -distance })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ACTIVE_ARCS)
    .map(({ arc }) => {
      const beats = (beatsByArc.get(arc.id) ?? [])
        .map((b) => {
          const inWindow =
            b.chapter_order == null
              ? true
              : b.chapter_order >= chapterNumber - 3 && b.chapter_order <= chapterNumber + 5
          // 排序键：窗口内已锚定节点按章节号升序，未锚定节点排在后面
          const sortKey = b.chapter_order == null ? Number.POSITIVE_INFINITY : b.chapter_order
          return { b, inWindow, sortKey }
        })
        .filter((x) => x.inWindow)
        .sort((a, b) => a.sortKey - b.sortKey)
        .slice(0, MAX_BEATS_PER_ARC)
        .map(({ b }) => ({
          label: b.label,
          kind: b.kind,
          status: b.status,
          chapterOrder: b.chapter_order,
          summary: b.summary,
        }))
      return {
        id: arc.id,
        arcType: arc.arc_type,
        title: arc.title,
        summary: arc.summary,
        status: arc.status,
        targetCharacterName: arc.target_character_id ? charIdToName.get(arc.target_character_id) ?? null : null,
        plannedStartChapter: arc.planned_start_chapter,
        plannedEndChapter: arc.planned_end_chapter,
        beats,
      }
    })
}

/**
 * 组装小说上下文快照
 *
 * 从数据库读取小说状态，按层级组装成结构化的上下文数据包，
 * 供 AI 写作时使用，确保上下文在 token 预算内。
 *
 * @param novelId 小说 ID
 * @param chapterNumber 当前章节序号（用于定位和查找最近摘要）
 * @returns 结构化上下文快照，小说不存在时返回 null
 */
export async function assembleSnapshot(
  novelId: string,
  chapterNumber: number,
  directory?: string | null,
): Promise<ContextPacket | null> {
  const db = getDb(directory)

  // ── P0: 小说蓝图 ──
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) return null

  // ── 查找当前章节和所在卷 ──
  const [currentChapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber)))
    .all()

  let volumeSummary: string | null = null
  if (currentChapter?.volume_id) {
    const [vs] = await db
      .select()
      .from(VolumeSummaryTable)
      .where(eq(VolumeSummaryTable.volume_id, currentChapter.volume_id))
      .all()
    volumeSummary = vs?.summary ?? null
  }

  // ── P1: 活跃角色（过滤 dormant 角色） ──
  const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()

  const activeCharacters: ActiveCharacter[] = []
  const departedCharacters: string[] = []
  if (characters.length > 0) {
    const charIds = characters.map((c) => c.id)
    // 逐个查询每个角色的最新状态，过滤 active = 1
    for (const char of characters) {
      // 已退场角色不进活跃列表，但记录名字告知 director 不要再安排出场
      if (char.status === "departed") {
        departedCharacters.push(char.name)
        continue
      }
      const [latestState] = await db
        .select()
        .from(CharacterStateTable)
        .where(eq(CharacterStateTable.character_id, char.id))
        .orderBy(desc(sql`rowid`))
        .limit(1)
        .all()
      if (latestState && latestState.active === 1) {
        activeCharacters.push({
          name: char.name,
          role: char.role,
          description: char.description,
          location: latestState.location,
          mood: latestState.mood,
          summary: latestState.summary,
        })
      }
    }
  }

  // ── P2: 最近3章摘要 ──
  const recentChapters = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), lte(ChapterTable.order, chapterNumber)))
    .orderBy(desc(ChapterTable.order))
    .limit(3)
    .all()

  const recentChapterSummaries: ChapterSummaryItem[] = []
  for (const ch of recentChapters) {
    const [cs] = await db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, ch.id)).all()
    const keyEvents: string[] = Array.isArray(cs?.key_events) ? cs.key_events.map(String) : []
    recentChapterSummaries.push({
      chapterOrder: ch.order,
      chapterTitle: ch.title,
      summary: cs?.summary ?? "",
      keyEvents,
    })
  }
  // 按 order 升序排列（从旧到新）
  recentChapterSummaries.sort((a, b) => a.chapterOrder - b.chapterOrder)

  // ── P3: 剧情线索 + 伏笔 ──
  const plotThreads = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()

  const foreshadowingEntries = await db
    .select()
    .from(ForeshadowingTable)
    .where(eq(ForeshadowingTable.novel_id, novelId))
    .all()

  // ── P5: 世界观硬约束（writer 创作的权威来源） ──
  // 等级称谓、力量体系、制度名称、势力名等一切世界观细节
  // 全部以 worldEntries 为唯一来源，禁止 LLM 自创或调用题材模板硬编码。
  const worldEntries = await db
    .select()
    .from(WorldEntryTable)
    .where(eq(WorldEntryTable.novel_id, novelId))
    .all()

  const volumeList = await db
    .select()
    .from(VolumeTable)
    .where(eq(VolumeTable.novel_id, novelId))
    .orderBy(VolumeTable.order)
    .all()

  // 关系：拉关系 + 用 character_id 解析名字
  const relationshipRows = await db
    .select()
    .from(RelationshipTable)
    .where(eq(RelationshipTable.novel_id, novelId))
    .all()
  const charIdToName = new Map(characters.map((c) => [c.id, c.name]))
  const relationships: RelationshipSummary[] = relationshipRows.map((r) => ({
    type: r.type,
    description: r.description,
    charAName: charIdToName.get(r.char_a_id) ?? "(未知角色)",
    charBName: charIdToName.get(r.char_b_id) ?? "(未知角色)",
  }))

  // ── P3b: 当前章节相关的结构线/弧光 ──
  const activeArcs = await loadActiveArcs(db, novelId, chapterNumber, charIdToName)

  // ── P4: 风格指南 + 题材规则 ──
  const [styleGuideRow] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all()

  const genreRules = await loadGenreRules(novel.genre)

  // ── 上一章结尾原文：writer 必须承接其后，防止重写已演过的场景 ──
  const [prevChapter] = await db
    .select({ content: ChapterTable.content })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber - 1)))
    .all()
  const prevChapterTail = prevChapter && prevChapter.content.length > 0 ? prevChapter.content.slice(-600) : null

  // ── 目标字数下限：style_guide.rules.chapter_length ──
  const rawTarget = parseStyleRules(styleGuideRow?.rules).chapter_length
  const parsedTarget = Number(rawTarget)
  const targetWordCount = Number.isFinite(parsedTarget) && parsedTarget > 0 ? Math.floor(parsedTarget) : null

  // ── P7: 技法检索（shadow mode - 只记录，不注入 writer prompt） ──
  let techniques: RetrievedTechnique[] = []
  try {
    const { queryTechniques, recordShadowLog } = await import("./technique-store.js")
    const sceneType = inferSceneType(currentChapter?.title ?? "", novel.synopsis)
    techniques = await queryTechniques({ sceneType, contextText: currentChapter?.title ?? "", limit: 5 }, directory)

    if (techniques.length > 0) {
      await recordShadowLog(
        {
          id: `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          novelId,
          chapterNumber,
          sceneType,
          queryText: (currentChapter?.title ?? "").slice(0, 200),
          retrievedTechniqueIds: techniques.map((t) => t.entry.id),
          retrievedTechniqueNames: techniques.map((t) => t.entry.name),
          createdAt: Date.now(),
        },
        directory,
      )
    }
  } catch {
    // 技法库不可用时静默降级，不影响正常写作
    techniques = []
  }

  return {
    novelTitle: novel.title,
    genre: novel.genre,
    synopsis: novel.synopsis,

    activeCharacters,
    departedCharacters,

    volumeSummary,
    recentChapterSummaries,

    plotThreads: plotThreads.map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      description: t.description,
    })),
    foreshadowing: foreshadowingEntries.map((f) => ({
      id: f.id,
      content: f.content,
      state: f.state,
      plantedChapterId: f.planted_chapter_id,
    })),

    styleGuide: styleGuideRow
      ? {
          rules: (styleGuideRow.rules as Record<string, unknown>) ?? {},
          tone: styleGuideRow.tone,
          pov: styleGuideRow.pov,
          tense: styleGuideRow.tense,
        }
      : null,
    genreRules,

    // P5: 世界观硬约束
    worldEntries: worldEntries.map((w) => ({
      id: w.id,
      category: w.category,
      title: w.title,
      content: w.content,
    })),
    volumeList: volumeList.map((v) => ({
      order: v.order,
      title: v.title,
      summary: v.summary,
    })),
    relationships,
    activeArcs,
    worldEntryIndex: [],
    recalledHistory: [],
    chapterOutline: null,

    prevChapterTail,
    targetWordCount,
    techniques,
  }
}

function inferSceneType(chapterTitle: string, synopsis: string): string {
  const text = `${chapterTitle} ${synopsis}`
  if (/战斗|冲突|对决|打斗|交战/.test(text)) return "action"
  if (/对话|谈判|交谈|质问/.test(text)) return "dialogue"
  if (/描写|环境|风景|氛围/.test(text)) return "description"
  if (/悬念|谜团|线索|伏笔/.test(text)) return "suspense"
  if (/情感|回忆|内心|情绪/.test(text)) return "emotion_shift"
  if (/过渡|转场|时间流逝/.test(text)) return "transition"
  return "general"
}

/**
 * 加载题材模板的规则
 *
 * 从题材模板文件中动态导入 rules 数组。
 * 如果题材不在映射表中或导入失败，返回空数组。
 *
 * @param genre 中文题材名
 * @returns 规则字符串数组
 */
async function loadGenreRules(genre: string): Promise<string[]> {
  const moduleName = GENRE_MODULE_MAP[genre]
  if (!moduleName) return []

  try {
    const mod = (await import(`./genres/${moduleName}.js`)) as { rules?: readonly string[] }
    if (mod.rules && Array.isArray(mod.rules)) {
      return mod.rules.map(String)
    }
  } catch {
    // 题材模板文件不存在或导入失败，返回空数组
  }

  return []
}
