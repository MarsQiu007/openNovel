import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import {
  closeDb,
  createChapterAnnotation,
  createWorldEntryAnnotation,
  getDb,
  listChapterAnnotations,
  listWorldEntryAnnotations,
} from "../src/index.js"

// 旧版 schema：两张批注表均不含 end_paragraph_index 列
const LEGACY_SCHEMA = `
CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE world_entries (id text PRIMARY KEY, novel_id text NOT NULL, category text DEFAULT '' NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE chapter_annotations (id text PRIMARY KEY, novel_id text NOT NULL, chapter_id text NOT NULL, parent_id text, source text DEFAULT 'user' NOT NULL, anchor_type text DEFAULT 'paragraph' NOT NULL, paragraph_index integer, start_offset integer, end_offset integer, quote text DEFAULT '' NOT NULL, comment text DEFAULT '' NOT NULL, suggested_replacement text, status text DEFAULT 'open' NOT NULL, author_session_id text, execution_round_id text, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE, FOREIGN KEY (parent_id) REFERENCES chapter_annotations(id) ON DELETE CASCADE);
CREATE TABLE world_entry_annotations (id text PRIMARY KEY, novel_id text NOT NULL, world_entry_id text NOT NULL, parent_id text, source text DEFAULT 'user' NOT NULL, anchor_type text DEFAULT 'paragraph' NOT NULL, paragraph_index integer, start_offset integer, end_offset integer, quote text DEFAULT '' NOT NULL, comment text DEFAULT '' NOT NULL, suggested_replacement text, status text DEFAULT 'open' NOT NULL, author_session_id text, execution_round_id text, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (world_entry_id) REFERENCES world_entries(id) ON DELETE CASCADE);
`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `annotation-end-paragraph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function tableColumns(table: string): string[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query(`PRAGMA table_info(${table})`).all().map((row) => String(row.name))
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
    .query("INSERT INTO world_entries (id, novel_id, title, created_at) VALUES (?, ?, ?, ?)")
    .run("entry-1", "novel-1", "青云门", 1)
  seed
    .query(
      "INSERT INTO chapter_annotations (id, novel_id, chapter_id, paragraph_index, start_offset, end_offset, quote, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("ca-legacy", "novel-1", "chapter-1", 2, 3, 10, "旧批注引用", "旧批注评论", 1, 1)
  seed
    .query(
      "INSERT INTO world_entry_annotations (id, novel_id, world_entry_id, paragraph_index, start_offset, end_offset, quote, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("wa-legacy", "novel-1", "entry-1", 1, 0, 5, "旧设定批注", "旧评论", 1, 1)
  seed.close()
}

describe("批注表 end_paragraph_index 迁移", () => {
  test("遗留库自动补列，旧数据可读且 end_paragraph_index 为空", async () => {
    seedLegacyDb()

    expect(tableColumns("chapter_annotations")).not.toContain("end_paragraph_index")
    expect(tableColumns("world_entry_annotations")).not.toContain("end_paragraph_index")

    getDb(projectDir)

    expect(tableColumns("chapter_annotations")).toContain("end_paragraph_index")
    expect(tableColumns("world_entry_annotations")).toContain("end_paragraph_index")

    const chapterRows = await listChapterAnnotations("chapter-1", projectDir)
    expect(chapterRows).toHaveLength(1)
    expect(chapterRows[0].id).toBe("ca-legacy")
    expect(chapterRows[0].end_paragraph_index).toBeNull()

    const entryRows = await listWorldEntryAnnotations("entry-1", projectDir)
    expect(entryRows).toHaveLength(1)
    expect(entryRows[0].id).toBe("wa-legacy")
    expect(entryRows[0].end_paragraph_index).toBeNull()
  }, 60000)

  test("迁移后支持写入跨段批注并持久化 end_paragraph_index", async () => {
    seedLegacyDb()
    getDb(projectDir)

    const created = await createChapterAnnotation(
      "chapter-1",
      "novel-1",
      {
        anchorType: "range",
        paragraphIndex: 0,
        startOffset: 2,
        endOffset: 4,
        endParagraphIndex: 3,
        quote: "跨段引用",
        comment: "跨段批注",
      },
      projectDir,
    )
    expect(created.end_paragraph_index).toBe(3)

    const entryCreated = await createWorldEntryAnnotation(
      "entry-1",
      "novel-1",
      { anchorType: "range", paragraphIndex: 1, startOffset: 0, endOffset: 6, endParagraphIndex: 2, quote: "设定跨段", comment: "设定批注" },
      projectDir,
    )
    expect(entryCreated.end_paragraph_index).toBe(2)

    // 重开数据库后仍可读取，迁移幂等不会重复加列
    closeDb(projectDir)
    getDb(projectDir)

    const chapterRows = await listChapterAnnotations("chapter-1", projectDir)
    const target = chapterRows.find((row) => row.id === created.id)
    expect(target?.end_paragraph_index).toBe(3)
    expect(target?.end_offset).toBe(4)

    const entryRows = await listWorldEntryAnnotations("entry-1", projectDir)
    expect(entryRows.find((row) => row.id === entryCreated.id)?.end_paragraph_index).toBe(2)
  }, 60000)

  test("新建库的批注表直接包含 end_paragraph_index 列", () => {
    getDb(projectDir)
    expect(tableColumns("chapter_annotations")).toContain("end_paragraph_index")
    expect(tableColumns("world_entry_annotations")).toContain("end_paragraph_index")
  })
})
