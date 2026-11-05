/**
 * 自评价报告生成器（design D3：纯规则模板，无 LLM）
 *
 * 三分部固定结构：
 * - A 创作复盘：卡壳地图（回滚/审批拒绝/大改交叉）、结构断更风险、批注密度
 * - B 配置优化：裁剪热点 → P0-P6 分配建议；规则映射表逐条求值，只输出命中项
 * - C 产品信号：七域计数表 + 失败分类法 + Top 复现要点
 *
 * 范围参数：上次报告以来（默认）/ 本卷 / 最近 N 会话 / 全部。
 * 空数据只输出"暂无数据/无建议"，不编造任何建议或计数。
 * 产物落 `.novel/evaluate/<yyyy-mm-dd>-<scope>.md`，并把本次运行时间戳记入
 * `.novel/evaluate/last-report.json` 作为"上次报告以来"的窗口起点。
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { desc, eq } from "drizzle-orm"
import { ChapterTable, getDb, NovelTable } from "../session-store.js"
import { getMetricsDir, readMetrics, type MetricsEntry } from "./metrics.js"

// ─── 范围参数 ───

export type ReportScope =
  | { kind: "since-last" }
  | { kind: "volume" }
  | { kind: "sessions"; count: number }
  | { kind: "all" }

export interface ReportResult {
  path: string
  markdown: string
  generatedAt: number
  scopeSlug: string
  entryCount: number
  window: { fromTs: number; toTs: number }
}

const STATE_FILE = "last-report.json"

function scopeSlug(scope: ReportScope): string {
  if (scope.kind === "sessions") return `sessions-${scope.count}`
  return scope.kind
}

function getStatePath(projectDir: string): string {
  return join(getMetricsDir(projectDir), STATE_FILE)
}

function readLastRunTs(projectDir: string): number {
  try {
    const raw = JSON.parse(readFileSync(getStatePath(projectDir), "utf8"))
    return typeof raw.lastRunTs === "number" ? raw.lastRunTs : 0
  } catch {
    return 0
  }
}

/** 自动报告冷却水位：最后一次自动触发的时间戳（0=从未）。触发层（trigger.ts）读写。 */
export function readLastAutoRunTs(projectDir: string): number {
  try {
    const raw: unknown = JSON.parse(readFileSync(getStatePath(projectDir), "utf8"))
    if (typeof raw !== "object" || raw === null || !("lastAutoRunTs" in raw) || typeof raw.lastAutoRunTs !== "number") {
      return 0
    }
    return raw.lastAutoRunTs
  } catch {
    return 0
  }
}

