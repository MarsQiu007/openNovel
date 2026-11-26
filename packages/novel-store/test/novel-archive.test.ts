/**
 * 原文存档元数据与拆章方式测试（narrative-unit-split 任务 1.1）
 *
 * 覆盖：存档元数据存取、重复保存重置游标、游标推进、随书级联删除、
 * 存量库 split_mode 列迁移补齐。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import {
  advanceSplitCursor,
  closeDb,
  deleteNovel,
  getDb,
  getNovelArchive,
  NovelTable,
  saveNovelArchive,
} from "../src/index.js"

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  dbPath = join(projectDir, ".novel", "novel.db")
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function rawQuery(sql: string): unknown {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query(sql).get()
  } finally {
    db.close()
  }
}

async function seedNovel(novelID: string) {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({
      id: novelID,
      title: "测试书",
      genre: "玄幻",
      synopsis: "",
      status: "draft",
      created_at: 1,
      updated_at: 1,
    })
    .run()
}

describe("novel archive metadata", () => {
  test("保存后可读取，重复保存覆盖元数据并重置游标", async () => {
    await seedNovel("nv-1")
    await saveNovelArchive("nv-1", { contentHash: "h1", encoding: "utf-8", wordCount: 28000, filePath: "a.txt" }, projectDir)
    await advanceSplitCursor("nv-1", 12000, projectDir)

    const first = await getNovelArchive("nv-1", projectDir)
    expect(first?.split_cursor).toBe(12000)

    await saveNovelArchive("nv-1", { contentHash: "h2", encoding: "gb18030", wordCount: 30000, filePath: "b.txt" }, projectDir)
    const second = await getNovelArchive("nv-1", projectDir)
    expect(second).toMatchObject({ content_hash: "h2", encoding: "gb18030", word_count: 30000, split_cursor: 0 })
  })

  test("无存档书返回 undefined", async () => {
    expect(await getNovelArchive("nv-missing")).toBeUndefined()
  })

  test("游标推进持久化", async () => {
    await seedNovel("nv-2")
    await saveNovelArchive("nv-2", { contentHash: "h", encoding: "utf-8", wordCount: 100, filePath: "a.txt" }, projectDir)
    await advanceSplitCursor("nv-2", 3000, projectDir)
    await advanceSplitCursor("nv-2", 6500, projectDir)
    expect((await getNovelArchive("nv-2", projectDir))?.split_cursor).toBe(6500)
  })

  test("删除书籍级联删除存档行", async () => {
    await seedNovel("nv-3")
    await saveNovelArchive("nv-3", { contentHash: "h", encoding: "utf-8", wordCount: 100, filePath: "a.txt" }, projectDir)
    await deleteNovel("nv-3", projectDir)
    expect(await getNovelArchive("nv-3", projectDir)).toBeUndefined()
  })
})

describe("novels.split_mode migration", () => {
  // 旧版书库 novels 结构（无 split_mode 列）
  const LEGACY_NOVELS_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
`

  test("存量库缺列时迁移补齐为 fast 默认", () => {
    const legacy = new Database(dbPath)
    legacy.exec(LEGACY_NOVELS_SCHEMA)
    legacy.exec(
      "INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES ('nv-old', '旧书', '玄幻', '', 1, 1, 'draft')",
    )
    legacy.close()

    // 打开库触发建表 + 迁移链
    getDb(projectDir)
    expect(rawQuery("SELECT split_mode FROM novels WHERE id = 'nv-old'")).toMatchObject({ split_mode: "fast" })
    expect(rawQuery("SELECT COUNT(*) AS n FROM novel_archives")).toMatchObject({ n: 0 })
  })

  test("新书写入默认 split_mode=fast", async () => {
    await seedNovel("nv-4")
    expect(rawQuery("SELECT split_mode FROM novels WHERE id = 'nv-4'")).toMatchObject({ split_mode: "fast" })
  })
})