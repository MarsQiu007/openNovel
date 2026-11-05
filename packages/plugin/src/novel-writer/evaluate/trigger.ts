/**
 * 自动触发（design D4）：四类信号 → 24h 冷却 → 后台生成（不弹窗）。
 *
 * 信号与前置条件（全部策略集中在本模块，事件源只负责上报信号）：
 * - volume-complete：弧光完成（arc-progress 调用点直挂，卷状态翻转信号）
 * - compaction：Compaction.Ended 事件
 * - revision-window：滚动窗内（6h）rollback+审批拒绝+大改 ≥5（按指标桶计数）
 * - session-milestone：自上次自动报告以来 +10 个会话（session.created 计数兜底）
 *
 * 冷却经 last-report.json 的 lastAutoRunTs；手动 /evaluate 只推进 lastRunTs
 * 窗口、不重置冷却（writeState 合并保留），即手动始终可用但不扰动自动节奏。
 * 生成走 since-last 范围（报告之间互不重复统计），信号合并=冷却期内全部抑制。
 */
import { readMetrics } from "./metrics.js"
import { generateReport, readLastAutoRunTs, markAutoReport } from "./report.js"

export type AutoSignal = "volume-complete" | "compaction" | "revision-window" | "session-milestone"

const AUTO_COOLDOWN_MS = 24 * 60 * 60 * 1000
const REVISION_WINDOW_MS = 6 * 60 * 60 * 1000
export const SESSION_MILESTONE = 10
export const REVISION_WINDOW_THRESHOLD = 5
const REVISION_KEYS = ["version.rollback", "approval.rejected", "paragraph.diff.checked"]

function sumKeySince(projectDir: string, keys: readonly string[], sinceTs: number, now: number): number {
  const { entries } = readMetrics(projectDir)
  let count = 0
  for (const e of entries) {
    if (e.ts < sinceTs || e.ts > now) continue
    if (keys.includes(e.key)) count += e.delta
  }
  return count
}

/** 信号专属前置条件（冷却判定之外）。 */
function signalEligible(projectDir: string, signal: AutoSignal, now: number): boolean {
  if (signal === "revision-window") {
    return (
      sumKeySince(projectDir, REVISION_KEYS, now - REVISION_WINDOW_MS, now) >= REVISION_WINDOW_THRESHOLD
    )
  }
  if (signal === "session-milestone") {
    return (
      sumKeySince(projectDir, ["session.created"], readLastAutoRunTs(projectDir), now) >= SESSION_MILESTONE
    )
  }
  return true
}

/** 信号到达时尝试触发一次后台自动报告；冷却期内或未达信号阈值返回 false。 */
export function maybeAutoReport(projectDir: string, signal: AutoSignal, now = Date.now()): boolean {
  if (now - readLastAutoRunTs(projectDir) < AUTO_COOLDOWN_MS) return false
  if (!signalEligible(projectDir, signal, now)) return false
  generateReport(projectDir, { kind: "since-last" }, now)
  markAutoReport(projectDir, now)
  return true
}
