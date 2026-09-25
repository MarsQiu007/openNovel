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
  NovelTable,
  updateSyncStatus,
  computeFingerprint,
  getUpgradeGate,
} from "@opennovel-ai/novel-store"

/** 同步处理器接口，由 opennovel 组合层注册 */
export interface ManualEditSyncHandler {
  /** 处理章节正文同步（重建摘要、引用、段摘要、主轴） */
  handleChapterContent?(novelId: string, chapterId: string, fingerprint: string): Promise<void>
  /** 处理正式设定同步（引用扫描、影响任务生成） */
  handleSettingChange?(novelId: string, entity: string, entityId: string, fingerprint: string): Promise<void>
}

const handlers = new Map<string, ManualEditSyncHandler>()

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
      if (entry.entity === "chapter" && entry.field === "content" && entry.entity_id) {
        if (handler?.handleChapterContent) {
          await handler.handleChapterContent(entry.novel_id, entry.entity_id, entry.source_fingerprint ?? "")
        } else if (entry.source === "upgrade") {
          // 诚实性：升级任务禁止无 handler 的确定性 fallback（不得伪造已同步）
          throw new Error("observer 重建 handler 未注册，升级任务未执行（未重建不得标记已同步）")
        } else {
          // 无 handler 时执行确定性标记（upsert）
          const db2 = getDb(directory)
          const existing = await db2
            .select()
            .from(ChapterSummaryTable)
            .where(eq(ChapterSummaryTable.chapter_id, entry.entity_id))
            .get()
          if (existing) {
            await db2
              .update(ChapterSummaryTable)
              .set({ source_fingerprint: entry.source_fingerprint })
              .where(eq(ChapterSummaryTable.chapter_id, entry.entity_id))
              .run()
          } else {
            await db2
              .insert(ChapterSummaryTable)
              .values({
                id: crypto.randomUUID(),
                chapter_id: entry.entity_id,
                summary: "",
                key_events: "[]",
                char_changes: "[]",
                source_fingerprint: entry.source_fingerprint,
              })
              .run()
          }
        }
      } else if (entry.entity !== "chapter") {
        // 正式设定变更：确定性引用扫描 + 稳定键去重的影响任务
        if (handler?.handleSettingChange) {
          await handler.handleSettingChange(entry.novel_id, entry.entity, entry.entity_id ?? "", entry.source_fingerprint ?? "")
        }
        const db2 = getDb(directory)
        const entityId = entry.entity_id ?? ""
        // 确定性引用扫描：找出引用该实体的章节
        const refs = await db2
          .select()
          .from(EntityRefTable)
          .where(and(eq(EntityRefTable.novel_id, entry.novel_id), eq(EntityRefTable.target_id, entityId)))
          .all()
        // 按稳定键去重生成影响任务（novel + trigger_type + trigger_id + trigger_field）
        for (const ref of refs) {
          const existing = await db2
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
          if (!existing) {
            await db2.insert(PendingUpdateTable).values({
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
            }).run()
          }
        }
      }
      // 章节正文同步完成后重建结构化故事主轴条目并刷新指纹
      if (entry.entity === "chapter" && entry.entity_id) {
        const db3 = getDb(directory)
        const fp = entry.source_fingerprint ?? ""
        await db3
          .update(StorySpineEntryTable)
          .set({ source_fingerprint: fp, status: "synced", updated_at: Date.now() })
          .where(and(eq(StorySpineEntryTable.novel_id, entry.novel_id), eq(StorySpineEntryTable.chapter_id, entry.entity_id)))
          .run()
      }
      await updateSyncStatus(entry.id, "synced", null, directory)
      processed++
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await updateSyncStatus(entry.id, "failed", reason, directory)
    }
  }

  return processed
}

/** 启动轮询 worker */
export function startSyncWorker(
  directory: string | null | undefined,
  intervalMs = 5000,
): void {
  if (running) return
  running = true
  timer = setInterval(async () => {
    try {
      await processSyncQueue(directory)
    } catch {
      // 轮询失败静默，下轮重试
    }
  }, intervalMs)
  if (timer && typeof timer === "object" && "unref" in timer) {
    ;(timer as { unref: () => void }).unref()
  }
}

/** 停止 worker（测试用） */
export function stopSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  running = false
}

/** worker 是否在运行 */
export function isSyncWorkerRunning(): boolean {
  return running
}
