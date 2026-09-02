import { eq, gte, desc, and } from "drizzle-orm"
import { getDb, TechniqueTable, TechniqueFeedbackTable, TechniqueShadowLogTable } from "./session-store.js"
import type {
  TechniqueEntry,
  TechniqueQuery,
  RetrievedTechnique,
  TechniqueFeedback,
  ShadowLogEntry,
} from "./technique.js"

export async function upsertTechnique(entry: TechniqueEntry, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db
    .insert(TechniqueTable)
    .values({
      id: entry.id,
      name: entry.name,
      principle: entry.principle,
      instruction: entry.instruction,
      scene_types: JSON.stringify(entry.sceneTypes),
      level: entry.level,
      evidence: JSON.stringify(entry.evidence),
      common_misuse: entry.commonMisuse,
      confidence: entry.confidence,
      status: entry.status,
      embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
      usage_count: entry.usageCount,
      last_used_at: entry.lastUsedAt,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    })
    .onConflictDoUpdate({
      target: TechniqueTable.id,
      set: {
        name: entry.name,
        principle: entry.principle,
        instruction: entry.instruction,
        scene_types: JSON.stringify(entry.sceneTypes),
        level: entry.level,
        evidence: JSON.stringify(entry.evidence),
        common_misuse: entry.commonMisuse,
        confidence: entry.confidence,
        status: entry.status,
        embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
        updated_at: Date.now(),
      },
    })
}

export async function queryTechniques(
  query: TechniqueQuery,
  directory?: string | null,
): Promise<RetrievedTechnique[]> {
  const db = getDb(directory)
  const conditions = []
  if (query.minConfidence !== undefined) {
    conditions.push(gte(TechniqueTable.confidence, query.minConfidence))
  }

  const rows = await db
    .select()
    .from(TechniqueTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(TechniqueTable.confidence))
    .limit(query.limit ?? 10)
    .all()

  return rows
    .map(rowToEntry)
    .filter((entry) => entry.sceneTypes.includes(query.sceneType))
    .filter((entry) => query.level === undefined || entry.level === query.level)
    .map((entry) => ({ entry, matchScore: entry.confidence }))
}

export async function updateTechniqueStatus(
  id: string,
  status: string,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  await db.update(TechniqueTable).set({ status, updated_at: Date.now() }).where(eq(TechniqueTable.id, id))
}

/** 注入发生时递增使用次数并记录最近使用时间（异步尽力而为，失败由调用方吞掉） */
export async function incrementTechniqueUsage(
  id: string,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  const [row] = await db
    .select({ usage_count: TechniqueTable.usage_count })
    .from(TechniqueTable)
    .where(eq(TechniqueTable.id, id))
    .all()
  if (!row) return
  await db
    .update(TechniqueTable)
    .set({ usage_count: row.usage_count + 1, last_used_at: Date.now() })
    .where(eq(TechniqueTable.id, id))
}

export async function recordFeedback(
  feedback: TechniqueFeedback,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  await db.insert(TechniqueFeedbackTable).values({
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    technique_id: feedback.techniqueId,
    chapter_id: feedback.chapterId,
    score: feedback.score,
    was_used: feedback.wasUsed ? 1 : 0,
    comment: feedback.comment,
    created_at: feedback.createdAt,
  })
}

export async function recordShadowLog(log: ShadowLogEntry, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.insert(TechniqueShadowLogTable).values({
    id: log.id,
    novel_id: log.novelId,
    chapter_number: log.chapterNumber,
    scene_type: log.sceneType,
    query_text: log.queryText,
    retrieved_technique_ids: JSON.stringify(log.retrievedTechniqueIds),
    retrieved_technique_names: JSON.stringify(log.retrievedTechniqueNames),
    created_at: log.createdAt,
  })
}

export async function updateConfidenceFromFeedback(
  techniqueId: string,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  const [technique] = await db
    .select()
    .from(TechniqueTable)
    .where(eq(TechniqueTable.id, techniqueId))
    .all()
  if (!technique) return

  const feedbacks = await db
    .select()
    .from(TechniqueFeedbackTable)
    .where(eq(TechniqueFeedbackTable.technique_id, techniqueId))
    .all()
  if (feedbacks.length === 0) return

  const avgScore = feedbacks.reduce((sum, f) => sum + f.score, 0) / feedbacks.length
  // 贝叶斯加权：先验权重随反馈量递减，反馈越多越主导
  const priorWeight = Math.max(1, 5 - feedbacks.length)
  const newConfidence = Math.min(
    1,
    Math.max(0, (technique.confidence * priorWeight + avgScore * feedbacks.length) / (priorWeight + feedbacks.length)),
  )
  const newStatus =
    newConfidence >= 0.75 && feedbacks.length >= 5 ? "verified" : technique.status

  await db
    .update(TechniqueTable)
    .set({ confidence: newConfidence, status: newStatus, updated_at: Date.now() })
    .where(eq(TechniqueTable.id, techniqueId))
}

function rowToEntry(row: typeof TechniqueTable.$inferSelect): TechniqueEntry {
  return {
    id: row.id,
    name: row.name,
    principle: row.principle,
    instruction: row.instruction,
    sceneTypes: JSON.parse(row.scene_types),
    level: row.level as TechniqueEntry["level"],
    evidence: JSON.parse(row.evidence),
    commonMisuse: row.common_misuse,
    confidence: row.confidence,
    status: row.status as TechniqueEntry["status"],
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
