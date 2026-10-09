/**
 * 章节版本回滚字数口径测试
 *
 * 回滚恢复章节行时 content 与 word_count 必须成对取自目标版本快照，
 * 不得按 content.length 重算——历史版本行的存储值即网文口径正确值。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, getDb, NovelTable, ChapterTable, ChapterVersionTable } from "../../src/novel-writer/session-store.js"
import { rollbackToVersion } from "../../src/novel-writer/chapter-rollback.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `chapter-rollback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

describe("rollbackToVersion 字数成对恢复", () => {
  test("回滚后章节 word_count 等于目标版本存储值（照抄快照，非重算）", async () => {
    const db = getDb(projectDir)
    const now = Date.now()
    db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "回滚测试", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now })
      .run()
    db
      .insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", content: "当前正文，含标点。", word_count: 8, status: "final", order: 1, created_at: now, updated_at: now })
      .run()
    // 目标版本：内容含标点（content.length=9），存储 word_count=42——与 content.length 和
    // countWords(=7) 均不同，专门钉住"照抄快照存储值"的语义，防止被改回任何重算口径。
    db
      .insert(ChapterVersionTable)
      .values({ id: "cv-1", chapter_id: "ch-1", version: 1, content: "旧版正文，含标点。", word_count: 42, created_at: now, created_by: "ai" })
      .run()

    await rollbackToVersion("ch-1", 1, projectDir)

    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, "ch-1")).get()
    expect(chapter?.content).toBe("旧版正文，含标点。")
    expect(chapter?.word_count).toBe(42)
  })
})
