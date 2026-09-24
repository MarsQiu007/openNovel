import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import {
  closeDb,
  createAnnotation,
  createAnnotationRound,
  getDb,
  listAnnotationRounds,
  listAnnotations,
} from "../src/index.js"

// 统一模型之前的旧版 schema：两张批注表 + 两张执行轮次表（含 end_paragraph_index 与 execution_round_id 最终形态）
const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, outline text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE world_entries (id text PRIMARY KEY, novel_id text NOT NULL, category text DEFAULT '' NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE chapter_annotations (id text PRIMARY KEY, novel_id text NOT NULL, chapter_id text NOT NULL, parent_id text, source text DEFAULT 'user' NOT NULL, anchor_type text DEFAULT 'paragraph' NOT NULL, paragraph_index integer, start_offset integer, end_offset integer, end_paragraph_index integer, quote text DEFAULT '' NOT NULL, comment text DEFAULT '' NOT NULL, suggested_replacement text, status text DEFAULT 'open' NOT NULL, author_session_id text, execution_round_id text, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE TABLE world_entry_annotations (id text PRIMARY KEY, novel_id text NOT NULL, world_entry_id text NOT NULL, parent_id text, source text DEFAULT 'user' NOT NULL, anchor_type text DEFAULT 'paragraph' NOT NULL, paragraph_index integer, start_offset integer, end_offset integer, end_paragraph_index integer, quote text DEFAULT '' NOT NULL, comment text DEFAULT '' NOT NULL, suggested_replacement text, status text DEFAULT 'open' NOT NULL, author_session_id text, execution_round_id text, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE TABLE annotation_execution_rounds (id text PRIMARY KEY, novel_id text NOT NULL, chapter_id text NOT NULL, prompt_snapshot text DEFAULT '' NOT NULL, status text DEFAULT 'running' NOT NULL, annotations_snapshot text DEFAULT '[]' NOT NULL, result_summary text DEFAULT '' NOT NULL, chapter_version_id text, created_at integer NOT NULL);
CREATE TABLE world_entry_annotation_rounds (id text PRIMARY KEY, novel_id text NOT NULL, world_entry_id text NOT NULL, prompt_snapshot text DEFAULT '' NOT NULL, status text DEFAULT 'running' NOT NULL, annotations_snapshot text DEFAULT '[]' NOT NULL, result_summary text DEFAULT '' NOT NULL, content_history_id text, created_at integer NOT NULL);
`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `unified-annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function tableExists(table: string): boolean {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).all().length > 0
  } finally {
    db.close()
  }
}

function countRows(table: string): number {
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
    return row.c
  } finally {
    db.close()
  }
}

