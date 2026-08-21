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
  const lines = techniques.map((t, i) => `${i + 1}. ${t.entry.name}: ${t.entry.instruction}`)
  return `## 写作技法指导\n\n以下是和当前场景匹配的写作技法，写作时酌情参考：\n\n${lines.join("\n")}`
}
