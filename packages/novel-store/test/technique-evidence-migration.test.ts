/**
 * migrateTechniqueEvidence 回归：证据条目缺失（含 null/非字符串值）的字符串字段
 * 按规则回填（sourceTitle 取 sourceLocation、其余补空串），重复执行零写入，
 * 已有非空字段不被改写；非对象元素保持原样。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { closeDb, getDb } from "../src/index.js"

const TECHNIQUES_SCHEMA = `CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, scope text DEFAULT 'general' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);`

let projectDir: string
let dbPath: string

beforeEach(() => {
  projectDir = join(tmpdir(), `technique-evidence-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  dbPath = join(projectDir, ".novel", "novel.db")
  const db = new Database(dbPath)
  db.exec(TECHNIQUES_SCHEMA)
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

function evidenceOf(id: string): string {
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db.query("SELECT evidence FROM techniques WHERE id = ?").get(id)
    if (typeof row !== "object" || row === null || !("evidence" in row)) throw new Error("缺少 evidence 列")
    return String(row.evidence)
  } finally {
    db.close()
  }
}

function insertTechnique(id: string, evidence: string): void {
  const db = new Database(dbPath)
  try {
    db.prepare(
      "INSERT INTO techniques (id, name, principle, instruction, scene_types, level, evidence, common_misuse, confidence, status, scope, usage_count, created_at, updated_at) VALUES (?, ?, '', '在关键回应前插入沉默', '[\"dialogue\"]', 'paragraph', ?, '', 0.5, 'unverified', 'general', 0, 1, 1)",
    ).run(id, `技法-${id}`, evidence)
  } finally {
    db.close()
  }
}

describe("migrateTechniqueEvidence", () => {
  test("缺失 sourceTitle 的行按 sourceLocation 回填，null 字段补空串", () => {
    insertTechnique("t-missing", JSON.stringify([{ sourceLocation: "第1章", excerpt: "例句", annotation: "批注" }]))
    insertTechnique(
      "t-null",
      JSON.stringify([{ sourceTitle: null, sourceLocation: "第2章", excerpt: "例句", annotation: "批注" }]),
    )
    getDb(projectDir)

    expect(JSON.parse(evidenceOf("t-missing"))).toEqual([
      { sourceTitle: "第1章", sourceLocation: "第1章", excerpt: "例句", annotation: "批注" },
    ])
    expect(JSON.parse(evidenceOf("t-null"))).toEqual([
      { sourceTitle: "第2章", sourceLocation: "第2章", excerpt: "例句", annotation: "批注" },
    ])
  })

  test("非对象元素保持原样，同数组内的对象元素仍被补全", () => {
    insertTechnique(
      "t-mixed",
      JSON.stringify(["坏元素", { sourceLocation: "第3章", excerpt: "例句", annotation: "批注" }]),
    )
    getDb(projectDir)

    expect(JSON.parse(evidenceOf("t-mixed"))).toEqual([
      "坏元素",
      { sourceTitle: "第3章", sourceLocation: "第3章", excerpt: "例句", annotation: "批注" },
    ])
  })

  test("已有非空字段不被改写，合法行经重复建连零写入", () => {
    const clean = JSON.stringify([{ sourceTitle: "原书名", sourceLocation: "第4章", excerpt: "例句", annotation: "批注" }])
    insertTechnique("t-clean", clean)
    getDb(projectDir)
    expect(evidenceOf("t-clean")).toBe(clean)

    // 再次建连（先驱逐缓存连接）：迁移为纯 no-op，行内容逐字节不变
    closeDb(projectDir)
    getDb(projectDir)
    expect(evidenceOf("t-clean")).toBe(clean)
  })

  test("重复建连时已被修复的行不再二次写入", () => {
    const dirty = JSON.stringify([{ sourceLocation: "第5章", excerpt: "例句", annotation: "批注" }])
    insertTechnique("t-once", dirty)
    getDb(projectDir)
    const fixed = evidenceOf("t-once")
    expect(JSON.parse(fixed)).toEqual([{ sourceTitle: "第5章", sourceLocation: "第5章", excerpt: "例句", annotation: "批注" }])

    closeDb(projectDir)
    getDb(projectDir)
    expect(evidenceOf("t-once")).toBe(fixed)
  })
})