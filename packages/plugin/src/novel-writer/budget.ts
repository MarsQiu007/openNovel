/**
 * 层级预算模块 — P0-P6 分层 token 预算裁剪
 *
 * 确保分层上下文不超过 12K tokens，章纲额外保留 1.5K。
 * 预算分配：P0 1K + P1 1.5K + P2 2K + P3 2K + P4 1K + P5 2K + P6 2.5K = 12K
 *
 * 导出：
 * - applyBudget(packet) — 对快照应用预算裁剪，返回裁剪后的 ContextPacket
 */

import type {
  ContextPacket,
  ActiveCharacter,
  ChapterSummaryItem,
  SegmentSummaryItem,
  PlotThreadSummary,
  ForeshadowingSummary,
  StyleGuideInfo,
  WorldEntrySummary,
  WorldEntryIndexItem,
  RelationshipSummary,
  VolumeListItem,
  RecalledHistoryItem,
} from "./context.js"

// ─── Token 估算工具 ───

/** 估算字符串的 token 数量（1 token ≈ 1.5 中文字符） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

/** 估算活跃角色对象的 token 数量 */
function charTokens(char: ActiveCharacter): number {
  return estimateTokens(char.name + char.role + char.description + char.location + char.mood + char.summary)
}

/** 估算章节摘要的 token 数量 */
function chapterTokens(ch: ChapterSummaryItem): number {
  return estimateTokens(ch.chapterTitle + ch.summary + ch.keyEvents.join(""))
}

/** 估算段摘要的 token 数量 */
function segmentTokens(s: SegmentSummaryItem): number {
  return estimateTokens(s.summary)
}

/** 估算剧情线索的 token 数量 */
function threadTokens(t: PlotThreadSummary): number {
  return estimateTokens(t.title + t.status + t.priority + t.description)
}

/** 估算伏笔的 token 数量 */
function foreshadowTokens(f: ForeshadowingSummary): number {
  return estimateTokens(f.content + f.state + (f.plantedChapterId ?? ""))
}

/** 估算风格指南的 token 数量 */
function styleGuideTokens(sg: StyleGuideInfo): number {
  return estimateTokens(JSON.stringify(sg.rules) + sg.tone + sg.pov + sg.tense)
}

/** 估算世界观条目的 token 数量 */
function worldEntryTokens(w: WorldEntrySummary): number {
  return estimateTokens(w.category + w.title + w.content)
}

/** 估算召回历史条目的 token 数量 */
function recalledTokens(r: RecalledHistoryItem): number {
  return estimateTokens(r.chapterTitle + r.summary + r.keyEvents.join(""))
}

/** 估算世界观导览条目的 token 数量 */
function worldEntryIndexTokens(item: WorldEntryIndexItem): number {
  return estimateTokens(item.category + item.title)
}

/** 估算关系条目的 token 数量 */
function relationshipTokens(r: RelationshipSummary): number {
  return estimateTokens(r.type + r.description + r.charAName + r.charBName)
}

/** 估算卷纲条目的 token 数量 */
function volumeTokens(v: VolumeListItem): number {
  return estimateTokens(v.title + v.summary)
}

/**
 * 截断数组，保留前面的条目，确保总 token 数不超过预算
 *
 * @param items 条目数组
 * @param tokenFn 估算单条目 token 数的函数
 * @param budget token 预算上限
 * @returns 截断后的数组（保留前面条目）
 */
function truncateArray<T>(items: T[], tokenFn: (item: T) => number, budget: number): T[] {
  let total = 0
  const result: T[] = []
  for (const item of items) {
    const tokens = tokenFn(item)
    if (total + tokens > budget) break
    total += tokens
    result.push(item)
  }
  return result
}

// ─── 各层预算裁剪 ───

/**
 * P0 预算裁剪：裁剪 synopsis 确保不超过 1K tokens
 *
 * P0 字段：novelTitle, genre, synopsis
 * 策略：保留 novelTitle 和 genre（固定且较小），截断 synopsis
 */
