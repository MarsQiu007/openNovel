/**
 * 自评价指标桶 — plugin 埋点/报告层的 façade。
 *
 * 写入端唯一实现在 novel-store（evaluate-metric.ts）：`.novel/evaluate/metrics.jsonl`
 * 属 .novel 数据领地（与 audit/mode.jsonl 同层），且 approval 转换点在 novel-store
 * 内，写入实现下沉才能两边共用、避免分叉。本模块统一暴露路径解析/写入/读取/聚合。
 *
 * 每行一条计数：{ts, domain, key, delta, ...}。读取端容忍坏行（跳过并计数），
 * 因为文件可能被用户手工编辑或并发截断。
 */

import { getEvaluateMetricsPath, recordEvaluateMetrics } from "@opennovel-ai/novel-store"
import { readFileSync, statSync } from "fs"
import { dirname } from "path"

/** 软上限：超过后在读取时提示归档（设计 Risks，自动压缩留 v1.1） */
export const METRICS_SOFT_LIMIT_BYTES = 5 * 1024 * 1024

/** 指标域（七域 + 预留扩展，v1.1 的 C8-C10 直接加字符串即可） */
export type MetricsDomain = "c1-runtime" | "c2-prompt-control" | "c3-recall" | "c4-context" | "c5-flow" | "c6-technique" | "c7-narrative" | (string & {})

/** 单条计数条目 */
export interface MetricsEntry {
  /** 毫秒级 Unix 时间戳 */
  ts: number
  domain: MetricsDomain
  /** 域内信号键，如 "budget.p2.trimmed" / "recall.route.entity" */
  key: string
  /** 增量（通常为 1；token/耗时类用实际数值） */
  delta: number
  /** 可选：关联会话 */
  sessionId?: string
  agent?: string
  model?: string
  /** 可选：章节号等数值型上下文 */
  chapter?: number
}

export function getMetricsDir(projectDir: string): string {
  return dirname(getMetricsPath(projectDir))
}

export function getMetricsPath(projectDir: string): string {
  return getEvaluateMetricsPath(projectDir)
}

/** 追加一条计数。IO 失败只 warn——指标是旁路观测，不是功能路径。 */
export function recordMetrics(projectDir: string, entry: Omit<MetricsEntry, "ts">): void {
  recordEvaluateMetrics(projectDir, [entry])
}

/** 追加多条计数（单次 open/fsync 批量落盘；空数组不触碰文件系统） */
export function recordMetricsBatch(projectDir: string, entries: Array<Omit<MetricsEntry, "ts">>): void {
  recordEvaluateMetrics(projectDir, entries)
}

/** 读取结果：条目 + 坏行数（坏行跳过，不抛） */
export interface MetricsReadResult {
  entries: MetricsEntry[]
  corruptLines: number
  /** 是否超过软上限（报告层据此提示归档） */
  overSoftLimit: boolean
}

/** 坏行容忍的入桶校验：四必填字段类型对了即收（额外字段原样保留，导出层脱敏） */
function isMetricsEntry(value: unknown): value is MetricsEntry {
  if (typeof value !== "object" || value === null) return false
  if (!("ts" in value) || typeof value.ts !== "number") return false
  if (!("domain" in value) || typeof value.domain !== "string") return false
  if (!("key" in value) || typeof value.key !== "string") return false
  if (!("delta" in value) || typeof value.delta !== "number") return false
  return true
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
      const parsed: unknown = JSON.parse(trimmed)
      if (isMetricsEntry(parsed)) {
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
