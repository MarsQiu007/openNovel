/**
 * 手动编辑同步 worker。
 *
 * 在 opennovel 进程中启动，轮询 manual_edit_sync_queue 表中的 pending 条目，
 * 按实体类型调用确定性或 observer 同步流程，并更新同步状态。
 */
import { eq, and } from "drizzle-orm"
import {
  getDb,
  ManualEditSyncQueueTable,
  ChapterSummaryTable,
  StorySpineEntryTable,
  EntityRefTable,
  PendingUpdateTable,
  updateSyncStatus,
  getUpgradeGate,
  withTransaction,
  type Tx,
} from "@opennovel-ai/novel-store"

/** 同步处理器接口，由 opennovel 组合层注册 */
export interface ManualEditSyncHandler {
  /** 处理章节正文同步（重建摘要、引用、段摘要、主轴） */
  handleChapterContent?(directory: string | null | undefined, novelId: string, chapterId: string, fingerprint: string): Promise<void>
  /** 处理正式设定同步（引用扫描、影响任务生成） */
  handleSettingChange?(novelId: string, entity: string, entityId: string, fingerprint: string): Promise<void>
}

const handlers = new Map<string, ManualEditSyncHandler>()

type SyncEntry = typeof ManualEditSyncQueueTable.$inferSelect

/** 注册同步处理器（由 opennovel 启动时调用） */
export function registerSyncHandler(handler: ManualEditSyncHandler): void {
  handlers.set("default", handler)
}

/** 取消注册（测试用） */
export function clearSyncHandlers(): void {
  handlers.clear()
}

let running = false
let timer: ReturnType<typeof setInterval> | null = null
const directories = new Set<string>()
let inFlight = false

/** 消费所有已登记目录；定时器与测试共用同一防重入入口 */
export async function processRegisteredSyncDirectories(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    for (const directory of directories) {
      try {
        await processSyncQueue(directory)
      } catch {
        // 单目录轮询失败不影响其余目录，下轮重试
      }
    }
  } finally {
    inFlight = false
  }
}

/**
 * 处理一批 pending 同步任务。返回处理的任务数。
 */
export async function processSyncQueue(
  directory: string | null | undefined,
  batchSize = 10,
): Promise<number> {
  const db = getDb(directory)
  const pending = await db
    .select()
    .from(ManualEditSyncQueueTable)
    .where(eq(ManualEditSyncQueueTable.status, "pending"))
    .limit(batchSize)

  if (pending.length === 0) return 0

  const handler = handlers.get("default")
  let processed = 0

  for (const entry of pending) {
    try {
      // 升级消费闸门：paused 时跳过 upgrade 任务（保留 pending，下轮重查）
      if (entry.source === "upgrade" && (await getUpgradeGate(db, entry.novel_id)) === "paused") {
        continue
      }
      // 无 handler 的普通条目走确定性摘要 upsert；observer 与升级任务都在下面事务之外先行完成
      const deterministicSummary =
        entry.entity === "chapter" &&
        entry.field === "content" &&
        Boolean(entry.entity_id) &&
        !handler?.handleChapterContent
      if (entry.entity === "chapter" && entry.field === "content" && entry.entity_id) {
        if (handler?.handleChapterContent) {
          await handler.handleChapterContent(directory, entry.novel_id, entry.entity_id, entry.source_fingerprint ?? "")
        } else if (entry.source === "upgrade") {
          // 诚实性：升级任务禁止无 handler 的确定性 fallback（不得伪造已同步）
          throw new Error("observer 重建 handler 未注册，升级任务未执行（未重建不得标记已同步）")
        }
      } else if (entry.entity !== "chapter") {
        // 正式设定变更：确定性引用扫描 + 稳定键去重的影响任务
        await handler?.handleSettingChange?.(
          entry.novel_id,
          entry.entity,
          entry.entity_id ?? "",
          entry.source_fingerprint ?? "",
        )
      }
      // 摘要、影响任务、主轴与状态回写同事务落地，中途失败整条回滚（统一事务入口：嵌套检测 + 同步回调约束）
      withTransaction(db, (tx) => applySyncEntry(tx, entry, deterministicSummary))
      processed++
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await updateSyncStatus(entry.id, "failed", reason, directory)
    }
  }

  return processed
}

