/**
 * 手动编辑同步门禁。
 *
 * 写作、修订或继续写作入口在消费章节摘要、实体引用、段摘要或故事主轴前，
 * 必须检查其同步状态。存在未完成的正文同步且影响当前写作范围时，
 * 门禁返回重试或跳过提示，阻止静默使用过期记忆。
 *
 * 用户显式跳过后该同步条目不再单独阻塞写作，但状态保持可追溯。
 */
import { and, eq, inArray, ne } from "drizzle-orm"
import {
  getDb,
  ManualEditSyncQueueTable,
  ChapterTable,
} from "@opennovel-ai/novel-store"

/** 门禁检查结果 */
export interface GateCheckResult {
  /** 是否放行 */
  readonly allowed: boolean
  /** 阻塞原因（放行时为 null） */
  readonly reason: string | null
  /** 需要处理的同步条目 ID 列表 */
  readonly blockingSyncIds: readonly string[]
  /** 是否可以跳过 */
  readonly skippable: boolean
}

/**
 * 检查指定章节的正文同步门禁。
 *
 * @param novelId 小说 ID
 * @param targetChapterOrder 目标章节号（要写的章节）
 * @param directory 项目目录
 * @returns 门禁检查结果
 */
export function checkContentSyncGate(
  novelId: string,
  targetChapterOrder?: number,
  directory?: string | null,
): GateCheckResult {
  const db = getDb(directory)
  const pending = db
    .select()
    .from(ManualEditSyncQueueTable)
    .where(
      and(
        eq(ManualEditSyncQueueTable.novel_id, novelId),
        eq(ManualEditSyncQueueTable.entity, "chapter"),
        inArray(ManualEditSyncQueueTable.status, ["pending", "failed"]),
      ),
    )
    .all()

  if (pending.length === 0) {
    return { allowed: true, reason: null, blockingSyncIds: [], skippable: false }
  }

  const blockingIds = pending.map((entry) => entry.id)
  const failed = pending.filter((entry) => entry.status === "failed")
  const chapterIds = pending.map((entry) => entry.entity_id).filter((id): id is string => id !== null)

  let reason = `有 ${pending.length} 个章节正文同步未完成`
  if (failed.length > 0) {
    reason += `（其中 ${failed.length} 个失败: ${failed[0]?.failure_reason ?? "未知原因"}）`
  }

  return { allowed: false, reason, blockingSyncIds: blockingIds, skippable: true }
}

/**
 * 检查设定影响面门禁（未处理的 UI 设定联动任务）。
 *
 * 返回包含目标对象名称的提示。
 */
export function checkSettingImpactGate(
  novelId: string,
  directory?: string | null,
): GateCheckResult {
  const db = getDb(directory)
  const pending = db
    .select()
    .from(ManualEditSyncQueueTable)
    .where(
      and(
        eq(ManualEditSyncQueueTable.novel_id, novelId),
        ne(ManualEditSyncQueueTable.entity, "chapter"),
        inArray(ManualEditSyncQueueTable.status, ["pending", "failed"]),
      ),
    )
    .all()

  if (pending.length === 0) {
    return { allowed: true, reason: null, blockingSyncIds: [], skippable: false }
  }

  const entities = [...new Set(pending.map((entry) => entry.entity))]
  const reason = `以下设定存在未处理的联动任务: ${entities.join("、")}`

  return { allowed: false, reason, blockingSyncIds: pending.map((e) => e.id), skippable: true }
}

/**
 * 用户显式跳过指定同步条目。
 *
 * 跳过后该项不再单独阻塞写作，但状态保持为 skipped 可追溯。
 */
export async function skipSyncEntries(
  syncIds: readonly string[],
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  for (const id of syncIds) {
    await db
      .update(ManualEditSyncQueueTable)
      .set({ status: "skipped", updated_at: Date.now() })
      .where(eq(ManualEditSyncQueueTable.id, id))
      .run()
  }
}
