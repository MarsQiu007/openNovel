/**
 * 大纲数据库持久化测试
 *
 * 覆盖：novels.master_outline 和 volumes.outline 的读写、旧库迁移。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { Database } from "bun:sqlite"
import { closeDb, getDb, NovelTable, VolumeTable } from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `outline-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

describe("outline db persistence", () => {
  test("新建小说默认 master_outline 为空，可通过 UPDATE 保存总纲", async () => {
    const db = getDb(projectDir)
    await db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "测试书", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()

    const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, "novel-1")).all()
    expect(novel.master_outline).toBe("")

    const outline = "# 《测试书》整体大纲\n\n主线剧情概要。"
    await db.update(NovelTable).set({ master_outline: outline, updated_at: Date.now() }).where(eq(NovelTable.id, "novel-1")).run()
    const [updated] = await db.select().from(NovelTable).where(eq(NovelTable.id, "novel-1")).all()
    expect(updated.master_outline).toBe(outline)
  })

  test("新建卷默认 outline 为空，可通过 UPDATE 保存卷纲", async () => {
    const db = getDb(projectDir)
    await db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "测试书", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()
    await db
      .insert(VolumeTable)
      .values({ id: "vol-1", novel_id: "novel-1", title: "第一卷", summary: "", order: 1, created_at: 1 })
      .run()

    const [vol] = await db.select().from(VolumeTable).where(eq(VolumeTable.id, "vol-1")).all()
    expect(vol.outline).toBe("")

    const outline = "# 第一卷大纲\n\n章节列表与关键事件。"
    await db.update(VolumeTable).set({ outline }).where(eq(VolumeTable.id, "vol-1")).run()
    const [updated] = await db.select().from(VolumeTable).where(eq(VolumeTable.id, "vol-1")).all()
    expect(updated.outline).toBe(outline)
  })

  test("旧库缺少 master_outline 列时自动迁移并保留原有数据", async () => {
    const sqlite = new Database(join(projectDir, ".novel", "novel.db"))
    sqlite.exec(
      `CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL)`,
    )
    sqlite.query(
      "INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("novel-1", "旧书", "玄幻", "", 1, 1, "draft")
    sqlite.close()

    const db = getDb(projectDir)
    const [novel] = await db.select().from(NovelTable).where(eq(NovelTable.id, "novel-1")).all()
    expect(novel.title).toBe("旧书")
    expect(novel.master_outline).toBe("")
  })

  test("旧库缺少 volumes.outline 列时自动迁移并保留原有数据", async () => {
    const sqlite = new Database(join(projectDir, ".novel", "novel.db"))
    sqlite.exec(
      `CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL)`,
    )
    sqlite.exec(
      `CREATE TABLE volumes (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, summary text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE)`,
    )
    sqlite.query(
      "INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("novel-1", "旧书", "玄幻", "", 1, 1, "draft")
    sqlite.query(
      "INSERT INTO volumes (id, novel_id, title, summary, \"order\", created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("vol-1", "novel-1", "第一卷", "", 1, 1)
    sqlite.close()

    const db = getDb(projectDir)
    const [vol] = await db.select().from(VolumeTable).where(eq(VolumeTable.id, "vol-1")).all()
    expect(vol.title).toBe("第一卷")
    expect(vol.outline).toBe("")
  })
})
