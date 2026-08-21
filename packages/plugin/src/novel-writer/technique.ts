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
