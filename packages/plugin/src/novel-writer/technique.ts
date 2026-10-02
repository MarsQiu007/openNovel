/** 规范场景词表（唯一事实源）：technique-extract.ts 的 LLM prompt 与 context.ts inferSceneType 输出均已锚定这 7 值 */
export const CANONICAL_SCENE_TYPES: readonly string[] = [
  "action",
  "dialogue",
  "description",
  "suspense",
  "emotion_shift",
  "transition",
  "general",
]

/** 场景标签与规范词表求交（不回退）——检索侧用空交集判定"无规范标签的历史数据" */
export function canonicalSceneIntersection(sceneTypes: string[] | undefined): string[] {
  return (sceneTypes ?? []).filter((scene) => CANONICAL_SCENE_TYPES.includes(scene))
}

/** 入库收敛：求交保留规范值，空交集或缺省回退 ["general"]（normalizeTechnique 用） */
export function toCanonicalSceneTypes(sceneTypes: string[] | undefined): string[] {
  const canonical = canonicalSceneIntersection(sceneTypes)
  return canonical.length > 0 ? canonical : ["general"]
}

export type TechniqueLevel = "paragraph" | "sentence" | "dialogue" | "description" | "transition"
export type TechniqueStatus = "unverified" | "verified" | "shadow" | "archived"

export interface TechniqueEvidence {
  sourceTitle: string
  sourceLocation: string
  excerpt: string
  annotation: string
}

export interface TechniqueEntry {
  id: string
  name: string
  principle: string
  instruction: string
  sceneTypes: string[]
  level: TechniqueLevel
  evidence: TechniqueEvidence[]
  commonMisuse: string
  confidence: number
  status: TechniqueStatus
  embedding: number[] | null
  usageCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface TechniqueQuery {
  sceneType: string
  level?: TechniqueLevel
  contextText: string
  limit?: number
  minConfidence?: number
}

export interface TechniqueFeedback {
  techniqueId: string
  chapterId: string
  score: number
  wasUsed: boolean
  comment: string
  createdAt: number
}

export interface RetrievedTechnique {
  entry: TechniqueEntry
  matchScore: number
}

export interface ShadowLogEntry {
  id: string
  novelId: string
  chapterNumber: number
  sceneType: string
  queryText: string
  retrievedTechniqueIds: string[]
  retrievedTechniqueNames: string[]
  createdAt: number
}
