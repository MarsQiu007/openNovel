/**
 * session_novel 悬空外键迁移测试
 *
 * 历史遗留 schema 中 session_novel 带有 FOREIGN KEY (session_id) REFERENCES session(id)，
 * 而 session 表只存在于 opennovel 存储库，小说项目库中不存在。Node 运行时（node:sqlite）
 * prepare INSERT 时解析外键父表会抛 "no such table: main.session"。
 * 迁移应在打开 DB 时重建表去除悬空外键，并保留原有数据。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { getDb, tagNovelSession, resolveNovelForSession } from "../src/index.js"

const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE session_novel (id text PRIMARY KEY, session_id text NOT NULL, novel_id text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
`

function foreignKeyTables(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db
      .query("PRAGMA foreign_key_list(session_novel)")
      .all()
      .map((row) => row.table as string)
  } finally {
    db.close()
  }
}

function sessionNovelRows(dbPath: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query("select id, session_id, novel_id from session_novel order by id").all()
  } finally {
    db.close()
  }
}

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  dbPath = join(projectDir, ".novel", "novel.db")
})

afterEach(() => {
  // getDb 的连接缓存会一直持有 DB 文件，Windows 下无法删除已打开的文件，尽力清理
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败，进程退出后系统会回收临时文件
  }
})

describe("session_novel 悬空外键迁移", () => {
  test("遗留库：去除悬空外键且保留数据，懒绑定与标记可用", async () => {
    const seed = new Database(dbPath)
    seed.exec(LEGACY_SCHEMA)
    seed.query("insert into novels (id, title, genre, created_at, updated_at) values (?, ?, ?, ?, ?)").run(
      "novel-1",
      "测试小说",
      "玄幻",
      1,
      1,
    )
    seed.query("insert into session_novel (id, session_id, novel_id, created_at) values (?, ?, ?, ?)").run(
      "sn-1",
      "ses_old",
      "novel-1",
      1,
    )
    seed.close()
    expect(foreignKeyTables(dbPath)).toContain("session")

    // 打开 DB 触发迁移
    getDb(projectDir)

    expect(foreignKeyTables(dbPath)).not.toContain("session")
    expect(foreignKeyTables(dbPath)).toContain("novels")
    expect(sessionNovelRows(dbPath)).toEqual([{ id: "sn-1", session_id: "ses_old", novel_id: "novel-1" }])

    // 懒绑定 + 会话标记（Node 运行时报错的正是这条路径）
    const novelId = await resolveNovelForSession("ses_new", projectDir)
    expect(novelId).toBe("novel-1")
    await tagNovelSession("ses_new2", "novel-1", projectDir)
    expect(sessionNovelRows(dbPath).length).toBe(3)
  })

  test("新建库不受影响：session_novel 仅引用 novels", () => {
    getDb(projectDir)
    expect(foreignKeyTables(dbPath)).toEqual(["novels"])
  })

  test("迁移幂等：重复打开不抛错、数据不变", async () => {
    const seed = new Database(dbPath)
    seed.exec(LEGACY_SCHEMA)
    seed.query("insert into novels (id, title, genre, created_at, updated_at) values (?, ?, ?, ?, ?)").run(
      "novel-1",
      "测试小说",
      "玄幻",
      1,
      1,
    )
    seed.query("insert into session_novel (id, session_id, novel_id, created_at) values (?, ?, ?, ?)").run(
      "sn-1",
      "ses_old",
      "novel-1",
      1,
    )
    seed.close()

    getDb(projectDir)
    // fresh 绕过连接缓存，强制再走一次 createDb
    getDb(projectDir, { fresh: true })

    expect(foreignKeyTables(dbPath)).not.toContain("session")
    expect(sessionNovelRows(dbPath)).toEqual([{ id: "sn-1", session_id: "ses_old", novel_id: "novel-1" }])
  })
})

describe("characters status 列迁移", () => {
  const LEGACY_CHARACTERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE IF NOT EXISTS characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
`

  test("遗留库：自动添加 status 列，默认 active", () => {
    const seed = new Database(dbPath)
    seed.exec(LEGACY_CHARACTERS_SCHEMA)
    seed.query("insert into novels (id, title, genre, created_at, updated_at) values (?, ?, ?, ?, ?)").run(
      "novel-1",
      "测试",
      "玄幻",
      1,
      1,
    )
    seed.query("insert into characters (id, novel_id, name, role, description, created_at) values (?, ?, ?, ?, ?, ?)").run(
      "char-1",
      "novel-1",
      "陆沉",
      "protagonist",
      "主角",
      1,
    )
    seed.close()

    // 迁移前无 status 列
    const before = new Database(dbPath, { readonly: true })
    const colsBefore = before.query("PRAGMA table_info(characters)").all().map((r) => r.name)
    before.close()
    expect(colsBefore).not.toContain("status")

    // 打开 DB 触发迁移
    getDb(projectDir)

    // 迁移后有 status 列，默认 active
    const after = new Database(dbPath, { readonly: true })
    const colsAfter = after.query("PRAGMA table_info(characters)").all().map((r) => r.name)
    const char = after.query("select status from characters where id = 'char-1'").get()
    after.close()
    expect(colsAfter).toContain("status")
    expect(char.status).toBe("active")
  })

  test("新建库：characters 自带 status 列", () => {
    getDb(projectDir)
    const db = new Database(dbPath, { readonly: true })
    const cols = db.query("PRAGMA table_info(characters)").all().map((r) => r.name)
    db.close()
    expect(cols).toContain("status")
  })
})