function seedLegacyDb() {
  const seed = new Database(dbPath)
  seed.exec(LEGACY_SCHEMA)
  seed
    .query("INSERT INTO novels (id, title, genre, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("novel-1", "测试小说", "玄幻", 1, 1)
  seed
    .query("INSERT INTO chapters (id, novel_id, title, \"order\", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("chapter-1", "novel-1", "第一章", 1, 1, 1)
  seed
    .query("INSERT INTO chapters (id, novel_id, title, \"order\", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("chapter-2", "novel-1", "第二章", 2, 1, 1)
  seed
    .query("INSERT INTO world_entries (id, novel_id, title, created_at) VALUES (?, ?, ?, ?)")
    .run("entry-1", "novel-1", "青云门", 1)
  // 正文跨段批注（关联轮次 aer-1）+ 另一章的单段批注 + 子回复批注（parent 链）
  seed
    .query(
      "INSERT INTO chapter_annotations (id, novel_id, chapter_id, source, anchor_type, paragraph_index, start_offset, end_offset, end_paragraph_index, quote, comment, status, execution_round_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("ca-1", "novel-1", "chapter-1", "user", "range", 2, 3, 10, 5, "跨段引用文本", "跨段批注", "applied", "aer-1", 1, 1)
  seed
    .query(
      "INSERT INTO chapter_annotations (id, novel_id, chapter_id, parent_id, source, anchor_type, paragraph_index, start_offset, end_offset, quote, comment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("ca-2", "novel-1", "chapter-1", "ca-1", "user", "range", 2, 3, 10, "跨段引用文本", "回复批注", "open", 2, 2)
  seed
    .query(
      "INSERT INTO chapter_annotations (id, novel_id, chapter_id, source, anchor_type, paragraph_index, start_offset, end_offset, quote, comment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("ca-3", "novel-1", "chapter-2", "ai", "range", 0, 0, 4, "第二章引用", "第二章批注", "open", 1, 1)
  seed
    .query(
      "INSERT INTO world_entry_annotations (id, novel_id, world_entry_id, source, anchor_type, paragraph_index, start_offset, end_offset, quote, comment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("wa-1", "novel-1", "entry-1", "user", "range", 1, 0, 5, "设定引用", "设定批注", "open", 1, 1)
  seed
    .query(
      "INSERT INTO annotation_execution_rounds (id, novel_id, chapter_id, prompt_snapshot, status, annotations_snapshot, result_summary, chapter_version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("aer-1", "novel-1", "chapter-1", "正文执行指令", "completed", "[{\"id\":\"ca-1\"}]", "已改 2 段", "cv-1", 1)
  seed
    .query(
      "INSERT INTO world_entry_annotation_rounds (id, novel_id, world_entry_id, prompt_snapshot, status, annotations_snapshot, result_summary, content_history_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("wear-1", "novel-1", "entry-1", "设定执行指令", "completed", "[{\"id\":\"wa-1\"}]", "已改设定", "dh-1", 1)
  seed.close()
}

describe("统一批注模型数据迁移", () => {
  test("遗留库的四张旧表数据完整搬入统一表", async () => {
    seedLegacyDb()
    getDb(projectDir)

    const chapterList = await listAnnotations({ targetType: "chapter", targetId: "chapter-1" }, projectDir)
    expect(chapterList).toHaveLength(2)
    const migrated = chapterList.find((row) => row.id === "ca-1")
    expect(migrated).toBeDefined()
    expect(migrated!.target_type).toBe("chapter")
    expect(migrated!.target_id).toBe("chapter-1")
    expect(migrated!.field).toBe("content")
    expect(migrated!.end_paragraph_index).toBe(5)
    expect(migrated!.status).toBe("applied")
    expect(migrated!.execution_round_id).toBe("aer-1")
    // parent 链保持
    const child = chapterList.find((row) => row.id === "ca-2")
    expect(child?.parent_id).toBe("ca-1")

    const entryList = await listAnnotations({ targetType: "world_entry", targetId: "entry-1" }, projectDir)
    expect(entryList).toHaveLength(1)
    expect(entryList[0].id).toBe("wa-1")
    expect(entryList[0].target_type).toBe("world_entry")
    expect(entryList[0].field).toBe("content")

    // 轮次迁移：结果引用统一到 result_ref_id
    const chapterRounds = await listAnnotationRounds({ targetType: "chapter", targetId: "chapter-1" }, projectDir)
    expect(chapterRounds).toHaveLength(1)
    expect(chapterRounds[0].id).toBe("aer-1")
    expect(chapterRounds[0].result_ref_id).toBe("cv-1")
    expect(chapterRounds[0].annotations_snapshot).toBe('[{"id":"ca-1"}]')

    const entryRounds = await listAnnotationRounds({ targetType: "world_entry", targetId: "entry-1" }, projectDir)
    expect(entryRounds).toHaveLength(1)
    expect(entryRounds[0].result_ref_id).toBe("dh-1")

    // 旧表物理保留（回滚保险），数据不被清除
    expect(tableExists("chapter_annotations")).toBe(true)
    expect(countRows("chapter_annotations")).toBe(3)
  }, 60000)

  test("重复打开迁移幂等，不产生重复数据", async () => {
    seedLegacyDb()
    getDb(projectDir)
    closeDb(projectDir)
    getDb(projectDir)
    closeDb(projectDir)
    getDb(projectDir)

    expect(countRows("annotations")).toBe(4)
    expect(countRows("annotation_rounds")).toBe(2)
  }, 60000)

  test("迁移后新批注只写入统一表", async () => {
    seedLegacyDb()
    getDb(projectDir)

    const created = await createAnnotation(
      { novelId: "novel-1", targetType: "chapter", targetId: "chapter-2", field: "content", quote: "新引用", comment: "新批注" },
      projectDir,
    )
    expect(created.target_type).toBe("chapter")
    expect(countRows("chapter_annotations")).toBe(3)
    expect(countRows("annotations")).toBe(5)

    const round = await createAnnotationRound(
      { novelId: "novel-1", targetType: "world_entry", targetId: "entry-1", promptSnapshot: "新轮次", annotationsSnapshot: "[]" },
      projectDir,
    )
    expect(round.id).toMatch(/^ar_/)
    expect(countRows("world_entry_annotation_rounds")).toBe(1)
    expect(countRows("annotation_rounds")).toBe(3)
  }, 60000)

  test("全新库只建统一表，不建旧表", () => {
    getDb(projectDir)
    expect(tableExists("annotations")).toBe(true)
    expect(tableExists("annotation_rounds")).toBe(true)
    expect(tableExists("chapter_annotations")).toBe(false)
    expect(tableExists("world_entry_annotations")).toBe(false)
    expect(tableExists("annotation_execution_rounds")).toBe(false)
    expect(tableExists("world_entry_annotation_rounds")).toBe(false)
  })
})
