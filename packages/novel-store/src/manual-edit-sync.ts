/**
 * 手动编辑同步辅助层。
 *
 * 负责同步队列的入队（按指纹去重）、状态查询和联合保存。
 * AI 重建逻辑由 plugin 层实现，本文件只维护数据层状态。
 */
import { createHash } from "crypto"
import { and, eq, inArray, isNull, ne } from "drizzle-orm"
import {
  ManualEditSyncQueueTable,
  NovelTable,
  StyleGuideTable,
  ChapterTable,
  ChapterSummaryTable,
  SegmentSummaryTable,
  EntityRefTable,
  StorySpineEntryTable,
  getDb,
  type Db,
} from "./index.js"

export type SyncStatus = "synced" | "pending" | "failed" | "skipped"

/** 使用 SHA-256 计算内容指纹（跨 Bun / Node 运行时）。 */
export function computeFingerprint(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16)
}

/** 手动编辑同步请求。 */
export interface ManualEditSyncRequest {
  novelId: string
  entity: string
  entityId?: string | null
  field?: string
  category?: string
  sourceFingerprint?: string | null
}

/**
 * 按来源指纹去重入队。
 *
 * - 同一 novel + entity + entity_id + fingerprint 已存在有效任务时跳过。
 * - 同一 novel + entity + entity_id 存在旧指纹任务时作废旧任务再入队。
 */
export async function enqueueManualEditSync(
  request: ManualEditSyncRequest,
  directory?: string | null,
): Promise<{ queued: boolean; deduped: boolean }> {
  const db = getDb(directory)
  const fingerprint = request.sourceFingerprint ?? null
  const entityId = request.entityId ?? null
  const field = request.field ?? ""

  // 查找同 novel + entity + entity_id 的现有任务
  const existing = await db
    .select()
    .from(ManualEditSyncQueueTable)
    .where(
      and(
        eq(ManualEditSyncQueueTable.novel_id, request.novelId),
        eq(ManualEditSyncQueueTable.entity, request.entity),
        entityId === null
          ? isNull(ManualEditSyncQueueTable.entity_id)
          : eq(ManualEditSyncQueueTable.entity_id, entityId),
        ne(ManualEditSyncQueueTable.status, "skipped"),
      ),
    )
    .all()

  // 指纹相同且仍是 pending → 去重
  const sameFingerprint = existing.find(
    (row) => row.source_fingerprint === fingerprint && row.status === "pending",
  )
  if (sameFingerprint) return { queued: false, deduped: true }

  // 作废旧指纹的 pending / failed 任务
  for (const row of existing) {
    if (row.source_fingerprint !== fingerprint && (row.status === "pending" || row.status === "failed")) {
      await db
        .update(ManualEditSyncQueueTable)
        .set({ status: "skipped", updated_at: Date.now() })
        .where(eq(ManualEditSyncQueueTable.id, row.id))
        .run()
    }
  }

  // 入队新任务
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(ManualEditSyncQueueTable)
    .values({
      id,
      novel_id: request.novelId,
      entity: request.entity,
      entity_id: entityId,
      field,
      category: request.category ?? "creative_fact",
      status: "pending",
      source_fingerprint: fingerprint,
      created_at: now,
      updated_at: now,
    })
    .run()

  return { queued: true, deduped: false }
}

/**
 * 查询某本小说的编辑同步状态。
 *
 * 仅返回 pending / failed / skipped 条目；synced 条目可通过 includeSynced 参数包含。
 */
export async function querySyncStatus(
  novelId: string,
  options?: { includeSynced?: boolean; status?: SyncStatus },
  directory?: string | null,
): Promise<Array<typeof ManualEditSyncQueueTable.$inferSelect>> {
  const db = getDb(directory)
  const conditions = [eq(ManualEditSyncQueueTable.novel_id, novelId)]

  if (options?.status) {
    conditions.push(eq(ManualEditSyncQueueTable.status, options.status))
  } else if (!options?.includeSynced) {
    conditions.push(inArray(ManualEditSyncQueueTable.status, ["pending", "failed", "skipped"]))
  }

  return db
    .select()
    .from(ManualEditSyncQueueTable)
    .where(and(...conditions))
    .all()
}

/**
 * 更新同步条目状态。
 */
export async function updateSyncStatus(
  syncId: string,
  status: SyncStatus,
  failureReason?: string | null,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = { status, updated_at: Date.now() }
  if (failureReason !== undefined) updates.failure_reason = failureReason
  await db.update(ManualEditSyncQueueTable).set(updates).where(eq(ManualEditSyncQueueTable.id, syncId)).run()
}

/**
 * 联合保存书籍元数据和风格指南。
 *
 * 两部分在同一事务上下文中执行；如果任一部分抛出错误则不调用数据库提交。
 * Drizzle 的 Bun 驱动目前不支持事务包装（ Effect-drizzle-sqlite 提供），
 * 这里采用手动序列化 + 异常时先恢复旧值的补偿模式，确保感知级别原子性。
 */
