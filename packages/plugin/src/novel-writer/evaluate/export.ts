/**
 * 诊断包导出（design D5）：evaluate 工具 export 子命令的落点。
 *
 * 分级（累积式）：L0 纯计数 / L1 +错误分类样本 / L2 +复现事件序列。
 * 产物落 `.novel/evaluate/diagnostics-<日期>-<级别>.json`，只读指标桶，零网络路径。
 *
 * 隐私红线（spec「诊断包分级导出」）：
 * - 任何级别不含小说正文；genre 题材值不进 L0/L1（白名单字段+字符串截断，
 *   手工编辑进桶的任意额外字段整条丢弃）
 * - L2 复现序列仍走同一脱敏管道；其"可能含题材信息"提示由工具输出层明示
 */
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { aggregateMetrics, getMetricsDir, readMetrics, type MetricsEntry } from "./metrics.js"
import { FAILURE_TAXONOMY, localDate } from "./report.js"

export type ExportLevel = "L0" | "L1" | "L2"

export interface DiagnosticsResult {
  path: string
  level: ExportLevel
  entryCount: number
  corruptLines: number
  generatedAt: number
  sampleCount: number
  reproCount: number
  truncated: { samples: boolean; repro: boolean }
}

const MAX_SAMPLES_TOTAL = 50
const MAX_REPRO_ENTRIES = 500
const STRING_FIELD_MAX = 80
/** 条目白名单字段：数值型上下文与标识符；名单外字段一律丢弃（防夹带正文/题材值） */
const ENTRY_FIELDS = new Set(["ts", "domain", "key", "delta", "sessionId", "agent", "model", "chapter"])

function classify(key: string): string | undefined {
  return FAILURE_TAXONOMY.find(([prefix]) => key.startsWith(prefix))?.[1]
}

function redactEntry(e: MetricsEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(e)) {
    if (!ENTRY_FIELDS.has(field)) continue
    out[field] = typeof value === "string" && value.length > STRING_FIELD_MAX ? `${value.slice(0, STRING_FIELD_MAX)}…` : value
  }
  return out
}

/** 导出分级诊断包。level 缺省由调用方（工具层）给 L1。 */
export function exportDiagnostics(projectDir: string, level: ExportLevel, now = Date.now()): DiagnosticsResult {
  const { entries, corruptLines } = readMetrics(projectDir)
  const truncated = { samples: false, repro: false }
  const bundle: Record<string, unknown> = {
    format: "opennovel-evaluate-diagnostics",
    level,
    generated_at: now,
    entry_count: entries.length,
    corrupt_lines: corruptLines,
    counts: aggregateMetrics(entries),
  }

  let sampleCount = 0
  let reproCount = 0
  if (level !== "L0") {
    const failing = entries.filter((e) => classify(e.key) !== undefined)
    truncated.samples = failing.length > MAX_SAMPLES_TOTAL
    const samples = failing.slice(0, MAX_SAMPLES_TOTAL)
    bundle.error_samples = samples.map((e) => ({ category: classify(e.key), ...redactEntry(e) }))
    sampleCount = samples.length
  }
  if (level === "L2") {
    const ordered = [...entries].sort((a, b) => a.ts - b.ts)
    truncated.repro = ordered.length > MAX_REPRO_ENTRIES
    const repro = ordered.slice(0, MAX_REPRO_ENTRIES)
    bundle.repro_sequence = repro.map(redactEntry)
    reproCount = repro.length
  }
  if (truncated.samples || truncated.repro) bundle.truncated = truncated

  const dir = getMetricsDir(projectDir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `diagnostics-${localDate(now)}-${level}.json`)
  writeFileSync(path, JSON.stringify(bundle, null, 2) + "\n", "utf8")
  return { path, level, entryCount: entries.length, corruptLines, generatedAt: now, sampleCount, reproCount, truncated }
}
