import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { closeDb, createCharacterState, getDb } from "../src/index.js"

const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL);
CREATE TABLE characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE character_states (id text PRIMARY KEY, character_id text NOT NULL, chapter_id text, active integer DEFAULT 1 NOT NULL, location text DEFAULT '' NOT NULL, mood text DEFAULT '' NOT NULL, summary text DEFAULT '' NOT NULL, FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `character-state-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function chapterIdNotNull() {
  const db = new Database(dbPath, { readonly: true })
  try {
    const column = db.query("PRAGMA table_info(character_states)").all().find((row) => row.name === "chapter_id")
    return Number(column?.notnull) === 1
  } finally {
    db.close()
  }
}

function stateIDs() {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query("SELECT id FROM character_states ORDER BY id").all().map((row) => row.id)
  } finally {
    db.close()
  }
}

function hasLegacyTable() {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character_states_legacy'")
      .get() !== null
  } finally {
    db.close()
  }
}

describe("character_states chapter_id 迁移", () => {
  test("遗留库重建为章节强绑定，清理无效状态并支持新写入", async () => {
    const seed = new Database(dbPath)
    seed.exec(LEGACY_SCHEMA)
    seed
      .query("INSERT INTO novels (id, title, genre, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("novel-1", "测试小说", "玄幻", 1, 1)
    seed
      .query("INSERT INTO chapters (id, novel_id, title, \"order\", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("chapter-1", "novel-1", "第一章", 1, 1, 1)
    seed
      .query("INSERT INTO characters (id, novel_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run("character-1", "novel-1", "林天", 1)
    seed
      .query("INSERT INTO character_states (id, character_id, chapter_id, location) VALUES (?, ?, ?, ?)")
      .run("state-valid", "character-1", "chapter-1", "青云门")
    seed
      .query("INSERT INTO character_states (id, character_id, chapter_id, location) VALUES (?, ?, NULL, ?)")
      .run("state-null", "character-1", "无章节")
    seed
      .query("INSERT INTO character_states (id, character_id, chapter_id, location) VALUES (?, ?, ?, ?)")
      .run("state-orphan", "character-1", "chapter-missing", "孤儿状态")
    seed.close()

    expect(chapterIdNotNull()).toBe(false)

    getDb(projectDir)

    expect(chapterIdNotNull()).toBe(true)
    expect(stateIDs()).toEqual(["state-valid"])
    expect(hasLegacyTable()).toBe(false)

    const created = await createCharacterState("character-1", { chapterId: "chapter-1", location: "藏经阁" }, projectDir)
    expect(created.chapter_id).toBe("chapter-1")
    expect(new Set(stateIDs())).toEqual(new Set(["state-valid", created.id]))

    closeDb(projectDir)
    getDb(projectDir)
    expect(chapterIdNotNull()).toBe(true)
    expect(new Set(stateIDs())).toEqual(new Set(["state-valid", created.id]))
  })

  test("新建库的 character_states 直接保持章节强绑定", () => {
    getDb(projectDir)
    expect(chapterIdNotNull()).toBe(true)
    expect(hasLegacyTable()).toBe(false)
  })
})