/** 自动报告落盘后标定冷却水位；手动报告推进的 lastRunTs 窗口原样保留。 */
export function markAutoReport(projectDir: string, autoRunTs: number): void {
  try {
    const prev: unknown = JSON.parse(readFileSync(getStatePath(projectDir), "utf8"))
    const lastRunTs =
      typeof prev === "object" && prev !== null && "lastRunTs" in prev && typeof prev.lastRunTs === "number"
        ? prev.lastRunTs
        : 0
    const path =
      typeof prev === "object" && prev !== null && "path" in prev && typeof prev.path === "string" ? prev.path : ""
    writeFileSync(getStatePath(projectDir), JSON.stringify({ lastRunTs, path, lastAutoRunTs: autoRunTs }) + "\n", "utf8")
  } catch (err) {
    console.warn(`[evaluate] 写自动报告冷却状态失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function writeState(projectDir: string, generatedAt: number, path: string): void {
  try {
    mkdirSync(getMetricsDir(projectDir), { recursive: true })
    // 合并保留 lastAutoRunTs：手动报告推进"上次报告以来"窗口，但不重置自动冷却节奏
    const lastAutoRunTs = readLastAutoRunTs(projectDir)
    writeFileSync(
      getStatePath(projectDir),
      JSON.stringify({
        lastRunTs: generatedAt,
        path,
        ...(lastAutoRunTs > 0 ? { lastAutoRunTs } : {}),
      }) + "\n",
      "utf8",
    )
  } catch (err) {
    console.warn(`[evaluate] 写报告状态失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── 范围解析 ───

/** 取项目内"当前小说"：最近有章节活动的小说（多书项目的报告锚点） */
function resolveActiveNovelId(projectDir: string): string | null {
  const db = getDb(projectDir)
  const [row] = db
    .select({ id: ChapterTable.novel_id })
    .from(ChapterTable)
    .orderBy(desc(ChapterTable.order))
    .limit(1)
    .all()
  if (row) return row.id
  const [novel] = db.select({ id: NovelTable.id }).from(NovelTable).limit(1).all()
  return novel?.id ?? null
}

/** 本卷范围：当前小说最新章所属卷的章序号集合 */
function currentVolumeOrders(projectDir: string): Set<number> | null {
  const novelId = resolveActiveNovelId(projectDir)
  if (!novelId) return null
  const db = getDb(projectDir)
  const [latest] = db
    .select({ volume_id: ChapterTable.volume_id })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .orderBy(desc(ChapterTable.order))
    .limit(1)
    .all()
  if (!latest?.volume_id) return null
  const orders = db
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.volume_id, latest.volume_id))
    .all()
    .map((r) => r.order)
  return new Set(orders)
}

function filterByScope(entries: MetricsEntry[], scope: ReportScope, projectDir: string): MetricsEntry[] {
  if (scope.kind === "since-last") return entries.filter((e) => e.ts > readLastRunTs(projectDir))
  if (scope.kind === "all") return entries
  if (scope.kind === "volume") {
    const orders = currentVolumeOrders(projectDir)
    if (!orders) return []
    return entries.filter((e) => e.chapter == null || orders.has(e.chapter))
  }
  // 按 sessionId 最后出现时间取最近 N 个会话
  const lastSeen = new Map<string, number>()
  for (const e of entries) {
    if (e.sessionId) lastSeen.set(e.sessionId, Math.max(lastSeen.get(e.sessionId) ?? 0, e.ts))
  }
  const recent = new Set(
    [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, scope.count).map(([id]) => id),
  )
  return entries.filter((e) => e.sessionId == null || recent.has(e.sessionId))
}

// ─── 模式切换审计（B 部规则原料） ───

interface ModeAuditRow {
  ts: number
  patch?: { writing_mode?: string }
}

function parseModeAuditRow(line: string): ModeAuditRow | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== "object" || value === null || !("ts" in value) || typeof value.ts !== "number") {
      return undefined
    }
    if (!("patch" in value) || typeof value.patch !== "object" || value.patch === null) return { ts: value.ts }
    if (!("writing_mode" in value.patch) || typeof value.patch.writing_mode !== "string") return { ts: value.ts }
    return { ts: value.ts, patch: { writing_mode: value.patch.writing_mode } }
  } catch {
    return undefined
  }
}

function readModeSwitches(projectDir: string, fromTs: number, toTs: number): number {
  try {
    const content = readFileSync(join(projectDir, ".novel", "audit", "mode.jsonl"), "utf8")
    let count = 0
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      const row = parseModeAuditRow(line)
      if (!row || row.ts < fromTs || row.ts > toTs || !row.patch?.writing_mode) continue
      count++
    }
    return count
  } catch {
    return 0
  }
}

// ─── 报告组装 ───

type Aggregates = Record<string, Record<string, number>>

function sum(agg: Aggregates, domain: string, prefix: string): number {
  return Object.entries(agg[domain] ?? {})
    .filter(([key]) => key.startsWith(prefix))
    .reduce((total, [, delta]) => total + delta, 0)
}

function count(agg: Aggregates, domain: string, prefix: string): number {
  return Object.keys(agg[domain] ?? {}).filter((key) => key.startsWith(prefix)).length
}

const DOMAIN_LABELS: Array<[string, string]> = [
  ["c1-runtime", "C1 运行时"],
  ["c2-prompt-control", "C2 提示词控制"],
  ["c3-recall", "C3 召回"],
  ["c4-context", "C4 上下文拼接"],
  ["c5-flow", "C5 流程"],
  ["c6-technique", "C6 技法"],
  ["c7-narrative", "C7 叙事质量"],
]

/** 失败分类法：键前缀 → 类别（C 部与诊断包错误样本共用） */
export const FAILURE_TAXONOMY: Array<[string, string]> = [
  ["tool.failed.", "运行时失败"],
  ["step.failed", "运行时失败"],
  ["scene.compile.null", "提示词控制"],
  ["driftguard.finding", "提示词控制"],
  ["approval.rejected", "提示词控制"],
  ["recall.zero", "召回空转"],
  ["budget.", "拼接裁剪"],
  ["technique.p7.trimmed", "拼接裁剪"],
  ["version.rollback", "流程回滚"],
  ["hook.warning.", "叙事风险"],
  ["continuity.dim.", "叙事风险"],
  ["structure.issue.", "叙事风险"],
]

interface RuleContext {
  agg: Aggregates
  modeSwitches: number
}

