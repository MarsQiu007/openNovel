/**
 * 自评价指标桶 — append-only JSONL 计数。
 *
 * 每行一条计数：{ts, domain, key, delta, ...}。落盘纪律对齐 mode.jsonl
 * （O_APPEND + fsync，失败只 warn 不抛）——指标是 best-effort，
 * 任何 IO 失败都不得阻断写作主流程。读取端容忍坏行（跳过并计数），
 * 因为文件可能被用户手工编辑或并发截断。
 */

import { mkdirSync, openSync, closeSync, writeSync, fsyncSync, readFileSync, statSync } from "fs"
import { dirname, join } from "path"

const EVALUATE_DIR = join(".novel", "evaluate")
const METRICS_FILE = join(EVALUATE_DIR, "metrics.jsonl")
/** 软上限：超过后在读取时提示归档（设计 Risks，自动压缩留 v1.1） */
export const METRICS_SOFT_LIMIT_BYTES = 5 * 1024 * 1024

/** 指标域（七域 + 预留扩展，v1.1 的 C8-C10 直接加字符串即可） */
export type MetricsDomain = "c1-runtime" | "c2-prompt-control" | "c3-recall" | "c4-context" | "c5-flow" | "c6-technique" | "c7-narrative" | (string & {})

/** 单条计数条目 */
export interface MetricsEntry {
  /** 毫秒级 Unix 时间戳 */
  ts: number
  domain: MetricsDomain
  /** 域内信号键，如 "budget.p2.trimmed" / "recall.entity.hits" */
  key: string
  /** 增量（通常为 1；token/耗时类用实际数值） */
  delta: number
  /** 可选：关联会话 */
  sessionId?: string
  /** 可选：关联 agent（c1/c5 按 agent 统计） */
  agent?: string
  /** 可选：关联模型 */
  model?: string
  /** 可选：章节号等数值型上下文 */
  chapter?: number
}

export function getMetricsDir(projectDir: string): string {
  return join(projectDir, EVALUATE_DIR)
}

export function getMetricsPath(projectDir: string): string {
  return join(projectDir, METRICS_FILE)
}

function warnIO(stage: string, path: string, err: unknown) {
  console.warn(`[evaluate] ${stage} failed for ${path}:`, err)
}

/**
 * 追加一条计数。IO 失败只 warn——指标是旁路观测，不是功能路径。
 * O_APPEND 保证原子追加，多进程并发写入不会互相截断。
 */
export function recordMetrics(projectDir: string, entry: Omit<MetricsEntry, "ts">): void {
  const path = getMetricsPath(projectDir)
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch (err) {
    warnIO("recordMetrics.mkdir", dirname(path), err)
    return
  }

  const line = JSON.stringify({ ...entry, ts: Date.now() }) + "\n"
  let fd: number | null = null
  try {
    fd = openSync(path, "a")
    // Buffer 显式传 length：避免部分 fs 实现对 string writeSync 的尾字节丢失
    const buf = Buffer.from(line, "utf-8")
    writeSync(fd, buf, 0, buf.length)
    fsyncSync(fd)
  } catch (err) {
    warnIO("recordMetrics.write", path, err)
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

/** 读取结果：条目 + 坏行数（坏行跳过，不抛） */
export interface MetricsReadResult {
  entries: MetricsEntry[]
  corruptLines: number
  /** 是否超过软上限（报告层据此提示归档） */
  overSoftLimit: boolean
}

export function readMetrics(projectDir: string): MetricsReadResult {
  const path = getMetricsPath(projectDir)
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    // 文件不存在 = 尚无指标，合法状态
    return { entries: [], corruptLines: 0, overSoftLimit: false }
  }
  const entries: MetricsEntry[] = []
  let corruptLines = 0
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as MetricsEntry
      if (
        typeof parsed.ts === "number" &&
        typeof parsed.domain === "string" &&
        typeof parsed.key === "string" &&
        typeof parsed.delta === "number"
      ) {
        entries.push(parsed)
      } else {
        corruptLines++
      }
    } catch {
      corruptLines++
    }
  }
  const { size } = statSync(path)
  return { entries, corruptLines, overSoftLimit: size > METRICS_SOFT_LIMIT_BYTES }
}

/**
 * 聚合：domain -> key -> 累计值。
 * 可选 fromTs 过滤（报告"上次报告以来"范围用）。
 */
export function aggregateMetrics(
  entries: MetricsEntry[],
  fromTs?: number,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const e of entries) {
    if (fromTs !== undefined && e.ts < fromTs) continue
    const bucket = (out[e.domain] ??= {})
    bucket[e.key] = (bucket[e.key] ?? 0) + e.delta
  }
  return out
}