/**
 * 单条同步任务的确定性写入：摘要 upsert、影响任务插入、主轴刷新与状态回写必须在同一事务里完成。
 * 分步提交会在中途失败时留下半同步状态（数据已改但条目仍 pending，或条目已 synced 但数据未改）。
 */
function applySyncEntry(tx: Tx, entry: SyncEntry, writeSummary: boolean) {
  const entityId = entry.entity_id ?? ""
  if (writeSummary && entityId) {
    const existing = tx.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, entityId)).get()
    if (existing) {
      tx.update(ChapterSummaryTable)
        .set({ source_fingerprint: entry.source_fingerprint })
        .where(eq(ChapterSummaryTable.chapter_id, entityId))
        .run()
    }
    if (!existing) {
      tx.insert(ChapterSummaryTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: entityId,
          summary: "",
          key_events: "[]",
          char_changes: "[]",
          source_fingerprint: entry.source_fingerprint,
        })
        .run()
    }
  }

  if (entry.entity !== "chapter") {
    // 确定性引用扫描：找出引用该实体的章节，并按稳定键去重生成影响任务
    const refs = tx
      .select()
      .from(EntityRefTable)
      .where(and(eq(EntityRefTable.novel_id, entry.novel_id), eq(EntityRefTable.target_id, entityId)))
      .all()
    for (const ref of refs) {
      const existing = tx
        .select()
        .from(PendingUpdateTable)
        .where(
          and(
            eq(PendingUpdateTable.novel_id, entry.novel_id),
            eq(PendingUpdateTable.trigger_id, entityId),
            eq(PendingUpdateTable.source_id, ref.source_id),
            eq(PendingUpdateTable.status, "pending"),
          ),
        )
        .get()
      if (existing) continue
      tx.insert(PendingUpdateTable)
        .values({
          id: crypto.randomUUID(),
          novel_id: entry.novel_id,
          source_type: ref.source_type,
          source_id: ref.source_id,
          trigger_type: entry.entity,
          trigger_id: entityId,
          trigger_field: entry.field,
          reason: `手动修改 ${entry.entity} 触发引用更新`,
          status: "pending",
          priority: "medium",
        })
        .run()
    }
  }

  // 章节正文同步完成后重建结构化故事主轴条目并刷新指纹
  if (entry.entity === "chapter" && entry.entity_id) {
    tx.update(StorySpineEntryTable)
      .set({ source_fingerprint: entry.source_fingerprint ?? "", status: "synced", updated_at: Date.now() })
      .where(
        and(
          eq(StorySpineEntryTable.novel_id, entry.novel_id),
          eq(StorySpineEntryTable.chapter_id, entry.entity_id),
        ),
      )
      .run()
  }

  // 状态回写也进事务：updateSyncStatus 自开连接无法加入，直接写队列表保持同样的字段语义
  tx.update(ManualEditSyncQueueTable)
    .set({ status: "synced", failure_reason: null, updated_at: Date.now() })
    .where(eq(ManualEditSyncQueueTable.id, entry.id))
    .run()
}


/** 登记需要轮询的工作区目录；首次登记时启动单一定时器 */
export function registerSyncDirectory(directory: string, intervalMs = 5000): void {
  if (directories.has(directory)) return
  directories.add(directory)
  if (running) return
  running = true
  timer = setInterval(() => void processRegisteredSyncDirectories(), intervalMs)
  if (timer && typeof timer === "object" && "unref" in timer) {
    ;(timer as { unref: () => void }).unref()
  }
}

/** 启动轮询 worker；保留旧入口，等价于登记目录 */
export function startSyncWorker(
  directory: string | null | undefined,
  intervalMs = 5000,
): void {
  if (directory) registerSyncDirectory(directory, intervalMs)
}

/** 停止 worker（测试用） */
export function stopSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  running = false
  directories.clear()
  inFlight = false
}

/** worker 是否在运行 */
export function isSyncWorkerRunning(): boolean {
  return running
}
