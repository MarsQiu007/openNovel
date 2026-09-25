/**
 * 书籍级派生数据升级（derived-data-upgrade）。
 *
 * 升级任务注册表：每个引入数据回填需求的版本自行声明回填任务，
 * 客户端按小说检测未执行任务；触发后 Phase 1 确定性回填（零 token），
 * Phase 2 AI 重建经同步队列批量调度（opennovel worker 消费）。
 *
 * 诚实性约束：派生数据只有真正重建后才标记已同步；
 * 本模块不得把未重建的旧数据直接标记为最新。
 */

import { and, eq, isNull, sql } from "drizzle-orm"
import {
  getDb,
  ChapterTable,
  ChapterSummaryTable,
  EntityRefTable,
  NovelTable,
  SegmentSummaryTable,
  StorySpineEntryTable,
  UpgradeStateTable,
  type Db,
} from "./index.js"
import { computeFingerprint } from "./manual-edit-sync.js"
import { ensureSegmentSummaries } from "./segment-rollup.js"
import { scanEntityReferences } from "./entity-refs.js"

/** 升级任务种类：确定性回填（零 token）或 AI 重建。 */
export type UpgradeTaskKind = "deterministic" | "ai"

/** 升级任务回填目标。 */
export type UpgradeTaskTarget =
  | "fingerprints"
  | "segment_summaries"
  | "entity_refs"
  | "spine_entries"
  | "chapter_summaries"

/** 注册表任务定义：appliesTo 返回 true 表示该小说需要执行（幂等判定）。 */
export interface UpgradeTaskDef {
  id: string
  version: string
  kind: UpgradeTaskKind
  target: UpgradeTaskTarget
  appliesTo: (db: Db, novelId: string) => Promise<boolean>
}

/** 未执行升级任务（客户端展示与成本预估）。 */
export interface PendingUpgradeTask {
  id: string
  version: string
  kind: UpgradeTaskKind
  target: UpgradeTaskTarget
}

/** 升级成本预估。 */
export interface UpgradeCostEstimate {
  /** 待执行的确定性任务数（免费）。 */
  deterministicTasks: number
  /** AI 重建覆盖的章节数（每次调用重建一章的摘要/引用/段摘要/主轴条目）。 */
  aiChapters: number
}

/** 当前回填需求全部由 derived-data-upgrade 能力引入。 */
const TASK_VERSION = "derived-data-upgrade"

function chapterCount(db: Db, novelId: string): number {
  return db
    .select({ id: ChapterTable.id })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .all().length
}

/**
 * 升级任务注册表。
 *
 * 新增回填需求时在此登记任务；纯 schema 迁移不注册任务。
 * 顺序即执行顺序：确定性任务先于 AI 任务展示。
 */
export const UPGRADE_TASKS: UpgradeTaskDef[] = [
  {
    id: "content-fingerprints",
    version: TASK_VERSION,
    kind: "deterministic",
    target: "fingerprints",
    appliesTo: async (db, novelId) =>
      db
        .select({ id: ChapterTable.id })
        .from(ChapterTable)
        .where(and(eq(ChapterTable.novel_id, novelId), isNull(ChapterTable.content_fingerprint)))
        .all().length > 0,
  },
  {
    id: "segment-summaries",
    version: TASK_VERSION,
    kind: "deterministic",
    target: "segment_summaries",
    appliesTo: async (db, novelId) =>
      db
        .select({ id: SegmentSummaryTable.id })
        .from(SegmentSummaryTable)
        .where(and(eq(SegmentSummaryTable.novel_id, novelId), isNull(SegmentSummaryTable.source_fingerprint)))
        .all().length > 0,
  },
  {
    id: "entity-refs",
    version: TASK_VERSION,
    kind: "deterministic",
    target: "entity_refs",
    appliesTo: async (db, novelId) => {
      const stale = await db
        .select({ id: EntityRefTable.id })
        .from(EntityRefTable)
        .where(and(eq(EntityRefTable.novel_id, novelId), isNull(EntityRefTable.source_fingerprint)))
        .all()
      if (stale.length > 0) return true
      // 有章节但从未扫描过引用（零行）的旧书同样需要扫描
      const refCount = db
        .select({ id: EntityRefTable.id })
        .from(EntityRefTable)
        .where(eq(EntityRefTable.novel_id, novelId))
        .all().length
      return refCount === 0 && chapterCount(db, novelId) > 0
    },
  },
  {
    id: "legacy-spine-entries",
    version: TASK_VERSION,
    kind: "deterministic",
    target: "spine_entries",
    // 结构化条目为空且旧文本主轴非空：回退路径激活中，需要转换
    appliesTo: async (db, novelId) => {
      const entryCount = db
        .select({ id: StorySpineEntryTable.id })
        .from(StorySpineEntryTable)
        .where(eq(StorySpineEntryTable.novel_id, novelId))
        .all().length
      if (entryCount > 0) return false
      const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()
      return !!novel?.story_spine && novel.story_spine.trim().length > 0
    },
  },
  {
    id: "chapter-summaries",
    version: TASK_VERSION,
    kind: "ai",
    target: "chapter_summaries",
    appliesTo: async (db, novelId) =>
      db
        .select({ id: ChapterSummaryTable.id })
        .from(ChapterSummaryTable)
        .where(isNull(ChapterSummaryTable.source_fingerprint))
        .all().length > 0,
  },
  {
    id: "spine-entries-ai",
    version: TASK_VERSION,
    kind: "ai",
    target: "spine_entries",
    appliesTo: async (db, novelId) =>
      db
        .select({ id: StorySpineEntryTable.id })
        .from(StorySpineEntryTable)
        .where(and(eq(StorySpineEntryTable.novel_id, novelId), eq(StorySpineEntryTable.status, "legacy")))
        .all().length > 0,
  },
]

