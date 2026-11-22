import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join } from "path"
import { filterTechniques } from "./technique-extract.js"
import { normalizeTechniqueEvidence } from "./session-store.js"
import { normalizeTechnique } from "./technique-normalize.js"
import {
  upsertTechnique,
  findTechniquesByName,
  mergeTechniqueEvidence,
  listTechniques,
  incrementTechniqueUsage,
  retireTechniqueAsPromoted,
} from "./technique-store.js"
import { applyP7Budget, formatTechniquesForPrompt } from "./technique-inject.js"
import { recordMetricsBatch } from "./evaluate/metrics.js"
import type { TechniqueEntry, TechniqueLevel, TechniqueScope, TechniqueStatus } from "./technique.js"

export interface SaveTechniqueInput {
  name: string
  principle: string
  instruction: string
  sceneTypes: string[]
  level: TechniqueLevel
  evidence: { sourceTitle: string; sourceLocation: string; excerpt: string; annotation: string }[]
  commonMisuse: string
  /** 内容性质（必填，无缺省）：general=通用写法；adult=成人内容。只影响召回闸门，不决定存储位置。 */
  scope: TechniqueScope
}

export type SaveTechniqueResult =
  | { action: "created"; technique_id: string }
  | { action: "merged"; technique_id: string }
  | { action: "rejected"; reason: string }

/**
 * save_technique 工具的核心逻辑：过滤 → 规范化 → 同名/显式合并 → 写入当前书籍库。
 * scope 只保留内容性质语义，不决定存储位置。
 */
export async function saveTechnique(
  input: SaveTechniqueInput,
  mergeTargetId: string | undefined,
  directory: string | null,
): Promise<SaveTechniqueResult> {
  // 性质判断是入库前的唯一人工/agent 判断点：工具层必填的刚性化兜底（防 JS 调用方绕过 schema）
  if (input.scope !== "general" && input.scope !== "adult") {
    return { action: "rejected", reason: "缺少必填的性质(scope)判断" }
  }

  const candidate: Partial<TechniqueEntry> = { ...input }

  // 复用提取管线的过滤规则：模糊指令黑名单、指令长度、必须有证据
  const filtered = filterTechniques([candidate])
  if (filtered.length === 0) {
    return { action: "rejected", reason: "模糊指令或无证据" }
  }
  const entry = normalizeTechnique(filtered[0])
  // 入库前证据规范化：缺 sourceTitle 按 sourceLocation 回填、其余补空串；不可修复的候选拒绝入库
  const normalized = normalizeTechniqueEvidence(entry.evidence)
  if (!normalized.ok) return { action: "rejected", reason: normalized.reason }
  const ready: TechniqueEntry = { ...entry, evidence: normalized.evidence }

  if (mergeTargetId) {
    const ok = await mergeTechniqueEvidence(mergeTargetId, ready.evidence, directory)
    if (!ok) return { action: "rejected", reason: "合并目标不存在" }
    return { action: "merged", technique_id: mergeTargetId }
  }

  const sameName = await findTechniquesByName(entry.name, directory)
  if (sameName.length > 0) {
    const target = sameName[0]
    await mergeTechniqueEvidence(target.id, ready.evidence, directory)
    return { action: "merged", technique_id: target.id }
  }

  await upsertTechnique(ready, directory)
  return { action: "created", technique_id: entry.id }
}

export interface SearchTechniquesFilter {
  keyword?: string
  sceneType?: string
  level?: TechniqueLevel
  status?: TechniqueStatus
  limit?: number
}

/** search_techniques 工具的核心逻辑（当前书籍库单源）。 */
export async function searchTechniques(
  filter: SearchTechniquesFilter,
  directory: string | null,
): Promise<{ lines: string[]; count: number; total: number; unverified: number }> {
  const all = await listTechniques(directory)
  const keyword = filter.keyword?.trim().toLowerCase() ?? ""
  const matched = all
    .filter(
      (entry) =>
        keyword === "" || `${entry.name} ${entry.principle} ${entry.instruction}`.toLowerCase().includes(keyword),
    )
    .filter((entry) => filter.sceneType === undefined || entry.sceneTypes.includes(filter.sceneType))
    .filter((entry) => filter.level === undefined || entry.level === filter.level)
    .filter((entry) => filter.status === undefined || entry.status === filter.status)
    .slice(0, filter.limit ?? 10)

  const lines = matched.map(
    (entry) =>
      `- [${entry.id}] ${entry.name}（${entry.status}/${entry.confidence.toFixed(2)}）：${entry.instruction.slice(0, 80)}`,
  )
  // total/unverified 为过滤前计数：空结果反馈据此区分"库为空"与"过滤后无匹配"
  return {
    lines,
    count: matched.length,
    total: all.length,
    unverified: all.filter((entry) => entry.status === "unverified").length,
  }
}

