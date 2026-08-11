/**
 * 删除小说级联清理测试
 *
 * 历史 bug：bun:sqlite 默认不启用外键，ON DELETE CASCADE 失效，
 * deleteNovel 只删 novels 主行，全部子表残留为孤儿数据。
 *
 * 覆盖：
 * 1. deleteNovel 级联删除全部子表数据（驱动层 PRAGMA foreign_keys = ON）
 * 2. 存量孤儿行由启动迁移清理（模拟外键关闭时期写入的残留数据）
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import {
  getDb,
  getDbPath,
  deleteNovel,
  tagNovelSession,
  NovelTable,
  VolumeTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterTable,
  SessionNovelTable,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  // getDb 的连接缓存会一直持有 DB 文件，Windows 下无法删除已打开的文件，尽力清理
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

async function seedNovelTree(novelID: string) {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: novelID, title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  await db
    .insert(VolumeTable)
    .values({ id: `${novelID}-vol`, novel_id: novelID, title: "第一卷", summary: "", order: 1, created_at: 1 })
    .run()
  await db
    .insert(ChapterTable)
    .values({
      id: `${novelID}-ch`,
      novel_id: novelID,
      volume_id: `${novelID}-vol`,
      title: "第一章",
      content: "正文",
      word_count: 2,
      status: "draft",
      order: 1,
      created_at: 1,
      updated_at: 1,
    })
    .run()
  await db
    .insert(ChapterVersionTable)
    .values({
      id: `${novelID}-ver`,
      chapter_id: `${novelID}-ch`,
      version: 1,
      content: "正文",
      word_count: 2,
      created_at: 1,
      created_by: "test",
    })
    .run()
  await db
    .insert(CharacterTable)
    .values({ id: `${novelID}-char`, novel_id: novelID, name: "主角", role: "protagonist", created_at: 1 })
    .run()
  await tagNovelSession("ses_bound", novelID, projectDir)
}

async function countRows(table: typeof VolumeTable | typeof ChapterTable | typeof ChapterVersionTable | typeof CharacterTable | typeof SessionNovelTable) {
  const db = getDb(projectDir)
  const rows = await db.select().from(table).all()
  return rows.length
}

describe("deleteNovel 级联删除", () => {
  test("删除小说后卷/章节/版本/角色/绑定全部清除", async () => {
    await seedNovelTree("novel-1")
    expect(await countRows(ChapterTable)).toBe(1)

    await deleteNovel("novel-1", projectDir)

    expect(await countRows(VolumeTable)).toBe(0)
    expect(await countRows(ChapterTable)).toBe(0)
    expect(await countRows(ChapterVersionTable)).toBe(0)
    expect(await countRows(CharacterTable)).toBe(0)
    expect(await countRows(SessionNovelTable)).toBe(0)
  })

  test("删除一本不影响同目录其他书籍", async () => {
    await seedNovelTree("novel-1")
    await seedNovelTree("novel-2")

    await deleteNovel("novel-1", projectDir)

    expect(await countRows(VolumeTable)).toBe(1)
    expect(await countRows(ChapterTable)).toBe(1)
    expect(await countRows(SessionNovelTable)).toBe(1)
  })
})

describe("孤儿数据清理迁移", () => {
  test("外键关闭时期残留的孤儿行在下次打开 DB 时被清理", async () => {
    await seedNovelTree("novel-1")

    // 模拟历史 bun 驱动行为：关闭外键后直接删除主行，制造孤儿数据
    const raw = new Database(getDbPath(projectDir))
    raw.exec("PRAGMA foreign_keys = OFF")
    raw.run("DELETE FROM novels WHERE id = ?", ["novel-1"])
    // 残留确认：直接读文件库，孤儿行确实存在
    const orphans = raw.query("SELECT count(*) AS n FROM chapters").get() as { n: number }
    expect(orphans.n).toBe(1)
    raw.close()

    // 用 fresh 连接重新打开 DB：启动迁移应清理全部孤儿行
    const db = getDb(projectDir, { fresh: true })
    expect(await db.select().from(ChapterTable).all()).toHaveLength(0)
    expect(await db.select().from(VolumeTable).all()).toHaveLength(0)
    expect(await db.select().from(ChapterVersionTable).all()).toHaveLength(0)
    expect(await db.select().from(CharacterTable).all()).toHaveLength(0)
    expect(await db.select().from(SessionNovelTable).all()).toHaveLength(0)
  })
})
