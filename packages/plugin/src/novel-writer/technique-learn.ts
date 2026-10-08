import { filterTechniques } from "./technique-extract.js"
import { normalizeTechniqueEvidence } from "./session-store.js"
import { normalizeTechnique } from "./technique-normalize.js"
import {
  upsertTechnique,
  findTechniquesByName,
  mergeTechniqueEvidence,
  listAllTechniques,
  incrementTechniqueUsage,
} from "./technique-store.js"
import { applyP7Budget, formatTechniquesForPrompt } from "./technique-inject.js"
import type { TechniqueEntry, TechniqueLevel, TechniqueScope, TechniqueStatus } from "./technique.js"

export interface SaveTechniqueInput {
  name: string
  principle: string
  instruction: string
  sceneTypes: string[]
  level: TechniqueLevel
  evidence: { sourceTitle: string; sourceLocation: string; excerpt: string; annotation: string }[]
  commonMisuse: string
  /** 内容性质（必填，无缺省）：general=通用写法入全局库；adult=成人内容留本书库 */
  scope: TechniqueScope
}

export type SaveTechniqueResult =
  | { action: "created"; technique_id: string }
  | { action: "merged"; technique_id: string }
  | { action: "rejected"; reason: string }

/**
 * save_technique 工具的核心逻辑：过滤 → 规范化 → 同名/显式合并 → 按 scope 路由入库。
 * 路由规则：general 入全局通用技法库（跨书共享）；adult 留本书库。同名合并只在目标库内进行。
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
  const library = ready.scope === "general" ? "global" : "book"

  if (mergeTargetId) {
    const ok = await mergeTechniqueEvidence(mergeTargetId, ready.evidence, directory, library)
    if (!ok) return { action: "rejected", reason: "合并目标不存在" }
    return { action: "merged", technique_id: mergeTargetId }
  }

  const sameName = await findTechniquesByName(entry.name, directory, library)
  if (sameName.length > 0) {
    const target = sameName[0]
    await mergeTechniqueEvidence(target.id, ready.evidence, directory, library)
    return { action: "merged", technique_id: target.id }
  }

  await upsertTechnique(ready, directory, library)
  return { action: "created", technique_id: entry.id }
}

export interface SearchTechniquesFilter {
  keyword?: string
  sceneType?: string
  level?: TechniqueLevel
  status?: TechniqueStatus
  limit?: number
}

/** search_techniques 工具的核心逻辑（双源：本书库 + 全局库，结果标注来源） */
export async function searchTechniques(
  filter: SearchTechniquesFilter,
  directory: string | null,
): Promise<{ lines: string[]; count: number }> {
  const all = await listAllTechniques(directory)
  const keyword = filter.keyword?.trim().toLowerCase() ?? ""
  const matched = all
    .filter(
      ({ entry }) =>
        keyword === "" || `${entry.name} ${entry.principle} ${entry.instruction}`.toLowerCase().includes(keyword),
    )
    .filter(({ entry }) => filter.sceneType === undefined || entry.sceneTypes.includes(filter.sceneType))
    .filter(({ entry }) => filter.level === undefined || entry.level === filter.level)
    .filter(({ entry }) => filter.status === undefined || entry.status === filter.status)
    .slice(0, filter.limit ?? 10)

  const lines = matched.map(
    ({ entry, library }) =>
      `- [${entry.id}]${library === "global" ? "[通用库]" : "[本书]"} ${entry.name}（${entry.status}/${entry.confidence.toFixed(2)}）：${entry.instruction.slice(0, 80)}`,
  )
  return { lines, count: matched.length }
}

/** confirm_techniques 工具的核心逻辑：双源取条目 + 计数 + 预算裁剪 + 段落格式化 */
export async function confirmTechniques(
  ids: string[],
  directory: string | null,
): Promise<{ section: string; injected: number; injected_ids: string[] }> {
  const all = await listAllTechniques(directory)
  const picked = all
    .filter(({ entry }) => ids.includes(entry.id))
    .map(({ entry, library }) => ({ entry, matchScore: entry.confidence, library }))
  if (picked.length === 0) return { section: "", injected: 0, injected_ids: [] }

  const budgeted = applyP7Budget(picked)
  for (const t of budgeted) {
    await incrementTechniqueUsage(t.entry.id, directory, t.library)
  }
  return {
    section: formatTechniquesForPrompt(budgeted),
    injected: budgeted.length,
    injected_ids: budgeted.map((t) => t.entry.id),
  }
}
