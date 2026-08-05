/**
 * 中断章节恢复 — 检测并恢复长时间未更新的章节
 *
 * 检测 drafting/audited 状态超过 2 小时未更新的章节，
 * 提供恢复（resume）、回滚（rollback）、丢弃（discard）三种操作。
 * 遵循 novel-writer.ts 的数据库访问模式：本地定义 drizzle 表结构，使用 drizzle-orm/bun-sqlite 直接连接。
 */
import { eq, and, inArray } from "drizzle-orm"
import { getDb, ChapterTable } from "./session-store.js"
import { CHAPTER_STATUSES } from "./chapter-status.js"
import { rollbackToVersion, listVersions } from "./chapter-rollback.js"

// ─── 常量 ───

/** 中断阈值：2 小时（毫秒） */
const INTERRUPTION_THRESHOLD_MS = 2 * 60 * 60 * 1000

/** 可中断的状态：drafting 和 audited */
const INTERRUPTIBLE_STATUSES: readonly string[] = ["drafting", "audited"]

// ─── 导出类型 ───

/** 中断章节信息 */
export interface InterruptedChapter {
  /** 章节 ID */
  id: string
  /** 小说 ID */
  novel_id: string
  /** 章节标题 */
  title: string
  /** 当前状态 */
  status: string
  /** 章节序号 */
  order: number
  /** 最后更新时间（毫秒时间戳） */
  updated_at: number
  /** 已中断时长（毫秒） */
  idle_ms: number
}

/** 恢复操作类型 */
export type ResumeAction = "resume" | "rollback" | "discard"

/** 恢复操作选项 */
export interface ResumeOption {
  /** 操作标识 */
  action: ResumeAction
  /** 操作描述 */
  description: string
}

// ─── 导出函数 ───

/**
 * 检测指定小说中处于中断状态的章节
 *
 * 查找 status 为 drafting 或 audited 且 updated_at 超过 2 小时未更新的章节。
 *
 * @param novelId 小说 ID
 * @returns 中断章节列表，按 order 升序排列
 */
export async function detectInterruptedChapters(
  novelId: string,
  directory?: string | null,
): Promise<InterruptedChapter[]> {
  const db = getDb(directory)
  const now = Date.now()

  // 查询该小说中所有处于可中断状态的章节
  const chapters = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), inArray(ChapterTable.status, INTERRUPTIBLE_STATUSES)))
    .orderBy(ChapterTable.order)
    .all()

  // 在 JS 层过滤超过 2 小时未更新的章节
  return chapters
    .filter((ch) => now - ch.updated_at > INTERRUPTION_THRESHOLD_MS)
    .map((ch) => ({
      id: ch.id,
      novel_id: ch.novel_id,
      title: ch.title,
      status: ch.status,
      order: ch.order,
      updated_at: ch.updated_at,
      idle_ms: now - ch.updated_at,
    }))
}

/**
 * 根据章节当前状态给出恢复操作选项
 *
 * @param chapterId 章节 ID
 * @returns 可用的恢复操作选项数组，章节不存在时返回空数组
 */
export async function promptResumeAction(chapterId: string, directory?: string | null): Promise<ResumeOption[]> {
  const db = getDb(directory)

  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) return []

  const status = chapter.status

  // drafting 状态：可从 drafting 继续，也可回滚或丢弃
  if (status === "drafting") {
    return [
      { action: "resume", description: "继续撰写：从 drafting 状态继续流水线，系统将基于当前内容继续生成" },
      { action: "rollback", description: "回滚：恢复上一个版本内容，并将状态重置为 planned" },
      { action: "discard", description: "丢弃：清空章节内容，并将状态重置为 planned" },
    ]
  }

  // audited 状态：可从 audited 继续，也可回滚或丢弃
  if (status === "audited") {
    return [
      { action: "resume", description: "继续审计：从 audited 状态继续流水线，进入修订阶段" },
      { action: "rollback", description: "回滚：恢复上一个版本内容，并将状态重置为 planned" },
      { action: "discard", description: "丢弃：清空章节内容，并将状态重置为 planned" },
    ]
  }

  // 非可中断状态返回空数组
  return []
}

/**
 * 执行中断章节的恢复操作
 *
 * - resume：记录恢复时间戳，状态不变，流水线从当前状态继续
 * - rollback：恢复上一个版本内容，状态重置为 planned
 * - discard：清空章节内容，状态重置为 planned
 *
 * @param chapterId 章节 ID
 * @param action 恢复操作类型
 * @returns 操作结果描述
 * @throws 章节不存在或操作不合法时抛出错误
 */
export async function handleResumeAction(
  chapterId: string,
  action: ResumeAction,
  directory?: string | null,
): Promise<string> {
  const db = getDb(directory)

  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) {
    throw new Error(`未找到章节 ${chapterId}`)
  }

  // 验证章节处于可中断状态
  if (!INTERRUPTIBLE_STATUSES.includes(chapter.status)) {
    throw new Error(`章节「${chapter.title}」当前状态为「${chapter.status}」，无需恢复操作`)
  }

  switch (action) {
    case "resume": {
      // 恢复：仅更新 updated_at，流水线从当前状态继续
      await db.update(ChapterTable).set({ updated_at: Date.now() }).where(eq(ChapterTable.id, chapterId)).run()

      return `章节「${chapter.title}」已恢复，当前状态「${chapter.status}」，流水线将继续执行`
    }

    case "rollback": {
      // 回滚：恢复到上一个版本，状态重置为 planned
      const versions = await listVersions(chapterId, directory)

      if (versions.length === 0) {
        // 无历史版本，等同于 discard
        await db
          .update(ChapterTable)
          .set({
            content: "",
            word_count: 0,
            status: "planned",
            updated_at: Date.now(),
          })
          .where(eq(ChapterTable.id, chapterId))
          .run()

        return `章节「${chapter.title}」无历史版本，已清空内容并重置为 planned 状态`
      }

      // 回滚到最新版本（版本号最大的）
      const latestVersion = versions[0].version
      await rollbackToVersion(chapterId, latestVersion, directory)

      // 将状态重置为 planned
      await db
        .update(ChapterTable)
        .set({ status: "planned", updated_at: Date.now() })
        .where(eq(ChapterTable.id, chapterId))
        .run()

      return `章节「${chapter.title}」已回滚到版本 ${latestVersion}，状态重置为 planned`
    }

    case "discard": {
      // 丢弃：清空内容，重置为 planned
      await db
        .update(ChapterTable)
        .set({
          content: "",
          word_count: 0,
          status: "planned",
          updated_at: Date.now(),
        })
        .where(eq(ChapterTable.id, chapterId))
        .run()

      return `章节「${chapter.title}」内容已清空，状态重置为 planned`
    }
  }
}
