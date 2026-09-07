/**
 * 章纲持久化数据层测试
 *
 * 覆盖：数据库读写、旧 Markdown 文件懒导入、文件缺失/不可读降级。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { Database } from "bun:sqlite"
import {
  closeDb,
  createChapter,
  getDb,
  isUsableChapterOutline,
  ChapterTable,
  NovelTable,
  resolveChapterOutline,
  updateChapter,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `chapter-outline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel", "outlines"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

async function seedNovelAndChapter() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-1", title: "测试书", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  return createChapter("novel-1", "第一章", 1, null, projectDir)
}

describe("chapter outline persistence", () => {
  test("新建章节默认没有可用章纲，可通过 updateChapter 保存并解析", async () => {
    const chapter = await seedNovelAndChapter()
    expect(isUsableChapterOutline(chapter.outline)).toBe(false)

    const outline = "# 第一章大纲\n\n本章完成开场冲突。"
    await updateChapter(chapter.id, { outline }, projectDir)
    const resolved = await resolveChapterOutline("novel-1", 1, projectDir)

    expect(resolved.available).toBe(true)
    expect(resolved.source).toBe("database")
    expect(resolved.outline).toBe(outline)
  })

  test("数据库为空时读取存量 Markdown 并懒导入数据库", async () => {
    const chapter = await seedNovelAndChapter()
    const outline = "# 存量章纲\n\n角色焦点与场景安排。"
    writeFileSync(join(projectDir, ".novel", "outlines", "chapter-1.md"), outline)

    const resolved = await resolveChapterOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline, available: true, source: "file" })

    const db = getDb(projectDir)
    const imported = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapter.id)).get()
    expect(imported.outline).toBe(outline)
  })

  test("旧库缺少 outline 列时自动迁移并保留原有章节", async () => {
    const sqlite = new Database(join(projectDir, ".novel", "novel.db"))
    sqlite.exec(`CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL)`)
    sqlite.exec(
      `CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL)`,
    )
    sqlite.query(
      "INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("novel-1", "测试书", "科幻", "", 1, 1, "draft")
    sqlite.query(
      "INSERT INTO chapters (id, novel_id, volume_id, title, content, word_count, status, \"order\", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("chapter-1", "novel-1", null, "第一章", "原正文", 100, "draft", 1, 1, 1)
    sqlite.close()

    const resolved = await resolveChapterOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline: null, available: false, source: "missing" })

    const migrated = getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.id, "chapter-1")).get()
    expect(migrated?.content).toBe("原正文")
    expect(migrated?.word_count).toBe(100)
    expect(migrated?.outline).toBe("")
  })

  test("存量文件不可读时按缺失降级，不抛出错误", async () => {
    await seedNovelAndChapter()
    mkdirSync(join(projectDir, ".novel", "outlines", "chapter-1.md"), { recursive: true })

    const resolved = await resolveChapterOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline: null, available: false, source: "missing" })
  })

  test("文件缺失时按缺失降级，不抛出错误", async () => {
    await seedNovelAndChapter()
    const resolved = await resolveChapterOutline("novel-1", 1, projectDir)

    expect(resolved.available).toBe(false)
    expect(resolved.outline).toBeNull()
    expect(resolved.source).toBe("missing")
  })
})