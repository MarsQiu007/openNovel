import { eq, ne, gte, desc, and } from "drizzle-orm"
import { getDb, getGlobalDb, TechniqueTable, TechniqueFeedbackTable, TechniqueShadowLogTable } from "./session-store.js"
import type {
  TechniqueEntry,
  TechniqueEvidence,
  TechniqueQuery,
  RetrievedTechnique,
  TechniqueFeedback,
  ShadowLogEntry,
  TechniqueLibrary,
  TechniqueLevel,
} from "./technique.js"
import { canonicalSceneIntersection } from "./technique.js"

export async function upsertTechnique(
  entry: TechniqueEntry,
  directory?: string | null,
  library: TechniqueLibrary = "book",
): Promise<void> {
  const db = libDb(library, directory)
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
      scope: entry.scope,
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
        scope: entry.scope,
        embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
        updated_at: Date.now(),
      },
    })
}

/** 按来源库选择连接:global=全局通用技法库;book=本书库 */
function libDb(library: TechniqueLibrary, directory?: string | null) {
  return library === "global" ? getGlobalDb() : getDb(directory)
}

/** 未验证新品曝光位:置信度前列之外额外纳入的最近入库 unverified 条数 */
const UNVERIFIED_SPOTS = 2

export async function queryTechniques(
  query: TechniqueQuery,
  directory?: string | null,
): Promise<RetrievedTechnique[]> {
  const limit = query.limit ?? 10
  const matchesQuery = (entry: TechniqueEntry) => {
    const canonical = canonicalSceneIntersection(entry.sceneTypes)
    // 空交集（历史自由文本标签）视为跨场景通用：按"通用身份"参与任意场景候选，不因标签词表问题被静默过滤
    const sceneMatch = canonical.length === 0 || canonical.includes(query.sceneType)
    return sceneMatch && (query.level === undefined || entry.level === query.level)
  }

  // 双源检索：本书库 + 全局通用库各查一轮，同一场景匹配与排序规则
  const libraries: TechniqueLibrary[] = ["book", "global"]
  const confidenceHits: RetrievedTechnique[] = []
  const freshHits: RetrievedTechnique[] = []
  for (const library of libraries) {
    const db = libDb(library, directory)
    const conditions = []
    if (query.minConfidence !== undefined) {
      conditions.push(gte(TechniqueTable.confidence, query.minConfidence))
    }
    // 内容性质双闸门：未显式放行时本书池排除 adult 条目（全局池不受闸门影响）
    if (library === "book" && query.allowAdult !== true) {
      conditions.push(ne(TechniqueTable.scope, "adult"))
    }
    const rows = await db
      .select()
      .from(TechniqueTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(TechniqueTable.confidence))
      .limit(limit)
      .all()
    confidenceHits.push(
      ...rows.map(rowToEntry).filter(matchesQuery).map((entry) => ({ entry, matchScore: entry.confidence, library })),
    )

    // 曝光位:按入库时间取最近 unverified 新品,让 shadow 反馈闭环覆盖到它们;尊重 minConfidence 门槛
    const freshConditions = [eq(TechniqueTable.status, "unverified")]
    if (query.minConfidence !== undefined) {
      freshConditions.push(gte(TechniqueTable.confidence, query.minConfidence))
    }
    if (library === "book" && query.allowAdult !== true) {
      freshConditions.push(ne(TechniqueTable.scope, "adult"))
    }
    const freshRows = await db
      .select()
      .from(TechniqueTable)
      .where(and(...freshConditions))
      .orderBy(desc(TechniqueTable.created_at))
      .limit(UNVERIFIED_SPOTS)
      .all()
    freshHits.push(
      ...freshRows.map(rowToEntry).filter(matchesQuery).map((entry) => ({ entry, matchScore: entry.confidence, library })),
    )
  }

  // 曝光位先行：跨两池按入库时间取最近 unverified 新品（落实规格"跨两池取最近"），id 兜底保证并列时全序确定
  const fresh = freshHits
    .sort((a, b) => b.entry.createdAt - a.entry.createdAt || a.entry.id.localeCompare(b.entry.id))
    .slice(0, UNVERIFIED_SPOTS)
  const freshKeys = new Set(fresh.map((hit) => `${hit.library}:${hit.entry.id}`))
  // 置信度排序剔除曝光位命中，避免新品重复占位；置信度并列按入库时间跨池打破平局，防止本书池饱和时全局库被结构性挤出
  const byConfidence = confidenceHits
    .filter((hit) => !freshKeys.has(`${hit.library}:${hit.entry.id}`))
    .sort(
      (a, b) =>
        b.entry.confidence - a.entry.confidence ||
        b.entry.createdAt - a.entry.createdAt ||
        a.entry.id.localeCompare(b.entry.id),
    )
  // 新品占尾部固定位：先让出 fresh 槽位，保证曝光位不被置信度前列挤掉
  const head = byConfidence.slice(0, Math.max(0, limit - fresh.length))
  return [...head, ...fresh]
}