/** B 部规则映射表（v1 知识资产，随真实使用迭代；条件不满足即不输出） */
const CONFIG_RULES: Array<{ id: string; when: (ctx: RuleContext) => boolean; advice: (ctx: RuleContext) => string }> = [
  {
    id: "B1",
    when: ({ agg }) => sum(agg, "c4-context", "budget.p2.trimmed") > 0 && sum(agg, "c4-context", "budget.p4.occupied") > 0,
    advice: ({ agg }) => {
      const trimmed = sum(agg, "c4-context", "budget.p2.trimmed")
      return `P2（近期章节摘要）发生 ${trimmed} token 裁剪且 P4（风格指南）有占用：可考虑精简风格规则数量或缩短单条规则，为 P2 让出空间。`
    },
  },
  {
    id: "B2",
    when: ({ agg }) => {
      const checked = sum(agg, "c2-prompt-control", "scene.compile.checked")
      const nullCount = sum(agg, "c2-prompt-control", "scene.compile.null")
      return checked >= 3 && nullCount / checked > 0.3
    },
    advice: ({ agg }) => {
      const checked = sum(agg, "c2-prompt-control", "scene.compile.checked")
      const nullCount = sum(agg, "c2-prompt-control", "scene.compile.null")
      return `章纲缺「## 关键场景」段的占比 ${Math.round((nullCount / checked) * 100)}% 偏高：场景硬约束清单来自该段，建议规范章纲模板。`
    },
  },
  {
    id: "B3",
    when: ({ agg }) => sum(agg, "c5-flow", "version.rollback") >= 2,
    advice: ({ agg }) =>
      `版本回滚出现 ${sum(agg, "c5-flow", "version.rollback")} 次：可检查对应章节的审批反馈是否稳定，或把写作批次拆小。`,
  },
  {
    id: "B4",
    when: ({ agg }) => {
      const requested = sum(agg, "c2-prompt-control", "approval.requested")
      const rejected = sum(agg, "c2-prompt-control", "approval.rejected")
      return requested >= 2 && rejected / requested > 0.3
    },
    advice: ({ agg }) => {
      const requested = sum(agg, "c2-prompt-control", "approval.requested")
      const rejected = sum(agg, "c2-prompt-control", "approval.rejected")
      return `审批拒绝率 ${Math.round((rejected / requested) * 100)}% 偏高：可在章纲阶段加强 director 与 writer 的约束对齐，减少返工。`
    },
  },
  {
    id: "B5",
    when: ({ modeSwitches }) => modeSwitches >= 3,
    advice: ({ modeSwitches }) => `写作模式窗口内切换 ${modeSwitches} 次：稳定模式可减少上下文重渲染成本。`,
  },
  {
    id: "B6",
    when: ({ agg }) => sum(agg, "c7-narrative", "hook.warning.") > 0,
    advice: ({ agg }) =>
      `钩子类型连续单一触发 ${sum(agg, "c7-narrative", "hook.warning.")} 次警告：可在 director 提示词中强调四种钩子轮换。`,
  },
]

