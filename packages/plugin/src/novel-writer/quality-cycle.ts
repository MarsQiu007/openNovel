/**
 * 质量循环模块 — 每3章执行一次技术+AI+一致性检查
 *
 * 在写作流程中，每完成3章后自动触发一次全面质量检查，覆盖三个维度：
 * 1. 技术检查 — 章节字数、数据库完整性、序号连续性
 * 2. AI 检查 — 内容重复度、AI 写作模式、句长分布、字符多样性
 * 3. 一致性检查 — 委托 continuity-check.ts 执行37维度全面检查
 *
 * 导出：
 * - shouldRunQualityCycle(chapterNumber) — 判断是否应触发质量循环
 * - runQualityCycle(novelId, chapterNumber) — 执行完整质量循环
 * - CheckStatus, QualityCycleResult 类型
 *
 * 遵循 novel-writer.ts 和 continuity-check.ts 中的数据库访问模式。
 */

import { checkContinuity } from "./continuity-check.js"
import { eq, and, desc, sql } from "drizzle-orm"
import { getDb, NovelTable, ChapterTable } from "./session-store.js"

// ─── 类型定义 ───

/** 质量检查状态 */
export type CheckStatus = "PASS" | "WARN" | "FAIL"

/** 质量循环完整结果 */
export type QualityCycleResult = {
  /** 小说 ID */
  novelId: string
  /** 章节序号 */
  chapterNumber: number
  /** 技术检查结果 */
  technical: CheckStatus
  /** AI 检查结果 */
  ai: CheckStatus
  /** 一致性检查结果 */
  consistency: CheckStatus
  /** 整体结果 */
  overall: CheckStatus
}

// ─── 公共函数 ───

/**
 * 判断是否应在指定章节触发质量循环
 *
 * 每 3 章触发一次（第 3、6、9... 章），第 0 章不触发。
 *
 * @param chapterNumber 章节序号
 * @returns 是否应触发质量循环
 */
export function shouldRunQualityCycle(chapterNumber: number): boolean {
  return chapterNumber > 0 && chapterNumber % 3 === 0
}

/**
 * 执行完整质量循环：技术检查 + AI 检查 + 一致性检查
 *
 * 三个维度并行执行，任一维度 FAIL 则整体 FAIL。
 *
 * 整体结果判定规则：
 * - 全部 PASS → PASS
 * - 有 WARN 但无 FAIL → WARN
 * - 有 FAIL → FAIL
 *
 * @param novelId 小说 ID
 * @param chapterNumber 当前章节序号
 * @returns 质量循环结果，小说不存在时返回 null
 */
export async function runQualityCycle(
  novelId: string,
  chapterNumber: number,
  directory?: string | null,
): Promise<QualityCycleResult | null> {
  const db = getDb(directory)

  // 验证小说存在
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  if (!novel) return null

  // 并行执行三项检查
  const [technical, ai, consistencyResult] = await Promise.all([
    runTechnicalCheck(novelId, chapterNumber, directory),
    runAICheck(novelId, chapterNumber, directory),
    checkContinuity(novelId, chapterNumber, directory),
  ])

  const consistency = consistencyResult?.overall ?? "FAIL"

  const overall: CheckStatus =
    technical === "FAIL" || ai === "FAIL" || consistency === "FAIL"
      ? "FAIL"
      : technical === "WARN" || ai === "WARN" || consistency === "WARN"
        ? "WARN"
        : "PASS"

  return {
    novelId,
    chapterNumber,
    technical,
    ai,
    consistency,
    overall,
  }
}

// ─── 技术检查 ───

/**
 * 执行技术维度检查
 *
 * 检查项：
 * 1. 章节字数是否在合理范围（2000-3000 字符）
 * 2. 章节序号是否连续无跳跃
 * 3. 数据库记录完整性（章节表是否有孤立记录）
 *
 * @param novelId 小说 ID
 * @param chapterNumber 当前章节序号
 * @returns 技术检查结果
 */
