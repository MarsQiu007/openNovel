/**
 * 多轮审核模块 — 循环执行 audit → fix → sync → log
 *
 * 每轮对当前章节执行连续性检查，发现的问题通过状态提交同步到
 * DB 和 Markdown 日志，支持多轮迭代直到无新问题或达到最大轮次。
 *
 * 导出：
 * - ReviewRound — 单轮审核记录类型
 * - MultiRoundResult — 多轮审核汇总结果类型
 * - runMultiRoundReview(novelId, chapterId, maxRounds) — 多轮审核主函数
 *
 * 遵循 continuity-check.ts 和 state-commit.ts 中的数据库访问模式。
 */

import { checkContinuity } from "./continuity-check.js"
import type { ContinuityResult } from "./continuity-check.js"
import { commitState } from "./state-commit.js"
import type { StateDelta } from "./state-commit.js"
import { eq, and } from "drizzle-orm"
import { getDb, ChapterTable } from "./session-store.js"

// ─── 类型定义 ───

/** 单轮审核记录 */
export type ReviewRound = {
  /** 轮次序号（从 1 开始） */
  round: number
  /** 本轮开始时间戳 */
  timestamp: string
  /** 本轮发现的 FAIL 维度数量 */
  failCount: number
  /** 本轮发现的 WARN 维度数量 */
  warnCount: number
  /** 本轮新发现的维度名称列表（与上一轮不同的维度） */
  newIssues: string[]
  /** 本轮是否已执行修复同步 */
  synced: boolean
  /** 本轮审核状态：PASS / WARN / FAIL */
  status: "PASS" | "WARN" | "FAIL"
}

/** 多轮审核汇总结果 */
export type MultiRoundResult = {
  /** 小说 ID */
  novelId: string
  /** 章节 ID */
  chapterId: string
  /** 章节序号 */
  chapterNumber: number
  /** 所有轮次记录 */
  rounds: ReviewRound[]
  /** 实际执行的轮次数 */
  roundsExecuted: number
  /** 累计发现的 FAIL 维度数（去重） */
  totalFailIssues: number
  /** 累计发现的 WARN 维度数（去重） */
  totalWarnIssues: number
  /** 最终状态 */
  finalStatus: "PASS" | "WARN" | "FAIL" | "MAX_ROUNDS"
  /** 停止原因 */
  stopReason: string
}

// ─── 辅助函数 ───

/**
 * 从 chapterId 解析 chapterNumber（章节序号）
 *
 * 查询 chapters 表，按 novel_id + id 查找章节的 order 字段。
 * 未找到时返回 null。
 */
async function resolveChapterNumber(
  novelId: string,
  chapterId: string,
  directory?: string | null,
): Promise<number | null> {
  const db = getDb(directory)
  const [chapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.id, chapterId)))
    .all()
  return chapter ? chapter.order : null
}

/**
 * 从连续性检查结果中提取 FAIL 和 WARN 维度的名称集合
 *
 * @param dimensions 连续性检查的维度结果数组
 * @returns { failNames, warnNames } 两个名称集合
 */
function extractIssueNames(dimensions: ContinuityResult[]): {
  failNames: Set<string>
  warnNames: Set<string>
} {
  const failNames = new Set<string>()
  const warnNames = new Set<string>()
  for (const d of dimensions) {
    if (d.status === "FAIL") failNames.add(d.dimension)
    if (d.status === "WARN") warnNames.add(d.dimension)
  }
  return { failNames, warnNames }
}

/**
 * 计算本轮新出现的维度名称（与上一轮相比）
 *
 * 返回上一轮 Set 中不存在的维度名称。
 */
function computeNewIssues(
  currentFail: Set<string>,
  currentWarn: Set<string>,
  previousFail: Set<string>,
  previousWarn: Set<string>,
): string[] {
  const newIssues: string[] = []
  for (const name of currentFail) {
    if (!previousFail.has(name) && !previousWarn.has(name)) {
      newIssues.push(name)
    }
  }
  for (const name of currentWarn) {
    if (!previousFail.has(name) && !previousWarn.has(name)) {
      newIssues.push(name)
    }
  }
  return newIssues
}

/**
 * 根据问题维度生成 state delta 修复条目
 *
 * 为每个 FAIL 或 WARN 维度创建一条 chapter_summary 类型的 update 条目，
 * 记录该维度的问题以便后续追踪。
 */
function buildFixDelta(novelId: string, chapterId: string, dimensions: ContinuityResult[]): StateDelta {
  return dimensions
    .filter((d) => d.status === "FAIL" || d.status === "WARN")
    .map((d) => ({
      fact_type: "chapter_summary" as const,
      action: "update" as const,
      entity_id: `${chapterId}-review-${d.dimension}`,
      data: {
        chapter_id: chapterId,
        summary: `[审核] ${d.status}: ${d.dimension} — ${d.detail}`,
        key_events: [],
        char_changes: [],
      },
    }))
}

// ─── 主函数 ───