function applyP0Budget(packet: ContextPacket): void {
  const P0_BUDGET_CHARS = 1500 // 1K tokens ≈ 1500 字符
  const fixed = packet.novelTitle + packet.genre
  const remaining = P0_BUDGET_CHARS - fixed.length
  if (remaining <= 0) {
    packet.synopsis = ""
    return
  }
  if (packet.synopsis.length > remaining) {
    packet.synopsis = packet.synopsis.slice(0, remaining)
  }
}

/**
 * P1 预算裁剪：截断活跃角色数组，确保不超过 1.5K tokens
 *
 * P1 字段：activeCharacters
 * 策略：保留前面的角色（最重要的），丢弃后面的
 */
function applyP1Budget(packet: ContextPacket): void {
  const P1_BUDGET = 1500 // 1.5K tokens
  packet.activeCharacters = truncateArray(packet.activeCharacters, charTokens, P1_BUDGET)
}

/**
 * P2 预算裁剪：卷摘要 > 最近章节摘要 > 段摘要，确保不超过 2K tokens
 *
 * P2 字段：volumeSummary, recentChapterSummaries, segmentSummaries
 * 策略：volumeSummary 更紧凑，优先保留；最近章节摘要对连续性最关键，其次保留；
 * 段摘要（中景记忆）用剩余预算保留最新的段，丢弃最旧的段
 */
function applyP2Budget(packet: ContextPacket): void {
  const P2_BUDGET = 2000 // 2K tokens
  const volumeTokens = packet.volumeSummary ? estimateTokens(packet.volumeSummary) : 0
  const remaining = P2_BUDGET - volumeTokens
  if (remaining <= 0) {
    packet.recentChapterSummaries = []
    packet.segmentSummaries = []
    return
  }
  packet.recentChapterSummaries = truncateArray(packet.recentChapterSummaries, chapterTokens, remaining)
  const recentUsed = packet.recentChapterSummaries.reduce((sum, ch) => sum + chapterTokens(ch), 0)
  // 段摘要按时间升序存储；反转为最新优先裁剪，截断后恢复升序
  packet.segmentSummaries = truncateArray([...packet.segmentSummaries].reverse(), segmentTokens, remaining - recentUsed).reverse()
}

/**
 * P3 预算裁剪：plotThreads 和 foreshadowing 共享 2K 预算
 *
 * 先裁剪 plotThreads（保留前面的条目），再用剩余预算裁剪 foreshadowing。
 * 确保总 P3 token 不超过 2K。
 *
 * P3 字段：plotThreads, foreshadowing
 * 策略：剧情线索优先保留，伏笔后保留
 */
function applyP3Budget(packet: ContextPacket): void {
  const P3_BUDGET = 2000
  packet.plotThreads = truncateArray(packet.plotThreads, threadTokens, P3_BUDGET)
  const used = packet.plotThreads.reduce((sum, t) => sum + threadTokens(t), 0)
  const remaining = P3_BUDGET - used
  if (remaining <= 0) {
    packet.foreshadowing = []
    return
  }
  packet.foreshadowing = truncateArray(packet.foreshadowing, foreshadowTokens, remaining)
}

/**
 * P4 预算裁剪：优先保留 styleGuide，再裁剪 genreRules，确保不超过 1K tokens
 *
 * P4 字段：styleGuide, genreRules
 * 策略：风格指南通常较小，优先保留；题材规则按需截断（从 1.5K 收紧到 1K）
 */
function applyP4Budget(packet: ContextPacket): void {
  const P4_BUDGET = 1000 // 1K tokens
  const sgTokens = packet.styleGuide ? styleGuideTokens(packet.styleGuide) : 0
  const remaining = P4_BUDGET - sgTokens
  if (remaining <= 0) {
    // 风格指南已超预算，全部丢弃
    packet.styleGuide = null
    packet.genreRules = []
    return
  }
  packet.genreRules = truncateArray(packet.genreRules, (r) => estimateTokens(r), remaining)
}

/**
 * P5 预算裁剪：设定全文、关系、卷纲和标题导览合计不超过 2K。
 */
