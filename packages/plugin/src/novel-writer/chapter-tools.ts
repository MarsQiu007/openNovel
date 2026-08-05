/**
 * 章节工具 — chapter.plan / chapter.write / chapter.revise
 *
 * 提供章节规划、写作、修订三个工具，使用 Zod 验证输入。
 * 遵循 novel-writer.ts 的数据库访问模式：本地定义 drizzle 表结构，使用 drizzle-orm/bun-sqlite 直接连接。
 */
import { z } from "zod"
import { tool, type ToolContext } from "../tool.js"
import { eq, desc } from "drizzle-orm"
import { getDb, ChapterTable, ChapterVersionTable } from "./session-store.js"

// ─── 工具定义 ───

/**
 * 章节规划工具 — 查询章节大纲，返回章节写作意图
 * 输入：chapterId
 * 输出：章节基本信息（标题、序号、状态、字数、已存内容摘要）
 */
export const chapterPlan = tool({
  description: "规划章节：查询章节大纲，返回章节写作意图（标题、序号、状态、字数、已有内容摘要）",
  args: {
    chapterId: tool.schema.string().describe("章节 ID"),
  },
  async execute(args, context: ToolContext) {
    const db = getDb(context.directory)
    const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapterId)).all()

    if (!chapter) {
      return { output: `未找到章节 ${args.chapterId}` }
    }

    const lines = [
      `## 章节规划：${chapter.title}`,
      "",
      `- **章节 ID**：${chapter.id}`,
      `- **小说 ID**：${chapter.novel_id}`,
      `- **卷 ID**：${chapter.volume_id || "未分配"}`,
      `- **序号**：第 ${chapter.order} 章`,
      `- **状态**：${chapter.status}`,
      `- **当前字数**：${chapter.word_count} 字`,
      "",
      "### 已有内容",
      chapter.content
        ? chapter.content.length > 200
          ? chapter.content.slice(0, 200) + "..."
          : chapter.content
        : "（无内容）",
    ]

    return { output: lines.join("\n") }
  },
})

/**
 * 章节写作工具 — 写入章节内容，验证 2000-3000 字符
 * 输入：chapterId + content（Markdown 格式）
 * 验证：2000 <= content.length <= 3000 中文字符
 * 输出：写入成功消息
 */
export const chapterWrite = tool({
  description: "写章节：输入章节 ID 和 Markdown 内容，验证 2000-3000 字符后写入 chapters 表",
  args: {
    chapterId: tool.schema.string().describe("章节 ID"),
    content: tool.schema.string().describe("章节正文（Markdown 格式，2000-3000 字符）"),
  },
  async execute(args, context: ToolContext) {
    const len = args.content.length
    if (len < 2000) {
      return { output: `字数不足：当前 ${len} 字，需要至少 2000 字（中文字符，使用 str.length 计数）` }
    }
    if (len > 3000) {
      return { output: `字数超限：当前 ${len} 字，需要至多 3000 字（中文字符，使用 str.length 计数）` }
    }

    const db = getDb(context.directory)
    const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapterId)).all()

    if (!chapter) {
      return { output: `未找到章节 ${args.chapterId}` }
    }

    await db
      .update(ChapterTable)
      .set({
        content: args.content,
        word_count: len,
        status: "draft",
        updated_at: Date.now(),
      })
      .where(eq(ChapterTable.id, args.chapterId))
      .run()

    return {
      output: `章节「${chapter.title}」写入成功：${len} 字`,
    }
  },
})

/**
 * 章节修订工具 — 保存旧版本到 chapter_versions，再更新章节内容
 * 输入：chapterId + content（Markdown 格式）
 * 流程：先 INSERT 旧内容到 chapter_versions，再 UPDATE chapters
 * 输出：修订成功消息
 */
export const chapterRevise = tool({
  description: "修改章节：输入章节 ID 和新内容，先保存旧版本到 chapter_versions 表，再更新 chapters 表",
  args: {
    chapterId: tool.schema.string().describe("章节 ID"),
    content: tool.schema.string().describe("修改后的章节正文（Markdown 格式）"),
  },
  async execute(args, context: ToolContext) {
    const db = getDb(context.directory)
    const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapterId)).all()

    if (!chapter) {
      return { output: `未找到章节 ${args.chapterId}` }
    }

    // 保存旧版本到 chapter_versions
    if (chapter.content) {
      // 获取当前最大版本号
      const [lastVersion] = await db
        .select()
        .from(ChapterVersionTable)
        .where(eq(ChapterVersionTable.chapter_id, args.chapterId))
        .orderBy(desc(ChapterVersionTable.version))
        .limit(1)
        .all()

      const nextVersion = (lastVersion?.version ?? 0) + 1

      await db
        .insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: args.chapterId,
          version: nextVersion,
          content: chapter.content,
          word_count: chapter.word_count,
          created_at: Date.now(),
          created_by: "ai",
        })
        .run()
    }

    // 更新章节内容
    const newLen = args.content.length
    await db
      .update(ChapterTable)
      .set({
        content: args.content,
        word_count: newLen,
        updated_at: Date.now(),
      })
      .where(eq(ChapterTable.id, args.chapterId))
      .run()

    return {
      output: `章节「${chapter.title}」修订成功：${newLen} 字（旧版本已保存到 chapter_versions）`,
    }
  },
})
