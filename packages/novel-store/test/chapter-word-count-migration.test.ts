/**
 * word_count 存量迁移测试（migrateChapterWordCount）。
 *
 * 历史行按 content.length 口径写入的 word_count 须被重算为网文口径
 * （汉字逐字 + 英文/数字按词，不含标点空白换行）；迁移幂等（重复执行
 * 零 UPDATE）；无 chapters 表的库（全局库形态）自动跳过。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { countWords } from "@opennovel-ai/schema/schema"
import { closeDb, getDb } from "../src/index.js"
import { migrateChapterWordCount } from "../src/migrate.js"

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `wc-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE chapter_versions (id text PRIMARY KEY, chapter_id text NOT NULL, version integer NOT NULL, content text NOT NULL, word_count integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, created_by text NOT NULL, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
`

const CHAPTER_CONTENT = "原正文，含标点。"
const VERSION_CONTENT = "版本正文，含标点。"

function seedLegacyDb() {
  const seed = new Database(dbPath)
  seed.exec(LEGACY_SCHEMA)
  seed
    .query("INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("novel-1", "测试书", "玄幻", "", 1, 1, "draft")
  // 脏数据：word_count 按 content.length 口径写入（远大于网文口径值）
  seed
    .query(
      "INSERT INTO chapters (id, novel_id, title, content, word_count, status, \"order\", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("chapter-1", "novel-1", "第一章", CHAPTER_CONTENT, 100, "draft", 1, 1, 1)
  seed
    .query(
      "INSERT INTO chapter_versions (id, chapter_id, version, content, word_count, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("cv-1", "chapter-1", 1, VERSION_CONTENT, 100, 1, "ai")
  seed.close()
}

function openWithUpdateCounting() {
  const sqlite = new Database(dbPath)
  let updates = 0
  const exec = (sql: string) => {
    if (sql.startsWith("UPDATE")) updates++
    return sqlite.exec(sql)
  }
  const query = (sql: string) => sqlite.query(sql).all()
  return { sqlite, exec, query, updateCount: () => updates }
}

describe("migrateChapterWordCount 存量重算", () => {
  test("建连触发迁移：两表脏行重算为网文口径", () => {
    seedLegacyDb()
    const db = getDb(projectDir)

    const chapter = db.all("SELECT word_count FROM chapters WHERE id = 'chapter-1'")
    const version = db.all("SELECT word_count FROM chapter_versions WHERE id = 'cv-1'")
    expect(chapter).toEqual([{ word_count: countWords(CHAPTER_CONTENT) }])
    expect(version).toEqual([{ word_count: countWords(VERSION_CONTENT) }])
    expect(countWords(CHAPTER_CONTENT)).not.toBe(100)
  })

  test("幂等：首次执行写入收敛值，重复执行零 UPDATE", () => {
    seedLegacyDb()
    const first = openWithUpdateCounting()
    migrateChapterWordCount(first.exec, first.query)
    expect(first.updateCount()).toBe(2)
    first.sqlite.close()

    const second = openWithUpdateCounting()
    migrateChapterWordCount(second.exec, second.query)
    expect(second.updateCount()).toBe(0)
    const rows = second.query("SELECT word_count FROM chapters WHERE id = 'chapter-1'")
    expect(rows).toEqual([{ word_count: countWords(CHAPTER_CONTENT) }])
    second.sqlite.close()
  })

  test("无 chapters 表的库（全局库形态）跳过，不抛错", () => {
    const barePath = join(projectDir, ".novel", "bare.db")
    const bare = new Database(barePath)
    bare.exec("CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL)")
    let updates = 0
    const exec = (sql: string) => {
      if (sql.startsWith("UPDATE")) updates++
      return bare.exec(sql)
    }
    const query = (sql: string) => bare.query(sql).all()

    expect(() => migrateChapterWordCount(exec, query)).not.toThrow()
    expect(updates).toBe(0)
    bare.close()
  })
})
