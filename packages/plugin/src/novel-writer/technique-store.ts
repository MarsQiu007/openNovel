import { eq, gte, desc, and } from "drizzle-orm"
import { getDb, TechniqueTable, TechniqueFeedbackTable, TechniqueShadowLogTable } from "./session-store.js"
import type {
  TechniqueEntry,
  TechniqueEvidence,
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

/** 未验证新品曝光位:置信度前列之外额外纳入的最近入库 unverified 条数 */
const UNVERIFIED_SPOTS = 2

export async function queryTechniques(
  query: TechniqueQuery,
  directory?: string | null,
): Promise<RetrievedTechnique[]> {
  const db = getDb(directory)
  const limit = query.limit ?? 10
  const conditions = []
  if (query.minConfidence !== undefined) {
    conditions.push(gte(TechniqueTable.confidence, query.minConfidence))
  }
  const matchesQuery = (entry: TechniqueEntry) =>
    entry.sceneTypes.includes(query.sceneType) && (query.level === undefined || entry.level === query.level)

  const rows = await db
    .select()
    .from(TechniqueTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(TechniqueTable.confidence))
    .limit(limit)
    .all()
  const byConfidence = rows.map(rowToEntry).filter(matchesQuery)

  // 曝光位:按入库时间取最近 unverified 新品,让 shadow 反馈闭环覆盖到它们;尊重 minConfidence 门槛
  const freshConditions = [eq(TechniqueTable.status, "unverified")]
  if (query.minConfidence !== undefined) {
    freshConditions.push(gte(TechniqueTable.confidence, query.minConfidence))
  }
  const freshRows = await db
    .select()
    .from(TechniqueTable)
    .where(and(...freshConditions))
    .orderBy(desc(TechniqueTable.created_at))
    .limit(UNVERIFIED_SPOTS)
    .all()
  const fresh = freshRows.map(rowToEntry).filter(matchesQuery)

  const seen = new Set(byConfidence.map((entry) => entry.id))
  const freshIncluded = fresh.filter((entry) => !seen.has(entry.id))
  // 新品占尾部名额：先让出 fresh 槽位，保证曝光位不被置信度前列挤掉
  const head = byConfidence.slice(0, Math.max(0, limit - freshIncluded.length))
  return [...head, ...freshIncluded].map((entry) => ({ entry, matchScore: entry.confidence }))
}

/** 规范化名称匹配:trim + 空白折叠 + 大小写归一 */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

export async function findTechniquesByName(
  name: string,
  directory?: string | null,
): Promise<TechniqueEntry[]> {
  const db = getDb(directory)
  const target = normalizeName(name)
  const rows = await db.select().from(TechniqueTable).all()
  return rows.map(rowToEntry).filter((entry) => normalizeName(entry.name) === target)
}

/** 按 excerpt 去重追加证据,不改 status/confidence/usage_count(合并不动状态机) */
export async function mergeTechniqueEvidence(
  id: string,
  evidence: TechniqueEvidence[],
  directory?: string | null,
): Promise<boolean> {
  const db = getDb(directory)
  const [row] = await db.select().from(TechniqueTable).where(eq(TechniqueTable.id, id)).all()
  if (!row) return false
  const existing = JSON.parse(row.evidence) as TechniqueEvidence[]
  const known = new Set(existing.map((e) => e.excerpt))
  const merged = [...existing, ...evidence.filter((e) => !known.has(e.excerpt))]
  await db
    .update(TechniqueTable)
    .set({ evidence: JSON.stringify(merged), updated_at: Date.now() })
    .where(eq(TechniqueTable.id, id))
  return true
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