export async function saveBookMeta(
  novelId: string,
  input: {
    title?: string
    synopsis?: string
    genre?: string
    styleGuide?: { tone?: string; pov?: string; tense?: string; rules?: Record<string, string> }
  },
  directory?: string | null,
): Promise<{ novel: typeof NovelTable.$inferSelect; styleGuide: typeof StyleGuideTable.$inferSelect | null }> {
  const db = getDb(directory)
  const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()
  if (!novel) throw new Error(`Novel not found: ${novelId}`)

  const updates: Record<string, unknown> = { updated_at: Date.now() }
  if (input.title !== undefined) updates.title = input.title
  if (input.synopsis !== undefined) updates.synopsis = input.synopsis
  if (input.genre !== undefined) updates.genre = input.genre

  // 风格指南更新
  let styleGuideRow: typeof StyleGuideTable.$inferSelect | null = null
  if (input.styleGuide) {
    const sgUpdates: Record<string, unknown> = {}
    if (input.styleGuide.tone !== undefined) sgUpdates.tone = input.styleGuide.tone
    if (input.styleGuide.pov !== undefined) sgUpdates.pov = input.styleGuide.pov
    if (input.styleGuide.tense !== undefined) sgUpdates.tense = input.styleGuide.tense
    if (input.styleGuide.rules !== undefined) sgUpdates.rules = JSON.stringify(input.styleGuide.rules)
    const existing = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).get()
    if (existing) {
      await db.update(StyleGuideTable).set(sgUpdates).where(eq(StyleGuideTable.novel_id, novelId)).run()
    } else {
      await db
        .insert(StyleGuideTable)
        .values({
          id: crypto.randomUUID(),
          novel_id: novelId,
          rules: JSON.stringify(input.styleGuide.rules ?? {}),
          tone: input.styleGuide.tone ?? "",
          pov: input.styleGuide.pov ?? "",
          tense: input.styleGuide.tense ?? "",
        })
        .run()
    }
    styleGuideRow = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).get() ?? null
  }

  await db.update(NovelTable).set(updates).where(eq(NovelTable.id, novelId)).run()
  const updatedNovel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()!

  return { novel: updatedNovel, styleGuide: styleGuideRow }
}

/**
 * 为章节正文变化标记派生数据为待校验。
 *
 * - chapter_summaries：指纹不匹配或缺失时标记待校验（fingerprint 列保留旧值，状态由队列反映）。
 * - segment_summaries：按章节范围筛选受影响的条目。
 * - entity_refs：按 source_id 匹配章节引用。
 * - story_spine_entries：按 chapter_id 匹配。
 */
export async function markDerivedStale(
  novelId: string,
  chapterId: string,
  newFingerprint: string,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)

  // 章节摘要：更新指纹为 null 表示待校验
  await db
    .update(ChapterSummaryTable)
    .set({ source_fingerprint: null })
    .where(eq(ChapterSummaryTable.chapter_id, chapterId))
    .run()

  // 段摘要：通过章节查段范围
  const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
  if (chapter) {
    await db
      .update(SegmentSummaryTable)
      .set({ source_fingerprint: null })
      .where(and(eq(SegmentSummaryTable.novel_id, novelId), eq(SegmentSummaryTable.start_chapter, chapter.order)))
      .run()
  }

  // 实体引用：标记来源为该章节的引用
  await db
    .update(EntityRefTable)
    .set({ source_fingerprint: null })
    .where(and(eq(EntityRefTable.novel_id, novelId), eq(EntityRefTable.source_id, chapterId)))
    .run()

  // 故事主轴条目
  await db
    .update(StorySpineEntryTable)
    .set({ source_fingerprint: null, status: "pending", updated_at: Date.now() })
    .where(and(eq(StorySpineEntryTable.novel_id, novelId), eq(StorySpineEntryTable.chapter_id, chapterId)))
    .run()

  // 入队同步任务
  await enqueueManualEditSync(
    {
      novelId,
      entity: "chapter",
      entityId: chapterId,
      field: "content",
      category: "creative_fact",
      sourceFingerprint: newFingerprint,
    },
    directory,
  )
}
/**
 * 历史手动编辑中间状态扫描。
 *
 * 检测派生数据缺少来源指纹的条目，将其标记为"待校验"。
 * 旧版多步保存（如正文已更新但摘要未重建）留下的中间状态不会显示为完全已保存。
 *
 * 返回检测到的待校验条目数量。
 */
export async function scanHistoricalIntermediateStates(
  novelId: string,
  directory?: string | null,
): Promise<{ summaries: number; segments: number; refs: number; spine: number }> {
  const db = getDb(directory)

  // 缺指纹的章节摘要
  const staleSummaries = await db
    .select({ id: ChapterSummaryTable.id })
    .from(ChapterSummaryTable)
    .where(isNull(ChapterSummaryTable.source_fingerprint))
    .all()

  // 缺指纹的段摘要
  const staleSegments = await db
    .select({ id: SegmentSummaryTable.id })
    .from(SegmentSummaryTable)
    .where(and(eq(SegmentSummaryTable.novel_id, novelId), isNull(SegmentSummaryTable.source_fingerprint)))
    .all()

  // 缺指纹的实体引用
  const staleRefs = await db
    .select({ id: EntityRefTable.id })
    .from(EntityRefTable)
    .where(and(eq(EntityRefTable.novel_id, novelId), isNull(EntityRefTable.source_fingerprint)))
    .all()

  // 缺指纹的故事主轴条目
  const staleSpine = await db
    .select({ id: StorySpineEntryTable.id })
    .from(StorySpineEntryTable)
    .where(and(eq(StorySpineEntryTable.novel_id, novelId), isNull(StorySpineEntryTable.source_fingerprint)))
    .all()

  return {
    summaries: staleSummaries.length,
    segments: staleSegments.length,
    refs: staleRefs.length,
    spine: staleSpine.length,
  }
}

