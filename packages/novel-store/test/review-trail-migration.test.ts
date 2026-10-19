import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { closeDb, getDb, NovelTable, StagedChangeTable } from "../src/index.js"

// setting-review-hub：审阅留痕列迁移 + staged_changes 新表。
// 新库由 CREATE_TABLES_SQL 直建带新列；旧库由 migrateReviewTrail 幂等补列。

const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pending_settings (id text PRIMARY KEY, novel_id text NOT NULL, candidate_type text NOT NULL, source_chapter_id text, suggested_entity_id text DEFAULT '' NOT NULL, payload_json text DEFAULT '{}' NOT NULL, importance integer DEFAULT 1 NOT NULL, type_strength text DEFAULT '' NOT NULL, display_title text DEFAULT '' NOT NULL, status text DEFAULT 'pending' NOT NULL, merged_into text DEFAULT '' NOT NULL, created_at integer NOT NULL, resolved_at integer, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (source_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS world_entry_conflicts (id text PRIMARY KEY, novel_id text NOT NULL, world_entry_id text NOT NULL, conflict_kind text DEFAULT 'semantic_conflict' NOT NULL, source text DEFAULT 'observer' NOT NULL, source_chapter_id text, conflict_note text DEFAULT '' NOT NULL, resolved integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (source_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `review-trail-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function columns(table: string): Array<{ name: string; dflt_value: unknown }> {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; dflt_value: unknown }>
  } finally {
    db.close()
  }
}

function hasColumn(table: string, column: string): boolean {
  return columns(table).some((c) => c.name === column)
}

describe("审阅留痕列与暂存变更表", () => {
  test("旧库打开幂等补齐留痕列，旧数据可读", async () => {
    const seed = new Database(dbPath)
    seed.exec(LEGACY_SCHEMA)
    seed
      .query("INSERT INTO novels (id, title, genre, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("novel-1", "测试小说", "玄幻", 1, 1)
    seed
      .query(
        "INSERT INTO pending_settings (id, novel_id, candidate_type, display_title, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("ps-1", "novel-1", "character", "林天", 1)
    seed
      .query(
        "INSERT INTO world_entry_conflicts (id, novel_id, world_entry_id, conflict_note, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("wc-1", "novel-1", "world-1", "东西边界数字不一致", 1)
    seed.close()

    expect(hasColumn("pending_settings", "review_note")).toBe(false)
    expect(hasColumn("world_entry_conflicts", "resolution_kind")).toBe(false)

    getDb(projectDir)

    expect(hasColumn("pending_settings", "review_note")).toBe(true)
    expect(hasColumn("world_entry_conflicts", "resolution_kind")).toBe(true)
    expect(hasColumn("world_entry_conflicts", "resolution_note")).toBe(true)
    expect(hasColumn("world_entry_conflicts", "resolved_at")).toBe(true)

    // 重复打开：幂等 no-op
    closeDb(projectDir)
    getDb(projectDir)
    expect(hasColumn("pending_settings", "review_note")).toBe(true)

    // 旧行以安全默认可读
    const db = new Database(dbPath, { readonly: true })
    try {
      const ps = db.query("SELECT review_note FROM pending_settings WHERE id = 'ps-1'").get() as {
        review_note: string
      }
      expect(ps.review_note).toBe("")
      const wc = db.query("SELECT resolution_kind, resolution_note, resolved_at FROM world_entry_conflicts WHERE id = 'wc-1'").get() as {
        resolution_kind: string
        resolution_note: string
        resolved_at: number | null
      }
      expect(wc.resolution_kind).toBe("")
      expect(wc.resolution_note).toBe("")
      expect(wc.resolved_at).toBeNull()
    } finally {
      db.close()
    }
  }, 60000)

  test("新库直建 staged_changes 表且默认值正确", async () => {
    const db = getDb(projectDir)
    await db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "测试小说", genre: "玄幻", created_at: 1, updated_at: 1 })
    await db.insert(StagedChangeTable).values({ id: "sc-1", novel_id: "novel-1", kind: "update" })
    closeDb(projectDir)

    const raw = new Database(dbPath, { readonly: true })
    try {
      const row = raw.query("SELECT * FROM staged_changes WHERE id = 'sc-1'").get() as Record<string, unknown>
      expect(row.source).toBe("agent")
      expect(row.kind).toBe("update")
      expect(row.entity_type).toBe("world_entry")
      expect(row.entry_ids).toBe("[]")
      expect(row.before_json).toBe("{}")
      expect(row.after_json).toBe("{}")
      expect(row.reason).toBe("")
      expect(row.evidence_json).toBe("{}")
      expect(row.status).toBe("pending")
      expect(row.review_note).toBe("")
      expect(row.resolved_at).toBeNull()
      expect(typeof row.created_at).toBe("number")
    } finally {
      raw.close()
    }
  }, 60000)
})
