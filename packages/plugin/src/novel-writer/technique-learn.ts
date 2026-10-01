import { filterTechniques } from "./technique-extract.js"
import { normalizeTechnique } from "./technique-normalize.js"
import {
  upsertTechnique,
  findTechniquesByName,
  mergeTechniqueEvidence,
  listTechniques,
  incrementTechniqueUsage,
} from "./technique-store.js"
import { applyP7Budget, formatTechniquesForPrompt } from "./technique-inject.js"
import type { TechniqueEntry, TechniqueLevel, TechniqueStatus } from "./technique.js"

export interface SaveTechniqueInput {
  name: string
  principle: string
  instruction: string
  sceneTypes: string[]
  level: TechniqueLevel
  evidence: { sourceTitle: string; sourceLocation: string; excerpt: string; annotation: string }[]
  commonMisuse: string
}

export type SaveTechniqueResult =
  | { action: "created"; technique_id: string }
  | { action: "merged"; technique_id: string }
  | { action: "rejected"; reason: string }

/** save_technique 工具的核心逻辑：过滤 → 规范化 → 同名/显式合并 → 入库 */
export async function saveTechnique(
  input: SaveTechniqueInput,
  mergeTargetId: string | undefined,
  directory: string | null,
): Promise<SaveTechniqueResult> {
  const candidate: Partial<TechniqueEntry> = { ...input }

  // 复用提取管线的过滤规则：模糊指令黑名单、指令长度、必须有证据
  const filtered = filterTechniques([candidate])
  if (filtered.length === 0) {
    return { action: "rejected", reason: "模糊指令或无证据" }
  }
  const entry = normalizeTechnique(filtered[0])

  if (mergeTargetId) {
    const ok = await mergeTechniqueEvidence(mergeTargetId, entry.evidence, directory)
    if (!ok) return { action: "rejected", reason: "合并目标不存在" }
    return { action: "merged", technique_id: mergeTargetId }
  }

  const sameName = await findTechniquesByName(entry.name, directory)
  if (sameName.length > 0) {
    const target = sameName[0]
    await mergeTechniqueEvidence(target.id, entry.evidence, directory)
    return { action: "merged", technique_id: target.id }
  }

  await upsertTechnique(entry, directory)
  return { action: "created", technique_id: entry.id }
}

export interface SearchTechniquesFilter {
  keyword?: string
  sceneType?: string
  level?: TechniqueLevel
  status?: TechniqueStatus
  limit?: number
}

/** search_techniques 工具的核心逻辑 */
export async function searchTechniques(
  filter: SearchTechniquesFilter,
  directory: string | null,
): Promise<{ lines: string[]; count: number }> {
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
  return { lines, count: matched.length }
}

/** confirm_techniques 工具的核心逻辑：计数 + 预算裁剪 + 段落格式化 */
export async function confirmTechniques(
  ids: string[],
  directory: string | null,
): Promise<{ section: string; injected: number; injected_ids: string[] }> {
  const all = await listTechniques(directory)
  const picked = all
    .filter((entry) => ids.includes(entry.id))
    .map((entry) => ({ entry, matchScore: entry.confidence }))
  if (picked.length === 0) return { section: "", injected: 0, injected_ids: [] }

  const budgeted = applyP7Budget(picked)
  for (const t of budgeted) {
    await incrementTechniqueUsage(t.entry.id, directory)
  }
  return {
    section: formatTechniquesForPrompt(budgeted),
    injected: budgeted.length,
    injected_ids: budgeted.map((t) => t.entry.id),
  }
}
