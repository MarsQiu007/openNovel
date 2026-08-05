/**
 * 章节版本回滚 — rollbackToVersion / listVersions
 *
 * 提供章节版本回滚和版本列表查询功能。
 * 回滚时自动保存当前版本为新版本，确保回滚可逆。
 * 遵循 novel-writer.ts 的数据库访问模式：本地定义 drizzle 表结构，使用 drizzle-orm/bun-sqlite 直接连接。
 */
import { eq, and, desc } from "drizzle-orm"
import { getDb, ChapterTable, ChapterVersionTable } from "./session-store.js"

// ─── 导出类型 ───

/** 版本信息 */
export interface VersionInfo {
  version: number
  created_at: number
  word_count: number
}

// ─── 导出函数 ───

/**
 * 回滚到指定版本
 * 先保存当前章节内容为新版本（确保回滚可逆），再将章节内容恢复为目标版本的内容
 * @param chapterId 章节 ID
 * @param versionNumber 目标版本号
 * @returns 回滚成功消息
 */
export async function rollbackToVersion(
  chapterId: string,
  versionNumber: number,
  directory?: string | null,
): Promise<string> {
  const db = getDb(directory)

  // 验证章节存在
  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()

  if (!chapter) {
    throw new Error(`未找到章节 ${chapterId}`)
  }

  // 查询目标版本
  const [targetVersion] = await db
    .select()
    .from(ChapterVersionTable)
    .where(and(eq(ChapterVersionTable.chapter_id, chapterId), eq(ChapterVersionTable.version, versionNumber)))
    .all()

  if (!targetVersion) {
    throw new Error(`未找到章节 ${chapterId} 的版本 ${versionNumber}`)
  }

  // 获取当前最大版本号
  const [lastVersion] = await db
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .limit(1)
    .all()

  const nextVersion = (lastVersion?.version ?? 0) + 1

  // 保存当前内容为新版本（确保回滚可逆）
  if (chapter.content) {
    await db
      .insert(ChapterVersionTable)
      .values({
        id: crypto.randomUUID(),
        chapter_id: chapterId,
        version: nextVersion,
        content: chapter.content,
        word_count: chapter.word_count,
        created_at: Date.now(),
        created_by: "rollback",
      })
      .run()
  }

  // 恢复目标版本内容
  await db
    .update(ChapterTable)
    .set({
      content: targetVersion.content,
      word_count: targetVersion.content.length,
      updated_at: Date.now(),
    })
    .where(eq(ChapterTable.id, chapterId))
    .run()

  return `章节「${chapter.title}」已回滚到版本 ${versionNumber}（当前内容已保存为版本 ${nextVersion}）`
}

/**
 * 列出章节的所有可用版本
 * @param chapterId 章节 ID
 * @returns 版本信息数组，按版本号降序排列
 */
export async function listVersions(chapterId: string, directory?: string | null): Promise<VersionInfo[]> {
  const db = getDb(directory)

  const versions = await db
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .all()

  return versions.map((v) => ({
    version: v.version,
    created_at: v.created_at,
    word_count: v.word_count,
  }))
}
