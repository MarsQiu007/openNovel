/**
 * 自评价指标写入端 — append-only JSONL 计数。
 *
 * 唯一写入实现下沉在 novel-store：`.novel/evaluate/metrics.jsonl` 属 .novel
 * 数据领地（与 audit/mode.jsonl 同层），且 approval 转换点（approval.ts）在
 * 本包内，plugin 的 evaluate/metrics.ts 经 re-export 复用本实现，避免双写分叉。
 *
 * 落盘纪律同 mode.ts：O_APPEND + writeSync + fsyncSync + closeSync，
 * 失败只 warn 不抛——指标是旁路观测，不是功能路径。
 */
import { mkdirSync, openSync, closeSync, writeSync, fsyncSync } from "fs"
import { dirname, join } from "path"

const EVALUATE_METRICS_FILE = join(".novel", "evaluate", "metrics.jsonl")

/** 指标文件相对项目根的路径（埋点层与报告层共用同一解析） */
export function getEvaluateMetricsPath(projectDir: string): string {
  return join(projectDir, EVALUATE_METRICS_FILE)
}

/** 单条计数条目（ts 由写入端补齐毫秒级时间戳） */
export interface EvaluateMetricEntry {
  /** 指标域（七域 c1-c7 + 自由扩展字符串） */
  domain: string
  /** 域内信号键，如 "budget.p2.trimmed" / "recall.route.entity" */
  key: string
  /** 增量（通常为 1；token/耗时类用实际数值） */
  delta: number
  /** 可选：关联会话 */
  sessionId?: string
  /** 可选：关联 agent */
  agent?: string
  /** 可选：关联模型 */
  model?: string
  /** 可选：章节号等数值型上下文 */
  chapter?: number
}

function warnIO(stage: string, path: string, err: unknown) {
  console.warn(`[evaluate] ${stage} failed for ${path}:`, err)
}

/**
 * 追加多条计数（单次 open/fsync 批量落盘，多行共用一时间戳）。
 * entries 为空时不触碰文件系统。
 */
export function recordEvaluateMetrics(projectDir: string, entries: EvaluateMetricEntry[]): void {
  if (entries.length === 0) return
  const path = getEvaluateMetricsPath(projectDir)
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch (err) {
    warnIO("recordEvaluateMetrics.mkdir", dirname(path), err)
    return
  }

  const line = entries.map((entry) => JSON.stringify({ ...entry, ts: Date.now() }) + "\n").join("")
  let fd: number | null = null
  try {
    fd = openSync(path, "a")
    // Buffer 显式传 length：避免部分 fs 实现对 string writeSync 的尾字节丢失
    const buf = Buffer.from(line, "utf-8")
    writeSync(fd, buf, 0, buf.length)
    fsyncSync(fd)
  } catch (err) {
    warnIO("recordEvaluateMetrics.write", path, err)
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 关闭错忽略
      }
    }
  }
}
