/**
 * 章节状态管理 — 章节生命周期状态流转
 *
 * 提供章节状态的查询、更新和合法转换验证。
 * 遵循 novel-writer.ts 的数据库访问模式：本地定义 drizzle 表结构，使用 drizzle-orm/bun-sqlite 直接连接。
 */

import { and, eq } from "drizzle-orm"
import { getDb, ChapterTable } from "./session-store.js"

// ─── 状态常量 ───

/** 章节状态列表 */
export const CHAPTER_STATUSES = ["planned", "drafting", "audited", "revised", "final"] as const

/** 章节状态类型 */
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number]

// ─── 状态转换规则 ───

/** 合法状态转换映射表 */
const ALLOWED_TRANSITIONS: Record<ChapterStatus, ChapterStatus[]> = {
  planned: ["drafting"],
  drafting: ["audited"],
  audited: ["revised"],
  revised: ["final"],
  final: [],
}

// ─── 导出函数 ───

/**
 * 验证状态转换是否合法
 *
 * @param currentStatus 当前章节状态
 * @param newStatus 目标状态
 * @returns 如果转换合法返回 true，否则返回 false
 */
export function canTransitionTo(currentStatus: ChapterStatus, newStatus: ChapterStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentStatus]
  // 状态来自数据库，可能是状态机之外的历史值：缺键按「不可转换」处理，不再抛 TypeError
  if (!allowed) return false
  return allowed.includes(newStatus)
}

/**
 * 更新章节状态
 *
 * 先检查章节是否存在，再验证状态转换是否合法，最后更新 chapters 表。
 *
 * @param chapterId 章节 ID
 * @param status 目标状态
 * @returns 更新后的章节状态字符串，章节不存在时返回 null
 * @throws 如果状态转换不合法，抛出错误
 */
export async function updateChapterStatus(
  chapterId: string,
  status: ChapterStatus,
  directory?: string | null,
): Promise<ChapterStatus | null> {
  const db = getDb(directory)

  // 查询章节当前状态
  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) return null

  // chapters.status 由别处写入（novel-store 建章默认 draft、大纲流程写 outline），未必落在状态机内
  if (!CHAPTER_STATUSES.includes(chapter.status as ChapterStatus)) {
    throw new Error(`章节状态未知，无法流转：「${chapter.status}」。合法状态：${CHAPTER_STATUSES.join(" / ")}`)
  }

  const currentStatus = chapter.status as ChapterStatus

  // 验证状态转换合法性
  if (!canTransitionTo(currentStatus, status)) {
    throw new Error(
      `状态转换不合法：无法从「${currentStatus}」转换到「${status}」。` +
        `合法转换路径：${ALLOWED_TRANSITIONS[currentStatus].join(" → ") || "（终点，无法继续转换）"}`,
    )
  }

  // 更新章节状态：WHERE 带上刚校验过的当前状态，并发调用只有一个能通过
  const updated = await db
    .update(ChapterTable)
    .set({
      status,
      updated_at: Date.now(),
    })
    .where(and(eq(ChapterTable.id, chapterId), eq(ChapterTable.status, currentStatus)))
    .returning({ id: ChapterTable.id })
    .all()

  if (updated.length === 0) {
    throw new Error(`章节状态已被并发修改，请重新读取后再试：${chapterId}`)
  }

  return status
}

/**
 * 查询章节当前状态
 *
 * @param chapterId 章节 ID
 * @returns 当前章节状态字符串，章节不存在时返回 null
 */
export async function getChapterStatus(chapterId: string, directory?: string | null): Promise<ChapterStatus | null> {
  const db = getDb(directory)

  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) return null

  return chapter.status as ChapterStatus
}