/**
 * 执行多轮审核循环
 *
 * 每轮流程：
 * 1. 运行连续性检查（audit）
 * 2. 提取 FAIL / WARN 维度，计算新增问题
 * 3. 若无新问题则停止
 * 4. 生成修复 delta，调用 commitState 同步 DB + Markdown + 摘要
 * 5. 记录本轮日志
 * 6. 达到 maxRounds 或无新问题时停止
 *
 * @param novelId 小说 ID
 * @param chapterId 章节 ID
 * @param maxRounds 最大轮次数（默认 5）
 * @returns 多轮审核结果，章节不存在时返回 null
 */
export async function runMultiRoundReview(
  novelId: string,
  chapterId: string,
  maxRounds: number = 5,
  directory?: string | null,
): Promise<MultiRoundResult | null> {
  const chapterNumber = await resolveChapterNumber(novelId, chapterId, directory)
  if (chapterNumber === null) return null

  const rounds: ReviewRound[] = []
  let previousFailNames = new Set<string>()
  let previousWarnNames = new Set<string>()
  const allFailNames = new Set<string>()
  const allWarnNames = new Set<string>()

  for (let roundNum = 1; roundNum <= maxRounds; roundNum++) {
    const timestamp = new Date().toISOString()

    // 1. 执行连续性检查
    const checkResult = await checkContinuity(novelId, chapterNumber, directory)
    if (!checkResult) {
      // 数据异常，记录并停止
      rounds.push({
        round: roundNum,
        timestamp,
        failCount: 0,
        warnCount: 0,
        newIssues: [],
        synced: false,
        status: "FAIL",
      })
      break
    }

    const { failNames, warnNames } = extractIssueNames(checkResult.dimensions)
    const failCount = failNames.size
    const warnCount = warnNames.size

    // 2. 计算本轮新问题
    const newIssues = computeNewIssues(failNames, warnNames, previousFailNames, previousWarnNames)

    // 3. 更新累计问题集
    for (const name of failNames) allFailNames.add(name)
    for (const name of warnNames) allWarnNames.add(name)

    // 4. 判断是否停止：无新问题
    if (newIssues.length === 0 && failCount === 0 && warnCount === 0) {
      rounds.push({
        round: roundNum,
        timestamp,
        failCount,
        warnCount,
        newIssues: [],
        synced: true,
        status: "PASS",
      })
      // 日志：本轮通过，无问题
      console.log(`[多轮审核] 第 ${roundNum} 轮 — ${timestamp} — 全部通过，无问题`)
      break
    }

    if (newIssues.length === 0 && roundNum > 1) {
      // 无新问题但仍有旧问题，意味着修复中
      rounds.push({
        round: roundNum,
        timestamp,
        failCount,
        warnCount,
        newIssues: [],
        synced: true,
        status: checkResult.overall,
      })
      console.log(
        `[多轮审核] 第 ${roundNum} 轮 — ${timestamp} — 无新问题（${failCount} FAIL, ${warnCount} WARN），停止迭代`,
      )
      break
    }

    // 5. 生成修复 delta 并同步
    const issuesToFix = checkResult.dimensions.filter(
      (d) => (d.status === "FAIL" || d.status === "WARN") && newIssues.includes(d.dimension),
    )
    let synced = false
    if (issuesToFix.length > 0) {
      const delta = buildFixDelta(novelId, chapterId, issuesToFix)
      await commitState(novelId, chapterId, delta, directory)
      synced = true
    }

    // 6. 记录本轮
    const status = checkResult.overall
    rounds.push({
      round: roundNum,
      timestamp,
      failCount,
      warnCount,
      newIssues,
      synced,
      status,
    })

    // 7. 日志
    console.log(
      `[多轮审核] 第 ${roundNum} 轮 — ${timestamp} — ` +
        `${failCount} FAIL, ${warnCount} WARN, ${newIssues.length} 新问题 — ` +
        `状态: ${status} — 同步: ${synced ? "是" : "否"}`,
    )
    if (newIssues.length > 0) {
      console.log(`  新问题: ${newIssues.join(", ")}`)
    }

    // 8. 更新上一轮状态
    previousFailNames = failNames
    previousWarnNames = warnNames
  }

  // 构建最终结果
  const lastRound = rounds[rounds.length - 1]
  const reachedMaxRounds = rounds.length >= maxRounds && lastRound && lastRound.newIssues.length > 0

  return {
    novelId,
    chapterId,
    chapterNumber,
    rounds,
    roundsExecuted: rounds.length,
    totalFailIssues: allFailNames.size,
    totalWarnIssues: allWarnNames.size,
    finalStatus: reachedMaxRounds ? "MAX_ROUNDS" : (lastRound?.status ?? "PASS"),
    stopReason: reachedMaxRounds
      ? `达到最大轮次数 ${maxRounds}`
      : lastRound
        ? lastRound.newIssues.length === 0
          ? "无新问题"
          : "审核通过"
        : "数据异常",
  }
}
