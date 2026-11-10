/**
 * 问题文档层 — 稳定指纹、程序控制的 frontmatter 与固定段落 Markdown。
 *
 * 指纹只由稳定事实（规范化工具名、操作场景、稳定错误码或类别、可选稳定事实）派生，
 * 不含 Session、章节名、模型自由文本、时间和绝对路径；分类演变靠别名保留历史引用，
 * 不静默重写旧文档。frontmatter 是程序的唯一写入区，采用 `---` 围栏内固定键序的
 * JSON：无需 YAML 依赖、可确定性重建索引。模型整理只能替换「原因假设 / 改进建议 /
 * 验收标准」三个段落的内容——序列化永远由本模块用程序持有的 meta 与其余段落拼装，
 * 模型文本中的围栏或标题只是普通字符，无法逃出段落边界修改 frontmatter 或其他段落。
 */
import { createHash } from "node:crypto"
import { isRecord, type ToolInsightEvidenceKind } from "./evidence.js"

export interface ToolInsightFingerprintInput {
  /** 规范化工具名；无工具问题为空串 */
  tool: string
  /** 操作场景稳定键 */
  scenario: string
  /** 稳定错误码或类别；尚无分类时为 "unknown" */
  errorCategory: string
  /** 可选稳定事实（如重复调用签名）；Session、时间、自由文本不得进入 */
  fact?: string
}

export function issueFingerprint(input: ToolInsightFingerprintInput): string {
  const parts = [input.tool.trim(), input.scenario.trim(), input.errorCategory.trim(), input.fact?.trim() ?? ""]
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16)
}

export const TOOL_INSIGHT_ISSUE_FORMAT = 1

/** 六类失败分类 + 未确认/未知；frontmatter 使用稳定英文键 */
export type ToolInsightClassification =
  | "unknown"
  | "unconfirmed"
  | "tool_impl_defect"
  | "tool_capability_gap"
  | "tool_description_or_params"
  | "agent_misuse"
  | "tool_result_misread"
  | "product_flow"

/** 影响程度枚举；信息不足保持 unknown */
export type ToolInsightImpact = "unknown" | "blocks_work" | "wrong_result" | "efficiency_loss" | "experience"

export type ToolInsightOrganizeStatus = "pending" | "organized" | "failed"

export interface ToolInsightIssueMeta {
  format: number
  fingerprint: string
  title: string
  tool: string
  scenario: string
  error_category: string
  classification: ToolInsightClassification
  impact: ToolInsightImpact
  organize_status: ToolInsightOrganizeStatus
  organize_error: string | null
  created_at: string
  updated_at: string
  first_seen_at: string
  last_seen_at: string
  occurrence_count: number
  occurrence_ids: string[]
  evidence_ids: string[]
  pending_evidence_ids: string[]
  organized_evidence_ids: string[]
  affected_versions: string[]
  aliases: string[]
}

/** 文档固定段落（顺序即渲染顺序）；标题为简体中文，正文缺失一律「未知」 */
export const ISSUE_SECTION_TITLES = [
  "用户目标",
  "实际行为",
  "期望行为",
  "复现步骤",
  "影响",
  "客观证据",
  "事实",
  "原因假设",
  "改进建议",
  "验收标准",
] as const
export type IssueSectionTitle = (typeof ISSUE_SECTION_TITLES)[number]

/** 模型整理唯一可写入的三个段落 */
export const MODEL_SECTION_TITLES = ["原因假设", "改进建议", "验收标准"] as const
export type ModelSectionTitle = (typeof MODEL_SECTION_TITLES)[number]
export type IssueSections = Partial<Record<IssueSectionTitle, string>>

export interface CreateIssueMetaInput {
  fingerprint: string
  facts: ToolInsightFingerprintInput
  /** 指纹演变前的历史指纹（新文档记录别名，不静默重写旧文档） */
  aliasOf?: string
  now: Date
}

/** 程序建立的问题骨架 frontmatter：所有列表从空开始，时间以首条证据为基准 */
export function createIssueMeta(input: CreateIssueMetaInput): ToolInsightIssueMeta {
  const now = input.now.toISOString()
  const title = `工具问题：${input.facts.tool || "无工具"} / ${input.facts.scenario || "未知场景"} / ${input.facts.errorCategory}`
  return {
    format: TOOL_INSIGHT_ISSUE_FORMAT,
    fingerprint: input.fingerprint,
    title,
    tool: input.facts.tool,
    scenario: input.facts.scenario,
    error_category: input.facts.errorCategory,
    classification: "unknown",
    impact: "unknown",
    organize_status: "pending",
    organize_error: null,
    created_at: now,
    updated_at: now,
    first_seen_at: now,
    last_seen_at: now,
    occurrence_count: 0,
    occurrence_ids: [],
    evidence_ids: [],
    pending_evidence_ids: [],
    organized_evidence_ids: [],
    affected_versions: [],
    aliases: input.aliasOf ? [input.aliasOf] : [],
  }
}

