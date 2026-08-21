import type { TechniqueEntry, TechniqueStatus } from "./technique.js"

export interface NormalizeOptions {
  seed?: boolean
}

export function normalizeTechnique(
  partial: Partial<TechniqueEntry>,
  options?: NormalizeOptions,
): TechniqueEntry {
  const now = Date.now()
  return {
    id: partial.id ?? `tech_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: partial.name ?? "未命名技法",
    principle: partial.principle ?? "",
    instruction: partial.instruction ?? "",
    sceneTypes: partial.sceneTypes ?? ["general"],
    level: partial.level ?? "paragraph",
    evidence: partial.evidence ?? [],
    commonMisuse: partial.commonMisuse ?? "",
    confidence: partial.confidence ?? (options?.seed ? 0.8 : 0.5),
    status: (partial.status ?? (options?.seed ? "verified" : "unverified")) as TechniqueStatus,
    embedding: partial.embedding ?? null,
    usageCount: partial.usageCount ?? 0,
    lastUsedAt: partial.lastUsedAt ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  }
}