/** confirm_techniques 工具的核心逻辑：本书库取条目 + 计数 + 预算裁剪 + 段落格式化。 */
export async function confirmTechniques(
  ids: string[],
  directory: string | null,
  chapterOrder?: number,
): Promise<{ section: string; injected: number; injected_ids: string[] }> {
  const all = await listTechniques(directory)
  const picked = all
    .filter((entry) => ids.includes(entry.id))
    .map((entry) => ({ entry, matchScore: entry.confidence }))
  if (picked.length === 0) return { section: "", injected: 0, injected_ids: [] }

  const budgeted = applyP7Budget(picked)
  // 自评价埋点：注入数与 P7 截断量（C6 技法信号）
  if (directory) {
    const p7Trimmed = picked.length - budgeted.length
    recordMetricsBatch(directory, [
      { domain: "c6-technique", key: "technique.confirmed", delta: 1 },
      { domain: "c6-technique", key: "technique.injected", delta: budgeted.length },
      ...(p7Trimmed > 0
        ? [{ domain: "c6-technique", key: "technique.p7.trimmed", delta: p7Trimmed }]
        : []),
    ])
  }
  for (const t of budgeted) {
    // 饱和度账本（agent-memory-system §2.2）：带章序记录按章使用分布
    await incrementTechniqueUsage(t.entry.id, directory, chapterOrder)
  }
  return {
    section: formatTechniquesForPrompt(budgeted),
    injected: budgeted.length,
    injected_ids: budgeted.map((t) => t.entry.id),
  }
}

export type PromoteTechniqueResult =
  | { ok: true; technique_id: string; spec_path: string }
  | { ok: false; error: string }

/**
 * 晋升/固化通道（agent-memory-system §6 通道 3）：verified 技法固化进分层规范文件
 * （agent-instruction-layering 领地：`<project>/.novel/instructions/<layer>.md`），
 * 随后技法行 retired + promoted_from 留痕（不删行）。
 * 重复调用安全：规范文件已含该技法段落时跳过追加；状态门槛（仅 verified 可固化）
 * 使已 retired 的技法重复固化时报错，不会产生重复段落或状态回退。
 */
export async function promoteTechniqueToSpec(
  id: string,
  directory: string,
  layer = "book",
): Promise<PromoteTechniqueResult> {
  const all = await listTechniques(directory)
  const entry = all.find((item) => item.id === id)
  if (!entry) return { ok: false, error: `技法不存在：${id.slice(0, 8)}` }

  const instructionsDir = join(directory, ".novel", "instructions")
  const specPath = join(instructionsDir, `${layer}.md`)
  const block = [
    `## 技法：${entry.name}`,
    "",
    `- 原则：${entry.principle}`,
    `- 指令：${entry.instruction}`,
    ...(entry.commonMisuse ? [`- 常见误用：${entry.commonMisuse}`] : []),
    "",
    `（自技法库固化，源技法 id=${entry.id}，confidence=${entry.confidence.toFixed(2)}）`,
    "",
  ].join("\n")

  // 先落规范文件，再流转状态机：文件写失败时技法保持 verified，不留半固化状态
  mkdirSync(instructionsDir, { recursive: true })
  const already = existsSync(specPath) && readFileSync(specPath, "utf-8").includes(`源技法 id=${entry.id}`)
  if (!already) appendFileSync(specPath, (existsSync(specPath) ? "\n" : "") + block, "utf-8")

  const retired = await retireTechniqueAsPromoted(entry.id, `.novel/instructions/${layer}.md`, directory)
  if (!retired.ok) return { ok: false, error: retired.error }
  return { ok: true, technique_id: entry.id, spec_path: `.novel/instructions/${layer}.md` }
}