/**
 * 段落内容净化：以 `#` 开头的 Markdown 标题行会被解析器当作段落边界，模型文本若
 * 携带 `## 用户目标` 之类的行会在下一轮解析时越权冒充其他段落。渲染前对标题形状的
 * 行加 `\` 转义（CommonMark 中 `\#` 按字面渲染）；已转义行不再匹配标题形状，多次
 * 渲染幂等。
 */
function sanitizeSectionContent(content: string): string {
  return content
    .split("\n")
    .map((line) => (/^#{1,6} /.test(line) ? `\\${line}` : line))
    .join("\n")
}

export function renderIssueDoc(meta: ToolInsightIssueMeta, sections: IssueSections): string {
  const body = ISSUE_SECTION_TITLES.map((title) => `## ${title}\n\n${sanitizeSectionContent((sections[title] ?? "未知").trim())}\n`).join("\n")
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n\n# ${meta.title}\n\n${body}`
}

export type ParsedIssueDoc = { error: "corrupt" } | { error?: undefined; meta: ToolInsightIssueMeta; sections: IssueSections }

function isIssueMeta(value: unknown): value is ToolInsightIssueMeta {
  if (!isRecord(value)) return false
  return (
    typeof value.fingerprint === "string" &&
    typeof value.title === "string" &&
    typeof value.occurrence_count === "number" &&
    Array.isArray(value.evidence_ids) &&
    Array.isArray(value.pending_evidence_ids) &&
    Array.isArray(value.organized_evidence_ids)
  )
}

/** 解析问题文档：frontmatter 损坏返回 corrupt；段落缺失按空处理（渲染时补「未知」） */
export function parseIssueDoc(text: string): ParsedIssueDoc {
  if (!text.startsWith("---\n")) return { error: "corrupt" }
  const end = text.indexOf("\n---\n", 4)
  if (end === -1) return { error: "corrupt" }
  let meta: unknown
  try {
    meta = JSON.parse(text.slice(4, end))
  } catch {
    return { error: "corrupt" }
  }
  if (!isIssueMeta(meta)) return { error: "corrupt" }

  const body = text.slice(end + 5)
  const sections: IssueSections = {}
  let current: string | null = null
  let buffer: string[] = []
  const isIssueSectionTitle = (value: string): value is IssueSectionTitle => (ISSUE_SECTION_TITLES as readonly string[]).includes(value)
  const flush = () => {
    // 未知标题段落不属于规范段落，渲染时只按已知标题读取，跳过即可
    if (current !== null && isIssueSectionTitle(current)) sections[current] = buffer.join("\n").trim()
  }
  for (const line of body.split("\n")) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      flush()
      current = heading[1]!
      buffer = []
      continue
    }
    if (current !== null) buffer.push(line)
  }
  flush()
  return { meta, sections }
}

/** 「事实」段落由 meta 确定性渲染，每次写盘重建，不累积过期内容 */
export function renderFactsSection(meta: ToolInsightIssueMeta): string {
  const lines = [
    `- 工具：${meta.tool || "未知"}`,
    `- 操作场景：${meta.scenario || "未知"}`,
    `- 错误类别：${meta.error_category}`,
    `- 发生次数：${meta.occurrence_count}`,
    `- 影响版本：${meta.affected_versions.length > 0 ? meta.affected_versions.join("、") : "未知"}`,
  ]
  if (meta.aliases.length > 0) lines.push(`- 历史指纹：${meta.aliases.join("、")}`)
  return lines.join("\n")
}

/** 「客观证据」段落的单行引用；一行一条，按落盘顺序排列 */
export function renderEvidenceLine(input: { evidenceID: string; occurredAt: number; kind: ToolInsightEvidenceKind; occurrenceID: string }): string {
  return `- ${input.evidenceID}（${new Date(input.occurredAt).toISOString()}，${input.kind}，${input.occurrenceID}）`
}

export interface ToolInsightIndexEntry {
  fingerprint: string
  title: string
  classification: ToolInsightClassification
  impact: ToolInsightImpact
  organize_status: ToolInsightOrganizeStatus
  occurrence_count: number
  last_seen_at: string
  aliases: string[]
}

/** 总索引只从 frontmatter 渲染，按指纹排序，同集合字节级一致 */
export function renderToolInsightIndex(metas: readonly ToolInsightIndexEntry[]): string {
  const sorted = [...metas].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0))
  const rows = sorted.map(
    (entry) =>
      `| ${entry.fingerprint} | ${entry.title} | ${entry.classification} | ${entry.impact} | ${entry.organize_status} | ${entry.occurrence_count} | ${entry.last_seen_at} | ${entry.aliases.length > 0 ? entry.aliases.join("、") : "-"} |`,
  )
  return [
    "# 工具问题索引",
    "",
    `共 ${sorted.length} 个问题。`,
    "",
    "| 指纹 | 标题 | 分类 | 影响程度 | 整理状态 | 次数 | 最近发生 | 别名 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}
