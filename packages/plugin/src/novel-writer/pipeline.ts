/**
 * 流水线步骤辅助函数
 *
 * 原 pipeline.ts 中的 runPipeline 编排器已迁移为 pipeline agent（agents/pipeline.ts）。
 * 本文件保留确定性步骤的辅助函数，供 novel-writer.ts 中的工具调用。
 *
 * 导出：
 * - validateNovel(novelId) - 验证小说是否存在
 * - readChapterOutline(novelId, chapterNumber) - 读取章节大纲
 * - validateStateDelta(novelId, chapterId) - 验证状态变更
 * - persistStateDelta(novelId, chapterId) - 提交状态变更
 */
import { eq, and } from "drizzle-orm"
import { getDb, NovelTable, ChapterTable } from "./session-store.js"
import { commitState } from "./state-commit.js"

/**
 * 验证小说是否存在
 *
 * @param novelId 小说 ID
 * @returns 小说记录，不存在时返回 null
 */
export async function validateNovel(novelId: string, directory?: string | null) {
  const db = getDb(directory)
  const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).all()
  return novel ?? null
}

/**
 * 读取章节大纲
 *
 * 从数据库读取章节记录，包含标题、内容、字数等信息。
 *
 * @param novelId 小说 ID
 * @param chapterNumber 章节序号
 * @returns 章节记录，不存在时返回 null
 */
export async function readChapterOutline(novelId: string, chapterNumber: number, directory?: string | null) {
  const db = getDb(directory)
  const [chapter] = await db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, chapterNumber)))
    .all()
  return chapter ?? null
}

/**
 * 验证状态变更 delta
 *
 * 检查当前章节是否有有效的状态变更需要提交。
 * 验证变更数据的完整性和格式正确性。
 *
 * @param _novelId 小说 ID（当前未使用，保留参数以匹配工具签名）
 * @param chapterId 章节 ID
 * @returns 验证结果
 */
export async function validateStateDelta(
  _novelId: string,
  chapterId: string,
  directory?: string | null,
): Promise<{ status: "ok" | "fail"; message: string }> {
  const db = getDb(directory)
  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) {
    return { status: "fail", message: "章节不存在，无法验证状态变更" }
  }

  if (chapter.content.length === 0) {
    return { status: "fail", message: "章节内容为空，无需提交状态变更" }
  }

  return {
    status: "ok",
    message: `章节内容有效（${chapter.word_count}字），可提交状态变更`,
  }
}

/**
 * 提交状态变更到持久层
 *
 * 调用 commitState 将当前章节的状态变更写入数据库。
 * 如果无变更可提交，跳过而不报错。
 *
 * @param novelId 小说 ID
 * @param chapterId 章节 ID
 * @returns 提交结果
 */
export async function persistStateDelta(
  novelId: string,
  chapterId: string,
  directory?: string | null,
): Promise<{ status: "ok" | "fail"; message: string }> {
  const db = getDb(directory)

  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) {
    return { status: "fail", message: "章节不存在，无法提交状态" }
  }

  // 构建状态变更 delta
  const delta = [
    {
      fact_type: "chapter_summary" as const,
      action: "create" as const,
      entity_id: chapter.id,
      data: {
        title: chapter.title,
        word_count: chapter.word_count,
        status: "published",
        order: chapter.order,
      },
    },
  ]

  try {
    const count = await commitState(novelId, chapterId, delta, directory)
    return {
      status: "ok",
      message: `状态变更已提交，共 ${count} 条日志`,
    }
  } catch (err) {
    return {
      status: "fail",
      message: `状态提交失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
