/**
 * 卷级汇总模块 — 实现层级压缩系统的核心逻辑
 *
 * 卷完结时生成卷摘要，标记角色 active/dormant，归档已关闭线索。
 * 卷长度由剧情决定：章节归属以 chapters.volume_id 为准，不做固定章数映射。
 * 导出两个核心函数：
 * - performVolumeRollup(novelId, volumeNumber) — 执行卷级汇总
 * - getEffectiveContext(novelId, chapterNumber) — 获取有效上下文（用卷摘要替代章摘要）
 *
 * 遵循 novel-writer.ts 和 context.ts 的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and, gte, lte, asc, desc, sql } from "drizzle-orm"
import {
  getDb,
  NovelTable,
  VolumeTable,
  ChapterTable,
  CharacterTable,
  CharacterStateTable,
  PlotThreadTable,
  ChapterSummaryTable,
  VolumeSummaryTable,
  ForeshadowingTable,
  StyleGuideTable,
} from "./session-store.js"
import { parseStyleRules, loadActiveArcs, type ContextPacket, type ActiveCharacter, type ChapterSummaryItem } from "./context.js"
import { ensureSegmentSummaries, listSegmentSummaries } from "./segment-rollup.js"

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
 * 执行卷级汇总
 *
 * 以 chapters.volume_id 归属为准（卷长度由剧情决定），生成卷摘要，标记角色 active/dormant，归档已关闭线索。
 * 将卷摘要记录写入 VolumeSummaryTable。
 *
 * @param novelId 小说 ID
 * @param volumeNumber 卷号（从1开始）
 * @returns 包含 volumeId 和 summaryId 的结果对象，卷不存在时返回 null
 */
export async function performVolumeRollup(
  novelId: string,
  volumeNumber: number,
  directory?: string | null,
): Promise<{ volumeId: string; summaryId: string } | null> {
  const db = getDb(directory)

  // 查找卷记录
  const [volume] = await db
    .select()
    .from(VolumeTable)
    .where(and(eq(VolumeTable.novel_id, novelId), eq(VolumeTable.order, volumeNumber)))
    .all()
  if (!volume) return null

  // 章节范围：以 chapters.volume_id 归属为准（卷长度由剧情决定）。
  const ownChapters = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.volume_id, volume.id)))
    .orderBy(ChapterTable.order)
    .all()
  let chapters = ownChapters
  // 兼容旧数据：本卷无归属章节、且算术范围内章节均未归属任何卷（volume_id IS NULL）时，
  // 才退回固定 50 章范围；若这些章节已归属他卷则不能挪用，空卷直接无可汇总内容。
  if (chapters.length === 0) {
    const legacy = await db
      .select()
      .from(ChapterTable)
      .where(
        and(
          eq(ChapterTable.novel_id, novelId),
          gte(ChapterTable.order, (volumeNumber - 1) * 50 + 1),
          lte(ChapterTable.order, volumeNumber * 50),
          sql`${ChapterTable.volume_id} IS NULL`,
        ),
      )
      .orderBy(ChapterTable.order)
      .all()
    if (legacy.length === 0) return null
    chapters = legacy
  }

  // 获取章节摘要
  const chapterSummaries: Record<string, { summary: string; keyEvents: string[] }> = {}
  if (chapters.length > 0) {
    const chapterIds = chapters.map((c) => c.id)
    // 分批查询所有章节摘要
    const summaries = await db.select().from(ChapterSummaryTable).all()
    const summaryMap = new Map(summaries.map((s) => [s.chapter_id, s]))
    for (const chId of chapterIds) {
      const s = summaryMap.get(chId)
      if (s) {
        chapterSummaries[chId] = {
          summary: s.summary,
          keyEvents: (Array.isArray(s.key_events) ? s.key_events : []) as string[],
        }
      }
    }
  }

  // 获取该小说所有角色
  const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()

  // 查询本卷章节范围内出场过的角色（通过 character_states 与 chapters 联表）
  const activeCharIds = new Set<string>()
  const dormantCharIds = new Set<string>()

  if (chapters.length > 0 && characters.length > 0) {
    const chapterIds = chapters.map((c) => c.id)
    // 查询本卷章节中有状态记录的角色
    const appearedRows = await db
      .select({ character_id: CharacterStateTable.character_id })
      .from(CharacterStateTable)
      .all()
    const appearedMap = new Map<string, Set<string>>()
    for (const row of appearedRows) {
      if (chapterIds.includes(row.character_id)) continue // skip if it's a chapter_id not character_id
      // 这里需要区分：row.character_id 是角色ID，但我们需要知道它关联的章节
    }

    // 重新查询：join character_states with chapters
    const statesInVolume = await db
      .select({ character_id: CharacterStateTable.character_id })
      .from(CharacterStateTable)
      .all()
    // 改用更精确的方式：遍历所有 character_states，检查 chapter_id 是否在 volume 章节中
    const allStates = await db.select().from(CharacterStateTable).all()
    const chapterIdSet = new Set(chapterIds)
    const appearedSet = new Set<string>()
    for (const state of allStates) {
      if (state.chapter_id != null && chapterIdSet.has(state.chapter_id)) {
        appearedSet.add(state.character_id)
      }
    }

    for (const char of characters) {
      if (appearedSet.has(char.id)) {
        activeCharIds.add(char.id)
      } else {
        dormantCharIds.add(char.id)
      }
    }
  } else {
    // 本卷无章节，所有角色标记为 dormant
    for (const char of characters) {
      dormantCharIds.add(char.id)
    }
  }

  // 为 dormant 角色创建新的 character_states 记录（active=0）
  for (const charId of dormantCharIds) {
    const stateId = crypto.randomUUID()
    await db
      .insert(CharacterStateTable)
      .values({
        id: stateId,
        character_id: charId,
        chapter_id: chapters.length > 0 ? chapters[chapters.length - 1].id : "",
        active: 0,
        location: "",
        mood: "",
        summary: "休眠角色 — 本卷未出场",
      })
      .run()
  }

  // 收集活跃/休眠角色名
  const charNameMap = new Map(characters.map((c) => [c.id, c.name]))
  const activeNames = [...activeCharIds].map((id) => charNameMap.get(id) ?? id)
  const dormantNames = [...dormantCharIds].map((id) => charNameMap.get(id) ?? id)

  // 获取剧情线索状态
  const allThreads = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()

  const openThreads = allThreads.filter((t) => t.status === "open")
  const closedThreads = allThreads.filter((t) => t.status === "closed")

  // 生成卷摘要文本
  const summary = buildVolumeSummary(
    volumeNumber,
    chapters,
    chapterSummaries,
    activeNames,
    dormantNames,
    openThreads,
    closedThreads,
  )

  // 写入卷摘要表（幂等：先删后插）
  await db.delete(VolumeSummaryTable).where(eq(VolumeSummaryTable.volume_id, volume.id)).run()

  const summaryId = crypto.randomUUID()
  await db
    .insert(VolumeSummaryTable)
    .values({
      id: summaryId,
      volume_id: volume.id,
      summary,
      char_active: JSON.stringify(activeNames),
      char_dormant: JSON.stringify(dormantNames),
      threads_open: JSON.stringify(openThreads.map((t) => t.title)),
      threads_closed: JSON.stringify(closedThreads.map((t) => t.title)),
    })
    .run()

  return { volumeId: volume.id, summaryId }
}