export function localDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function sectionA(agg: Aggregates): string[] {
  const lines: string[] = ["## A. 创作复盘", "", "### 卡壳地图"]
  const rollback = sum(agg, "c5-flow", "version.rollback")
  const requested = sum(agg, "c2-prompt-control", "approval.requested")
  const rejected = sum(agg, "c2-prompt-control", "approval.rejected")
  const diffChecked = sum(agg, "c2-prompt-control", "paragraph.diff.checked")
  const added = sum(agg, "c2-prompt-control", "paragraph.diff.added_chars")
  const removed = sum(agg, "c2-prompt-control", "paragraph.diff.removed_chars")
  if (rollback + requested + rejected + diffChecked === 0) {
    lines.push("- 暂无数据（窗口内无回滚/审批/版本对比记录）。")
  } else {
    lines.push(`- 版本回滚：${rollback} 次`)
    lines.push(`- 审批请求：${requested} 次，拒绝：${rejected} 次${requested > 0 ? `（拒绝率 ${Math.round((rejected / requested) * 100)}%）` : ""}`)
    lines.push(`- 版本间改写：${diffChecked} 次对比，合计 +${added} / -${removed} 字`)
  }

  lines.push("", "### 结构断更风险")
  const structureIssues = count(agg, "c7-narrative", "structure.issue.")
  const failDims = Object.entries(agg["c7-narrative"] ?? {})
    .filter(([key, delta]) => key.startsWith("continuity.dim.") && key.endsWith(".fail") && delta > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (structureIssues === 0 && failDims.length === 0) {
    lines.push("- 暂无数据（窗口内无结构检查问题与连续性 FAIL 维度）。")
  } else {
    if (structureIssues > 0) lines.push(`- 结构检查发现 ${structureIssues} 类问题（详见 C 部失败分类法）。`)
    for (const [key, delta] of failDims) {
      lines.push(`- 连续性 FAIL：${key.replace("continuity.dim.", "").replace(".fail", "")} × ${delta}`)
    }
  }

  lines.push("", "### 批注密度")
  const listed = sum(agg, "c2-prompt-control", "annotation.listed")
  const open = sum(agg, "c2-prompt-control", "annotation.issues.open")
  if (listed === 0) {
    lines.push("- 暂无数据（窗口内无批注读取记录）。")
  } else {
    lines.push(`- 批注读取 ${listed} 次，未决（open）问题 ${open} 条。`)
  }
  return lines
}

function sectionB(agg: Aggregates, modeSwitches: number): string[] {
  const lines: string[] = ["## B. 配置优化建议", ""]
  const ctx: RuleContext = { agg, modeSwitches }
  const hits = CONFIG_RULES.filter((rule) => rule.when(ctx))
  if (hits.length === 0) {
    lines.push("本轮无配置建议（规则均未命中或窗口内无数据）。")
  } else {
    for (const rule of hits) {
      lines.push(`- [${rule.id}] ${rule.advice(ctx)}`)
    }
  }
  return lines
}

function sectionC(agg: Aggregates): string[] {
  const lines: string[] = ["## C. 产品信号", "", "### 七域计数表"]
  let anyDomain = false
  for (const [domain, label] of DOMAIN_LABELS) {
    const keys = Object.entries(agg[domain] ?? {})
    const total = keys.reduce((n, [, delta]) => n + delta, 0)
    if (total === 0) continue
    anyDomain = true
    lines.push(`- ${label}：合计 ${total}`)
    for (const [key, delta] of keys.sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      lines.push(`  - ${key} × ${delta}`)
    }
  }
  if (!anyDomain) lines.push("- 暂无数据。")

  lines.push("", "### 失败分类法")
  const taxonomy = new Map<string, number>()
  for (const keys of Object.values(agg)) {
    for (const [key, delta] of Object.entries(keys)) {
      const hit = FAILURE_TAXONOMY.find(([prefix]) => key.startsWith(prefix))
      if (!hit) continue
      taxonomy.set(hit[1], (taxonomy.get(hit[1]) ?? 0) + delta)
    }
  }
  if (taxonomy.size === 0) {
    lines.push("- 窗口内无可归类失败信号。")
  } else {
    for (const [label, delta] of [...taxonomy.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${label}：${delta}`)
    }
  }

  lines.push("", "### Top 复现要点（窗口内计数最高的键）")
  const all = Object.entries(agg)
    .flatMap(([domain, keys]) => Object.entries(keys).map(([key, delta]): [string, string, number] => [domain, key, delta]))
    .sort((a, b) => b[2] - a[2])
    .slice(0, 5)
  if (all.length === 0) {
    lines.push("- 暂无数据。")
  } else {
    for (const [domain, key, delta] of all) {
      lines.push(`- ${key} × ${delta}（${domain}）`)
    }
  }
  return lines
}

// ─── 主入口 ───

export function generateReport(projectDir: string, scope: ReportScope = { kind: "since-last" }, now = Date.now()): ReportResult {
  const { entries } = readMetrics(projectDir)
  const scoped = filterByScope(entries, scope, projectDir)
  const agg: Aggregates = {}
  for (const e of scoped) {
    const keys = agg[e.domain] ?? {}
    keys[e.key] = (keys[e.key] ?? 0) + e.delta
    agg[e.domain] = keys
  }
  const fromTs = scoped.length > 0 ? Math.min(...scoped.map((e) => e.ts)) : readLastRunTs(projectDir)
  const modeSwitches = readModeSwitches(projectDir, fromTs, now)

  const lines: string[] = [
    "# openNovel 创作自评价报告",
    "",
    `- 生成时间：${new Date(now).toLocaleString("zh-CN")}`,
    `- 范围：${scopeSlug(scope)}（窗口内指标条目 ${scoped.length} 条）`,
    "",
    ...sectionA(agg),
    "",
    ...sectionB(agg, modeSwitches),
    "",
    ...sectionC(agg),
    "",
  ]
  const markdown = lines.join("\n")

  const dir = getMetricsDir(projectDir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${localDate(now)}-${scopeSlug(scope)}.md`)
  writeFileSync(path, markdown, "utf8")
  writeState(projectDir, now, path)

  return { path, markdown, generatedAt: now, scopeSlug: scopeSlug(scope), entryCount: scoped.length, window: { fromTs, toTs: now } }
}
