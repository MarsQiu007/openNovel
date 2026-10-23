import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import {
  ChapterTable,
  closeDb,
  closeDbPath,
  getDb,
  getGlobalDb,
  MemoryFactTable,
  MemoryInjectionSnapshotTable,
  NovelTable,
} from "../src/index.js"

// agent-memory-system Wave 1：memory_fact / memory_injection_snapshot 新表 + 落文状态/技巧扩展列迁移。
// 新库由 CREATE_TABLES_SQL 直建；旧库由 migrateMemoryColumns 幂等补列。

const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, status text DEFAULT 'active' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE world_entries (id text PRIMARY KEY, novel_id text NOT NULL, category text DEFAULT '' NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, scope text DEFAULT 'general' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);
`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `memory-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  dbPath = join(projectDir, ".novel", "novel.db")
})

afterEach(() => {
  closeDb(projectDir)
  closeDbPath(join(projectDir, ".novel", "techniques.db"))
  delete process.env.OPENNOVEL_TECHNIQUE_DB
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function columns(table: string, path = dbPath): Array<{ name: string; dflt_value: unknown }> {
  const db = new Database(path, { readonly: true })
  try {
    return db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; dflt_value: unknown }>
  } finally {
    db.close()
  }
}

function hasColumn(table: string, column: string, path = dbPath): boolean {
  return columns(table, path).some((c) => c.name === column)
}

function tableExists(name: string, path = dbPath): boolean {
  const db = new Database(path, { readonly: true })
  try {
    const row = db.query("SELECT name FROM sqlite_master WHERE name = ?").get(name)
    return row !== null
  } finally {
    db.close()
  }
}

describe("记忆系统数据层", () => {
  test("旧库打开幂等补齐落文状态与技巧扩展列，存量行默认 established", async () => {
    const seed = new Database(dbPath)
    seed.exec(LEGACY_SCHEMA)
    seed
      .query("INSERT INTO novels (id, title, genre, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("novel-1", "测试小说", "玄幻", 1, 1)
    seed
      .query("INSERT INTO characters (id, novel_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run("char-1", "novel-1", "林天", 1)
    seed
      .query("INSERT INTO world_entries (id, novel_id, title, created_at) VALUES (?, ?, ?, ?)")
      .run("we-1", "novel-1", "银瞳症", 1)
    seed
      .query("INSERT INTO techniques (id, name, principle, instruction, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("tech-1", "断章悬念", "p", "i", "scene", 1, 1)
    seed.close()

    expect(hasColumn("characters", "establishment")).toBe(false)
    expect(hasColumn("techniques", "usage_ledger")).toBe(false)
    expect(tableExists("memory_fact")).toBe(false)

    getDb(projectDir)

    for (const table of ["characters", "world_entries"]) {
      expect(hasColumn(table, "establishment")).toBe(true)
      expect(hasColumn(table, "established_chapter_id")).toBe(true)
    }
    expect(hasColumn("techniques", "usage_ledger")).toBe(true)
    expect(hasColumn("techniques", "promoted_from")).toBe(true)
    expect(hasColumn("techniques", "novel_id")).toBe(true)
    // 冲突单扩展列（Wave 7）：旧库无此表时由 CREATE_TABLES_SQL 带新列直建
    expect(hasColumn("world_entry_conflicts", "opposing_fact_id")).toBe(true)
    expect(hasColumn("world_entry_conflicts", "impact_json")).toBe(true)
    expect(tableExists("memory_fact")).toBe(true)
    expect(tableExists("memory_fact_fts")).toBe(true)
    expect(tableExists("memory_injection_snapshot")).toBe(true)

    // 重复打开：幂等 no-op
    closeDb(projectDir)
    getDb(projectDir)
    expect(hasColumn("characters", "establishment")).toBe(true)

    // 存量行以安全默认可读：established（提取自已写正文，误标 planned 会永久滞留提醒）
    const db = new Database(dbPath, { readonly: true })
    try {
      const char = db.query("SELECT establishment, established_chapter_id FROM characters WHERE id = 'char-1'").get() as {
        establishment: string
        established_chapter_id: string | null
      }
      expect(char.establishment).toBe("established")
      expect(char.established_chapter_id).toBeNull()
      const tech = db.query("SELECT usage_ledger, promoted_from, novel_id FROM techniques WHERE id = 'tech-1'").get() as {
        usage_ledger: string
        promoted_from: string | null
        novel_id: string | null
      }
      expect(tech.usage_ledger).toBe("[]")
      expect(tech.promoted_from).toBeNull()
      expect(tech.novel_id).toBeNull()
    } finally {
      db.close()
    }
  }, 60000)

  test("新库直建 memory_fact / 注入快照，默认值与 FTS 回填正确", async () => {
    const db = getDb(projectDir)
    await db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "测试小说", genre: "玄幻", created_at: 1, updated_at: 1 })
    await db
      .insert(ChapterTable)
      .values({ id: "ch-2", novel_id: "novel-1", title: "第二章", order: 2, created_at: 1, updated_at: 1 })
    await db.insert(MemoryFactTable).values({
      id: "fact-1",
      novel_id: "novel-1",
      chapter_id: "ch-2",
      fact_type: "timeline",
      text: "第三日黄昏，林天抵达断魂崖",
      quote: "黄昏时分，断魂崖出现在地平线上",
    })
    await db.insert(MemoryInjectionSnapshotTable).values({
      novel_id: "novel-1",
      chapter_id: "ch-2",
      payload: '{"characters":[]}',
    })
    closeDb(projectDir)

    const raw = new Database(dbPath)
    try {
      const fact = raw.query("SELECT * FROM memory_fact WHERE id = 'fact-1'").get() as Record<string, unknown>
      expect(fact.status).toBe("pending")
      expect(fact.confidence).toBe(50)
      expect(fact.proof_count).toBe(1)
      expect(fact.created_by).toBe("observer")
      expect(fact.chapter_id).toBe("ch-2")

      const snapshot = raw
        .query("SELECT * FROM memory_injection_snapshot WHERE novel_id = 'novel-1' AND chapter_id = 'ch-2'")
        .get() as Record<string, unknown>
      expect(snapshot.budget_used).toBe(0)
      expect(typeof snapshot.built_at).toBe("number")

      // FTS 同步走应用级（写入点显式 delete+insert）；此处验证虚表可用且回填语句幂等
      raw.exec(`INSERT INTO memory_fact_fts(novel_id, fact_id, text, quote)
        SELECT f.novel_id, f.id, f.text, COALESCE(f.quote, '') FROM memory_fact f
        WHERE NOT EXISTS (SELECT 1 FROM memory_fact_fts t WHERE t.fact_id = f.id)`)
      const hits = raw.query("SELECT fact_id FROM memory_fact_fts WHERE memory_fact_fts MATCH '断魂崖'").all() as Array<{
        fact_id: string
      }>
      expect(hits.map((h) => h.fact_id)).toEqual(["fact-1"])
    } finally {
      raw.close()
    }
  }, 60000)

  test("全局技法库同构补齐三列，novel_id 恒 NULL", () => {
    const globalPath = join(projectDir, ".novel", "techniques.db")
    process.env.OPENNOVEL_TECHNIQUE_DB = globalPath
    const seed = new Database(globalPath)
    seed.exec(
      "CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, scope text DEFAULT 'general' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL)",
    )
    seed
      .query("INSERT INTO techniques (id, name, principle, instruction, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("g-1", "视角切换", "p", "i", "book", 1, 1)
    seed.close()

    expect(hasColumn("techniques", "usage_ledger", globalPath)).toBe(false)

    getGlobalDb()
    closeDbPath(globalPath)

    expect(hasColumn("techniques", "usage_ledger", globalPath)).toBe(true)
    expect(hasColumn("techniques", "promoted_from", globalPath)).toBe(true)
    expect(hasColumn("techniques", "novel_id", globalPath)).toBe(true)
    const raw = new Database(globalPath, { readonly: true })
    try {
      const row = raw.query("SELECT usage_ledger, novel_id FROM techniques WHERE id = 'g-1'").get() as {
        usage_ledger: string
        novel_id: string | null
      }
      expect(row.usage_ledger).toBe("[]")
      expect(row.novel_id).toBeNull()
    } finally {
      raw.close()
    }
  }, 60000)
})