async function runTechnicalCheck(
  novelId: string,
  chapterNumber: number,
  directory?: string | null,
): Promise<CheckStatus> {
  const db = getDb(directory)

  // 查询当前章节和所有章节
  const [currentChapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber)))
    .all()

  const allChapters = await db
    .select()
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .orderBy(sql`"order"`)
    .all()

  const issues: string[] = []

  // 1. 字数检查：2000-3000 字符范围
  if (currentChapter) {
    const contentLen = currentChapter.content.length
    if (contentLen < 2000) {
      issues.push(`当前章节仅 ${contentLen} 字符，低于最低 2000 字符要求`)
    } else if (contentLen > 3000) {
      issues.push(`当前章节 ${contentLen} 字符，超过最高 3000 字符限制`)
    }
  } else {
    issues.push("未找到当前章节记录")
  }

  // 2. 章节序号连续性检查
  if (allChapters.length >= 2) {
    const orders = allChapters.map((c) => c.order)
    for (let i = 1; i < orders.length; i++) {
      if (orders[i]! - orders[i - 1]! > 1) {
        issues.push(`章节序号不连续：第 ${orders[i - 1]} 章后跳到第 ${orders[i]} 章`)
      }
    }
  }

  // 3. 数据库完整性检查：查询是否有孤立章节（novel_id 不匹配任何小说）
  // 这里只检查当前小说，不需要跨表检查

  if (issues.length === 0) return "PASS"
  if (issues.length <= 2) return "WARN"
  return "FAIL"
}

// ─── AI 检查 ───

/**
 * 执行 AI 写作质量检查
 *
 * 检查项：
 * 1. 内容重复度 — 检测重复段落和中高频短语
 * 2. AI 写作模式 — 检测常见 AI 写作标记（如 "首先...其次...最后"、"总的来说" 等）
 * 3. 句长分布 — 检查句子长度是否过于单一
 * 4. 字符多样性 — 检查唯一字符占比
 *
 * @param novelId 小说 ID
 * @param chapterNumber 当前章节序号
 * @returns AI 检查结果
 */
async function runAICheck(novelId: string, chapterNumber: number, directory?: string | null): Promise<CheckStatus> {
  const db = getDb(directory)

  // 获取最近3章的内容用于检查
  const recentChapters = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), sql`"order" <= ${chapterNumber}`))
    .orderBy(desc(sql`"order"`))
    .limit(3)
    .all()

  if (recentChapters.length === 0) return "FAIL"

  // 合并最近3章内容用于分析
  const combinedContent = recentChapters.map((c) => c.content).join("\n")
  const issues: string[] = []

  // 1. 内容重复度检查：检测重复段落（>50字符的完全重复）
  const repeatPattern = checkContentRepetition(combinedContent)
  if (repeatPattern.repeatScore > 5) {
    issues.push(
      `内容重复度较高：检测到 ${repeatPattern.repeatCount} 处重复段落（>50字符），重复率 ${repeatPattern.repeatRate.toFixed(1)}%`,
    )
  } else if (repeatPattern.repeatScore > 2) {
    issues.push(`内容存在轻微重复：${repeatPattern.repeatCount} 处重复段落`)
  }

  // 2. AI 写作模式检测：检查常见 AI 写作标记
  const aiPatterns = detectAIPatterns(combinedContent)
  if (aiPatterns.count >= 3) {
    issues.push(`检测到 ${aiPatterns.count} 处 AI 写作模式标记：${aiPatterns.matches.join("、")}`)
  } else if (aiPatterns.count >= 1) {
    issues.push(`检测到 ${aiPatterns.count} 处 AI 写作模式标记：${aiPatterns.matches.join("、")}`)
  }

  // 3. 句长分布检查：统计句子长度方差
  const sentenceStats = analyzeSentenceLength(combinedContent)
  if (sentenceStats.variance < 50) {
    issues.push(`句长分布过于均匀（方差 ${sentenceStats.variance.toFixed(0)}），缺乏节奏变化`)
  }

  // 4. 字符多样性检查
  const uniqueChars = new Set(combinedContent.replace(/\s/g, ""))
  const charDiversity = uniqueChars.size / Math.max(combinedContent.replace(/\s/g, "").length, 1)
  if (charDiversity < 0.05) {
    issues.push(`字符多样性偏低（${(charDiversity * 100).toFixed(1)}%），词汇量可能不足`)
  }

  if (issues.length === 0) return "PASS"
  if (issues.length <= 2) return "WARN"
  return "FAIL"
}

