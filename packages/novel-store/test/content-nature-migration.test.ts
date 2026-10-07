import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { closeDb, getBookContentNature, getDb, updateNovel } from "../src/index.js"

// 旧版书库 novels 结构（无 content_nature 列）；techniques 为现行结构（scope 列由更早版本迁移补齐）
const LEGACY_NOVELS_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, scope text DEFAULT 'general' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);
`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-content-nature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  dbPath = join(projectDir, ".novel", "novel.db")
  const db = new Database(dbPath)
  db.exec(LEGACY_NOVELS_SCHEMA)
  db.close()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function natureOf(novelId: string): string {
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db.query("SELECT content_nature FROM novels WHERE id = ?").get(novelId) as { content_nature: string }
    return row.content_nature
  } finally {
    db.close()
  }
}

function columnExists(): boolean {
  const db = new Database(dbPath, { readonly: true })
  try {
    const cols = db.query("PRAGMA table_info(novels)").all() as Array<{ name: string }>
    return cols.some((c) => c.name === "content_nature")
  } finally {
    db.close()
  }
}

describe("migrateNovelContentNature", () => {
  test("旧库加列且默认 general", () => {
    const db = new Database(dbPath)
    db.exec("INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at) VALUES ('n1', '书一', '科幻', '', 1, 1)")
    db.close()
    getDb(projectDir) // 建连触发迁移
    expect(columnExists()).toBe(true)
    expect(natureOf("n1")).toBe("general")
  })

  test("含受限性质技法的旧书置为 adult", () => {
    const db = new Database(dbPath)
    db.exec("INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at) VALUES ('n1', '书一', '科幻', '', 1, 1)")
    db.exec(
      "INSERT INTO techniques (id, name, principle, instruction, level, created_at, updated_at, scope) VALUES ('t1', '技法', '原则', '指令', 'paragraph', 1, 1, 'adult')",
    )
    db.close()
    getDb(projectDir)
    expect(natureOf("n1")).toBe("adult")
  })

  test("迁移幂等：重复建连不翻转已显式写回 general 的书", () => {
    const db = new Database(dbPath)
    db.exec("INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at) VALUES ('n1', '书一', '科幻', '', 1, 1)")
    db.exec(
      "INSERT INTO techniques (id, name, principle, instruction, level, created_at, updated_at, scope) VALUES ('t1', '技法', '原则', '指令', 'paragraph', 1, 1, 'adult')",
    )
    db.close()
    getDb(projectDir)
    expect(natureOf("n1")).toBe("adult")
    // 模拟协议层纠偏：用户把书改回 general
    const db2 = new Database(dbPath)
    db2.exec("UPDATE novels SET content_nature='general' WHERE id='n1'")
    db2.close()
    closeDb(projectDir)
    getDb(projectDir) // 再次建连，迁移不得再翻转
    expect(natureOf("n1")).toBe("general")
  })

  test("全局库（无 novels 表）跳过不报错", () => {
    const globalDir = join(tmpdir(), `novel-content-nature-global-${Date.now()}`)
    mkdirSync(join(globalDir, ".novel"), { recursive: true })
    const db = new Database(join(globalDir, ".novel", "novel.db"))
    db.exec("CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, scope text DEFAULT 'general' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL)")
    db.close()
    expect(() => getDb(globalDir)).not.toThrow()
    closeDb(globalDir)
    rmSync(globalDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
})

describe("getBookContentNature", () => {
  test("无 novel 行从紧回落 general", async () => {
    getDb(projectDir)
    expect(await getBookContentNature(projectDir)).toBe("general")
  })

  test("读列：adult 行判 adult，general 行判 general", async () => {
    getDb(projectDir) // 先建连补列
    const db = new Database(dbPath)
    db.exec("INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, content_nature) VALUES ('n1', '书一', '科幻', '', 1, 1, 'adult')")
    db.close()
    expect(await getBookContentNature(projectDir)).toBe("adult")
    await updateNovel("n1", { content_nature: "general" }, projectDir)
    expect(await getBookContentNature(projectDir)).toBe("general")
    await updateNovel("n1", { content_nature: "adult" }, projectDir)
    expect(await getBookContentNature(projectDir)).toBe("adult")
  })
})
