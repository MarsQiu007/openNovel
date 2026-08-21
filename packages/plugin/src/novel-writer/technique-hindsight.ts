import type { TechniqueEntry } from "./technique.js"

export interface HindsightDocument {
  text: string
  tags: string[]
  context?: string
}

export function formatHindsightDocument(entry: TechniqueEntry): HindsightDocument {
  const tags = [
    "technique",
    `level:${entry.level}`,
    `status:${entry.status}`,
    ...entry.sceneTypes.map((s) => `scene:${s}`),
  ]
  const text = [
    `技法名称: ${entry.name}`,
    `抽象原则: ${entry.principle}`,
    `操作指令: ${entry.instruction}`,
    `常见误用: ${entry.commonMisuse}`,
    ...entry.evidence.map((e) => `证据 (${e.sourceTitle} ${e.sourceLocation}): ${e.excerpt} -> ${e.annotation}`),
  ].join("\n")
  return { text, tags, context: `来源: ${entry.evidence[0]?.sourceTitle ?? "unknown"}` }
}