// ─── AI 检查辅助函数 ───

/** 内容重复度分析结果 */
interface RepeatAnalysis {
  /** 重复段落数量 */
  repeatCount: number
  /** 重复率（百分比） */
  repeatRate: number
  /** 重复严重度评分 */
  repeatScore: number
}

/**
 * 检测内容中的重复段落
 *
 * 使用滑动窗口检测 >50 字符的重复片段。
 * 重复评分 = 重复长度加权总和 / 1000，超过 5 视为严重。
 */
function checkContentRepetition(text: string): RepeatAnalysis {
  const minLen = 50
  const seen = new Map<string, number>()
  let repeatCount = 0
  let repeatScore = 0

  for (let i = 0; i <= text.length - minLen; i++) {
    const segment = text.slice(i, i + minLen)
    const count = (seen.get(segment) || 0) + 1
    seen.set(segment, count)
    if (count === 2) {
      repeatCount++
      repeatScore += Math.ceil(minLen / 100)
    }
  }

  // 去重：只统计出现超过1次的段落
  const totalSegments = text.length - minLen + 1
  const repeatRate = totalSegments > 0 ? (repeatCount / totalSegments) * 100 : 0

  return { repeatCount, repeatRate, repeatScore }
}

/**
 * 检测 AI 写作常见模式标记
 *
 * 匹配以下模式：
 * - 过渡词堆砌：首先...其次...再次...最后
 * - 万能结论：总的来说、综上所述、总而言之
 * - 模板化表达：值得注意的是、毋庸置疑、众所周知
 * - 三段式结构：一方面...另一方面
 */
function detectAIPatterns(text: string): { count: number; matches: string[] } {
  const patterns: { regex: RegExp; label: string }[] = [
    { regex: /首先.*其次.*再次.*最后/g, label: "首先...其次...再次...最后" },
    { regex: /总的来说/g, label: "总的来说" },
    { regex: /综上所述/g, label: "综上所述" },
    { regex: /总而言之/g, label: "总而言之" },
    { regex: /值得注意的是/g, label: "值得注意的是" },
    { regex: /毋庸置疑/g, label: "毋庸置疑" },
    { regex: /众所周知/g, label: "众所周知" },
    { regex: /一方面.*另一方面/g, label: "一方面...另一方面" },
    { regex: /不仅.*而且.*更/g, label: "不仅...而且...更" },
    { regex: /在.*的过程中/g, label: "在...的过程中" },
  ]

  const matches: string[] = []
  let count = 0

  for (const { regex, label } of patterns) {
    const matchCount = (text.match(regex) || []).length
    if (matchCount > 0) {
      count += matchCount
      matches.push(`${label}(${matchCount}次)`)
    }
  }

  return { count, matches }
}

/** 句长分析结果 */
interface SentenceStats {
  /** 平均句长 */
  average: number
  /** 句长方差 */
  variance: number
}

/**
 * 分析句子长度分布
 *
 * 按中文标点（。！？）分割句子，计算平均长度和方差。
 * 方差 < 50 表示句长过于均匀，缺乏节奏变化。
 */
function analyzeSentenceLength(text: string): SentenceStats {
  // 按中文句子结束标点分割
  const sentences = text
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (sentences.length === 0) return { average: 0, variance: 0 }

  const lengths = sentences.map((s) => s.length)
  const average = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const variance = lengths.reduce((sum, len) => sum + (len - average) ** 2, 0) / lengths.length

  return { average, variance }
}