function applyP5Budget(packet: ContextPacket): void {
  const P5_BUDGET = 2000
  const SUPPORT_BUDGET = 300
  const INDEX_BUDGET = 250

  packet.volumeList = truncateArray(packet.volumeList, volumeTokens, 100)
  packet.relationships = truncateArray(packet.relationships, relationshipTokens, 200)

  const supportTokens =
    packet.volumeList.reduce((sum, v) => sum + volumeTokens(v), 0) +
    packet.relationships.reduce((sum, r) => sum + relationshipTokens(r), 0)
  const indexBudget = Math.min(INDEX_BUDGET, Math.max(0, P5_BUDGET - supportTokens - 500))
  const coreBudget = Math.max(0, P5_BUDGET - supportTokens - indexBudget)

  let total = 0
  const kept: WorldEntrySummary[] = []
  for (const w of packet.worldEntries) {
    const tokens = worldEntryTokens(w)
    if (total + tokens > coreBudget) break
    total += tokens
    kept.push(w)
  }

  const keptIds = new Set(kept.map((w) => w.id))
  const demoted = packet.worldEntries
    .filter((w) => !keptIds.has(w.id))
    .map((w) => ({ category: w.category, title: w.title }))
  packet.worldEntries = kept
  packet.worldEntryIndex = truncateArray([...packet.worldEntryIndex, ...demoted], worldEntryIndexTokens, INDEX_BUDGET)
}

/**
 * P6 预算裁剪：召回历史不超过 2.5K。
 */
function applyP6Budget(packet: ContextPacket): void {
  const P6_BUDGET = 2500
  packet.recalledHistory = truncateArray(packet.recalledHistory, recalledTokens, P6_BUDGET)
}

/**
 * 章纲裁剪：不超过 1.5K。
 */
function applyChapterOutlineBudget(packet: ContextPacket): void {
  if (packet.chapterOutline && estimateTokens(packet.chapterOutline) > 1500) {
    packet.chapterOutline = packet.chapterOutline.slice(0, 2200)
  }
}

// ─── 导出函数 ───

/**
 * 对上下文快照应用预算裁剪
 *
 * 按优先级分层裁剪，确保 P0-P6 分层不超过 12K tokens（章纲另计 1.5K）：
 * - P0 蓝图（1K）：novelTitle, genre, synopsis
 * - P1 活跃角色（1.5K）：activeCharacters
 * - P2 卷+3章摘要（2K）：volumeSummary, recentChapterSummaries
 * - P3 线索+伏笔（2K）：plotThreads, foreshadowing
 * - P4 归档（1K）：styleGuide, genreRules
 * - P5 设定（2K）：worldEntries, worldEntryIndex, volumeList, relationships
 * - P6 召回历史（2.5K）：recalledHistory
 *
 * 每层超出预算时，从最不重要的条目开始截断（保留前面的条目）。
 * 字符数估算：1 token ≈ 1.5 中文字符。
 *
 * @param packet 原始上下文快照（不会被修改）
 * @returns 裁剪后的上下文快照
 */
export function applyBudget(packet: ContextPacket): ContextPacket {
  // 浅拷贝，确保不修改原始对象
  const result: ContextPacket = {
    ...packet,
    activeCharacters: [...packet.activeCharacters],
    recentChapterSummaries: [...packet.recentChapterSummaries],
    plotThreads: [...packet.plotThreads],
    foreshadowing: [...packet.foreshadowing],
    genreRules: [...packet.genreRules],
    worldEntries: [...packet.worldEntries],
    worldEntryIndex: [...packet.worldEntryIndex],
    recalledHistory: [...packet.recalledHistory],
    volumeList: [...packet.volumeList],
    relationships: [...packet.relationships],
    styleGuide: packet.styleGuide ? { ...packet.styleGuide } : null,
  }

  // P0: 蓝图 - 1K tokens
  applyP0Budget(result)

  // 章纲 - 1.5K
  applyChapterOutlineBudget(result)

  // P1: 活跃角色 - 1.5K tokens
  applyP1Budget(result)

  // P2: 卷+3章摘要 - 2K tokens
  applyP2Budget(result)

  // P3: 线索+伏笔 - 2K tokens
  applyP3Budget(result)

  // P4: 归档 - 1K tokens
  applyP4Budget(result)

  // P5: 世界观硬约束 - 2K tokens
  applyP5Budget(result)

  // P6: 召回历史 - 2.5K tokens
  applyP6Budget(result)

  return result
}
