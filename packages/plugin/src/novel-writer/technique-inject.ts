import type { RetrievedTechnique } from "./technique.js"

const P7_BUDGET_TOKENS = 1000

function techniqueTokens(t: RetrievedTechnique): number {
  return Math.ceil((t.entry.name.length + t.entry.instruction.length) / 1.5)
}

export function applyP7Budget(techniques: RetrievedTechnique[]): RetrievedTechnique[] {
  const sorted = [...techniques].sort((a, b) => b.matchScore - a.matchScore)
  let total = 0
  const result: RetrievedTechnique[] = []

  for (const t of sorted) {
    const tokens = techniqueTokens(t)
    if (total + tokens > P7_BUDGET_TOKENS) break
    total += tokens
    result.push(t)
  }

  return result
}

export function formatTechniquesForPrompt(techniques: RetrievedTechnique[]): string {
  if (techniques.length === 0) return ""
  return `## 写作技法指导\n\n${formatTechniqueGuidanceLines(techniques).join("\n")}`
}

/** 注入门槛：置信度低于该值的技法不进入 writer prompt（仍留在 shadow 候选段供反馈闭环） */
export const INJECTION_MIN_CONFIDENCE = 0.6

/** "写作技法指导"段落的正文行（不含标题），供快照注入段与 formatTechniquesForPrompt 共用 */
export function formatTechniqueGuidanceLines(techniques: RetrievedTechnique[]): string[] {
  if (techniques.length === 0) return []
  const lines = techniques.map((t, i) => `${i + 1}. ${t.entry.name}: ${t.entry.instruction}`)
  return ["以下是和当前场景匹配的写作技法，写作时酌情参考：", "", ...lines]
}

/**
 * shadow mode 候选报告：每行携带 id/name/instruction，
 * 供 pipeline 步骤 2.5 报告与 auditor 调 record_technique_feedback 引用。
 */
export function formatTechniquesForShadow(techniques: RetrievedTechnique[]): string[] {
  return techniques.map((t) => {
    const conf = t.entry.confidence.toFixed(2)
    return `- [${t.entry.id}] ${t.entry.name}（置信度:${conf}）：${t.entry.instruction}`
  })
}