/**
 * 获取有效上下文（用卷摘要替代章摘要）
 *
 * 与 assembleSnapshot 类似，但使用卷摘要替代大量章摘要，
 * 在第100章时只读2个卷摘要+3个章摘要，不读100个章摘要。
 * 已关闭的线索不会出现在 P3 活跃层。
 *
 * @param novelId 小说 ID
 * @param chapterNumber 当前章节序号
 * @returns 结构化上下文快照，小说不存在时返回 null
 */
export async function getEffectiveContext(
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

  // 当前卷号与本卷起始章：以章节实际归属（volume_id）为准，卷长度由剧情决定
  let volumeNumber = 0
  let firstChapterOfVolume = 1
  if (currentChapter?.volume_id) {
    const [currentVolume] = await db
      .select()
      .from(VolumeTable)
      .where(eq(VolumeTable.id, currentChapter.volume_id))
      .all()
    volumeNumber = currentVolume?.order ?? 0
    const [first] = await db
      .select({ order: ChapterTable.order })
      .from(ChapterTable)
      .where(eq(ChapterTable.volume_id, currentChapter.volume_id))
      .orderBy(asc(ChapterTable.order))
      .limit(1)
      .all()
    firstChapterOfVolume = first?.order ?? 1
  }

  // 构建卷摘要文本（当前卷 + 上一卷）
  let volumeSummary: string | null = null
  const volumeSummaries: string[] = []

  // 当前卷摘要
  if (currentChapter?.volume_id) {
    const [vs] = await db
      .select()
      .from(VolumeSummaryTable)
      .where(eq(VolumeSummaryTable.volume_id, currentChapter.volume_id))
      .all()
    if (vs?.summary) {
      volumeSummaries.push(vs.summary)
    }
  }

  // 上一卷摘要（如果存在）
  if (volumeNumber > 1) {
    const [prevVolume] = await db
      .select()
      .from(VolumeTable)
      .where(and(eq(VolumeTable.novel_id, novelId), eq(VolumeTable.order, volumeNumber - 1)))
      .all()
    if (prevVolume) {
      const [prevVs] = await db
        .select()
        .from(VolumeSummaryTable)
        .where(eq(VolumeSummaryTable.volume_id, prevVolume.id))
        .all()
      if (prevVs?.summary) {
        volumeSummaries.push(prevVs.summary)
      }
    }
  }

  if (volumeSummaries.length > 0) {
    volumeSummary = volumeSummaries.join("\n\n")
  }

  // ── P2b: 章节段摘要（惰性生成已关闭的段，幂等） ──
  await ensureSegmentSummaries(db, novelId, chapterNumber)
  const segmentSummaries = await listSegmentSummaries(db, novelId)

  // ── P1: 活跃角色（过滤 dormant 角色） ──
  const characters = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()

  const activeCharacters: ActiveCharacter[] = []
  for (const char of characters) {
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

  // ── P2: 最近3章摘要（仅从当前卷中取） ──
  const recentChapters = await db
    .select()
    .from(ChapterTable)
    .where(
      and(
        eq(ChapterTable.novel_id, novelId),
        lte(ChapterTable.order, chapterNumber),
        gte(ChapterTable.order, firstChapterOfVolume),
      ),
    )
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
  recentChapterSummaries.sort((a, b) => a.chapterOrder - b.chapterOrder)

  // ── P3: 剧情线索 + 伏笔（仅开放线索，已关闭的归档不显示） ──
  const allThreads = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()
  const openThreadsOnly = allThreads.filter((t) => t.status === "open")

  const foreshadowingEntries = await db
    .select()
    .from(ForeshadowingTable)
    .where(eq(ForeshadowingTable.novel_id, novelId))
    .all()

  // ── P3b: 当前章节相关的结构线/弧光 ──
  const charIdToName = new Map(characters.map((c) => [c.id, c.name]))
  const activeArcs = await loadActiveArcs(db, novelId, chapterNumber, charIdToName)

  // ── P4: 风格指南 + 题材规则 ──
  const [styleGuideRow] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all()

  const genreRules = await loadGenreRules(novel.genre)

  // ── 上一章结尾原文 + 目标字数（与 assembleSnapshot 口径一致） ──
  const [prevChapter] = await db
    .select({ content: ChapterTable.content })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber - 1)))
    .all()
  const prevChapterTail = prevChapter && prevChapter.content.length > 0 ? prevChapter.content.slice(-600) : null

  const rawTarget = parseStyleRules(styleGuideRow?.rules).chapter_length
  const parsedTarget = Number(rawTarget)
  const targetWordCount = Number.isFinite(parsedTarget) && parsedTarget > 0 ? Math.floor(parsedTarget) : null

  return {
    novelTitle: novel.title,
    genre: novel.genre,
    synopsis: novel.synopsis,

    activeCharacters,
    departedCharacters: [],

    volumeSummary,
    recentChapterSummaries,
    segmentSummaries,

    plotThreads: openThreadsOnly.map((t) => ({
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

    worldEntries: [],
    volumeList: [],
    relationships: [],
    activeArcs,

    prevChapterTail,
    targetWordCount,
    worldEntryIndex: [],
    recalledHistory: [],
    chapterOutline: null,
    techniques: [],
  }
}

// ─── 内部辅助函数 ───

/**
 * 生成卷摘要文本
 *
 * 结构化 Markdown 格式，包含主要事件、角色变化、线索进展三部分。
 *
 * @param volumeNumber 卷号
 * @param chapters 本卷章节列表
 * @param chapterSummaries 章节摘要映射（chapterId -> {summary, keyEvents}）
 * @param activeNames 活跃角色名列表
 * @param dormantNames 休眠角色名列表
 * @param openThreads 开放线索列表
 * @param closedThreads 已关闭线索列表
 * @returns 卷摘要 Markdown 文本
 */
function buildVolumeSummary(
  volumeNumber: number,
  chapters: { id: string; order: number; title: string }[],
  chapterSummaries: Record<string, { summary: string; keyEvents: string[] }>,
  activeNames: string[],
  dormantNames: string[],
  openThreads: { title: string; description: string }[],
  closedThreads: { title: string; description: string }[],
): string {
  const lines: string[] = []

  lines.push(`## 卷${volumeNumber}摘要`)
  lines.push("")

  // 主要事件
  lines.push("### 主要事件")
  lines.push("")
  if (chapters.length === 0) {
    lines.push("（本卷无章节）")
  } else {
    for (const ch of chapters) {
      const cs = chapterSummaries[ch.id]
      const summary = cs?.summary || "（暂无摘要）"
      lines.push(`- 第${ch.order}章《${ch.title}》：${summary}`)
      if (cs?.keyEvents && cs.keyEvents.length > 0) {
        for (const event of cs.keyEvents) {
          lines.push(`  - ${event}`)
        }
      }
    }
  }
  lines.push("")

  // 角色变化
  lines.push("### 角色变化")
  lines.push("")
  if (activeNames.length > 0) {
    lines.push(`活跃角色：${activeNames.join("、")}`)
  }
  if (dormantNames.length > 0) {
    lines.push(`休眠角色：${dormantNames.join("、")}`)
  }
  if (activeNames.length === 0 && dormantNames.length === 0) {
    lines.push("（暂无角色数据）")
  }
  lines.push("")

  // 线索进展
  lines.push("### 线索进展")
  lines.push("")
  if (openThreads.length > 0) {
    lines.push("开放线索：")
    for (const t of openThreads) {
      lines.push(`- ${t.title}：${t.description}`)
    }
  }
  if (closedThreads.length > 0) {
    lines.push("已关闭线索：")
    for (const t of closedThreads) {
      lines.push(`- ${t.title}：${t.description}`)
    }
  }
  if (openThreads.length === 0 && closedThreads.length === 0) {
    lines.push("（暂无线索数据）")
  }

  return lines.join("\n")
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