/** 查询某本小说未执行的升级任务（按注册表顺序）。 */
export async function listPendingUpgradeTasks(db: Db, novelId: string): Promise<PendingUpgradeTask[]> {
  const pending: PendingUpgradeTask[] = []
  for (const task of UPGRADE_TASKS) {
    if (await task.appliesTo(db, novelId)) {
      pending.push({ id: task.id, version: task.version, kind: task.kind, target: task.target })
    }
  }
  return pending
}

/** 组装升级成本预估：确定性项免费，AI 项按缺指纹章节数估算 observer 调用次数。 */
export async function estimateUpgradeCost(db: Db, novelId: string): Promise<UpgradeCostEstimate> {
  const pending = await listPendingUpgradeTasks(db, novelId)
  const deterministicTasks = pending.filter((t) => t.kind === "deterministic").length
  const staleSummaryCount = db
    .select({ id: ChapterSummaryTable.id })
    .from(ChapterSummaryTable)
    .where(isNull(ChapterSummaryTable.source_fingerprint))
    .all().length
  return { deterministicTasks, aiChapters: staleSummaryCount }
}

/**
 * Phase 1 确定性回填（零 token，同步执行）。
 *
 * 四步全部幂等：指纹基准 → 段摘要重建 → 实体引用扫描 → legacy 主轴转换。
 * 返回各步处理数量。
 */
export async function runDeterministicUpgrade(
  db: Db,
  novelId: string,
): Promise<{ fingerprints: number; segments: number; refs: number; spineEntries: number }> {
  // 1. 正文指纹基准：为缺指纹的章节计算 SHA-256（16 位）并落库
  const chapters = await db
    .select()
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .all()
  let fingerprints = 0
  for (const chapter of chapters) {
    if (chapter.content_fingerprint) continue
    await db
      .update(ChapterTable)
      .set({ content_fingerprint: computeFingerprint(chapter.content) })
      .where(eq(ChapterTable.id, chapter.id))
      .run()
    fingerprints++
  }

  // 2. 段摘要确定性重建（含占位刷新），rollup 内部按指纹幂等
  const maxOrder = chapters.length > 0 ? Math.max(...chapters.map((c) => c.order)) : 0
  const segments = await ensureSegmentSummaries(db, novelId, maxOrder)

  // 3. 实体引用确定性扫描：缺指纹引用清理后按当前正文重扫
  let refs = 0
  for (const chapter of chapters) {
    refs += await scanEntityReferences(db, novelId, "chapter", chapter.id, "content", chapter.content)
  }

  // 4. legacy 主轴文本 → story_spine_entries（status=legacy，缺指纹等待 AI 覆盖）
  let spineEntries = 0
  const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()
  const entryCount = db
    .select({ id: StorySpineEntryTable.id })
    .from(StorySpineEntryTable)
    .where(eq(StorySpineEntryTable.novel_id, novelId))
    .all().length
  if (entryCount === 0 && novel?.story_spine && novel.story_spine.trim().length > 0) {
    // 旧文本按空行分段，逐段生成 legacy 条目；chapter 对应关系不可考，留空
    const paragraphs = novel.story_spine
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    for (const content of paragraphs) {
      await db
        .insert(StorySpineEntryTable)
        .values({
          id: crypto.randomUUID(),
          novel_id: novelId,
          content,
          kind: "legacy",
          status: "legacy",
          chapter_order: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run()
      spineEntries++
    }
  }

  return { fingerprints, segments, refs, spineEntries }
}

/** 升级消费闸门状态。 */
export type UpgradeGate = "open" | "paused"

/** 读取升级消费闸门（默认 open；无记录即 open）。 */
export async function getUpgradeGate(db: Db, novelId: string): Promise<UpgradeGate> {
  const row = db.select().from(UpgradeStateTable).where(eq(UpgradeStateTable.novel_id, novelId)).get()
  return row?.gate === "paused" ? "paused" : "open"
}

/** 切换升级消费闸门（持久化，进程重启后保持）。 */
export async function setUpgradeGate(db: Db, novelId: string, gate: UpgradeGate): Promise<void> {
  const now = Date.now()
  const existing = db.select().from(UpgradeStateTable).where(eq(UpgradeStateTable.novel_id, novelId)).get()
  if (existing) {
    await db.update(UpgradeStateTable).set({ gate, updated_at: now }).where(eq(UpgradeStateTable.novel_id, novelId)).run()
    return
  }
  await db.insert(UpgradeStateTable).values({ novel_id: novelId, gate, updated_at: now }).run()
}