export async function listTechniques(directory?: string | null): Promise<TechniqueEntry[]> {
  const db = getDb(directory)
  const rows = await db.select().from(TechniqueTable).all()
  return rows.map(rowToEntry)
}

/** 双源列举：本书库 + 全局库全部技法，逐条标注来源库（search/confirm 跨库场景使用）。 */
export async function listAllTechniques(
  directory?: string | null,
): Promise<Array<{ entry: TechniqueEntry; library: TechniqueLibrary }>> {
  const book = await listTechniques(directory)
  const globalDb = libDb("global", directory)
  const globalRows = await globalDb.select().from(TechniqueTable).all()
  return [
    ...book.map((entry) => ({ entry, library: "book" as const })),
    ...globalRows.map(rowToEntry).map((entry) => ({ entry, library: "global" as const })),
  ]
}

/** 规范化名称匹配:trim + 空白折叠 + 大小写归一 */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

export async function findTechniquesByName(
  name: string,
  directory?: string | null,
  library: TechniqueLibrary = "book",
): Promise<TechniqueEntry[]> {
  // 同名合并只在本库内进行——避免把成人技法证据并进全局通用技法
  const db = libDb(library, directory)
  const target = normalizeName(name)
  const rows = await db.select().from(TechniqueTable).all()
  return rows.map(rowToEntry).filter((entry) => normalizeName(entry.name) === target)
}

/** 按 excerpt 去重追加证据,不改 status/confidence/usage_count(合并不动状态机) */
export async function mergeTechniqueEvidence(
  id: string,
  evidence: TechniqueEvidence[],
  directory?: string | null,
  library: TechniqueLibrary = "book",
): Promise<boolean> {
  // 证据合并只在技法所在库内进行（跨库同名不合并）
  const db = libDb(library, directory)
  const [row] = await db.select().from(TechniqueTable).where(eq(TechniqueTable.id, id)).all()
  if (!row) return false
  const existing: TechniqueEvidence[] = JSON.parse(row.evidence)
  const known = new Set(existing.map((e) => e.excerpt))
  const merged = [...existing, ...evidence.filter((e) => !known.has(e.excerpt))]
  await db
    .update(TechniqueTable)
    .set({ evidence: JSON.stringify(merged), updated_at: Date.now() })
    .where(eq(TechniqueTable.id, id))
  return true
}

/** 重分类用：仅更新 level 并触碰 updated_at，状态/置信度/证据不动 */
export async function updateTechniqueLevel(
  id: string,
  level: TechniqueLevel,
  directory?: string | null,
  library: TechniqueLibrary = "book",
): Promise<void> {
  const db = libDb(library, directory)
  await db.update(TechniqueTable).set({ level, updated_at: Date.now() }).where(eq(TechniqueTable.id, id))
}

export async function updateTechniqueStatus(
  id: string,
  status: string,
  directory?: string | null,
  library: TechniqueLibrary = "book",
): Promise<void> {
  const db = libDb(library, directory)
  await db.update(TechniqueTable).set({ status, updated_at: Date.now() }).where(eq(TechniqueTable.id, id))
}

/** 注入发生时递增使用次数并记录最近使用时间（异步尽力而为，失败由调用方吞掉） */
export async function incrementTechniqueUsage(
  id: string,
  directory?: string | null,
  library: TechniqueLibrary = "book",
): Promise<void> {
  const db = libDb(library, directory)
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
  library: TechniqueLibrary = "book",
): Promise<void> {
  // 反馈行写入技法所在库：全局技法反馈跨书积累，本书技法反馈留本书库
  const db = libDb(library, directory)
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
  library: TechniqueLibrary = "book",
): Promise<void> {
  const db = libDb(library, directory)
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
    scope: (row.scope ?? "general") as TechniqueEntry["scope"],
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
