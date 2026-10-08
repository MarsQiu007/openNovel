/**
 * toTechnique 编码契约回归：last_used_at = NULL（从未使用）的行不得输出显式
 * lastUsedAt: undefined（effect optional 允许缺省 key、拒绝显式 undefined），
 * 含该行在内的列表/详情输出必须能通过 Technique 协议契约解码。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { Option, Schema } from "effect"
import { Technique } from "@opennovel-ai/schema/technique"
import { closeDb, getTechnique, listTechniques } from "../src/index.js"

const TECHNIQUES_SCHEMA = `CREATE TABLE techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, scope text DEFAULT 'general' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);`

const CLEAN_EVIDENCE = JSON.stringify([{ sourceTitle: "书A", sourceLocation: "第1章", excerpt: "例句", annotation: "批注" }])

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `technique-encoding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = new Database(join(projectDir, ".novel", "novel.db"))
  db.exec(TECHNIQUES_SCHEMA)
  db.exec(
    `INSERT INTO techniques (id, name, principle, instruction, scene_types, level, evidence, common_misuse, confidence, status, scope, embedding, usage_count, last_used_at, created_at, updated_at) VALUES ` +
      `('tech-unused', '未使用技法', '原则', '在关键回应前插入沉默', '["dialogue"]', 'paragraph', '${CLEAN_EVIDENCE}', '', 0.5, 'unverified', 'general', NULL, 0, NULL, 1000, 1000),` +
      `('tech-used', '已使用技法', '原则', '用环境折射内心', '["description"]', 'paragraph', '${CLEAN_EVIDENCE}', '', 0.6, 'verified', 'general', NULL, 3, 2000, 1000, 2000)`,
  )
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

describe("toTechnique lastUsedAt 编码", () => {
  test("list：last_used_at NULL 行不携带显式 key，且整行通过 Technique 解码", async () => {
    const items = await listTechniques(projectDir)
    const unused = items.find((item) => item.id === "tech-unused")
    expect(unused).toBeDefined()
    expect(Object.hasOwn(unused, "lastUsedAt")).toBe(false)
    expect(Option.isSome(Schema.decodeUnknownOption(Technique)(unused))).toBe(true)
    for (const item of items) {
      expect(Option.isSome(Schema.decodeUnknownOption(Technique)(item))).toBe(true)
    }
  })

  test("detail：last_used_at NULL 行不携带显式 key，且通过 Technique 解码", async () => {
    const detail = await getTechnique("tech-unused", projectDir)
    expect(detail).not.toBeNull()
    expect(Object.hasOwn(detail.technique, "lastUsedAt")).toBe(false)
    expect(Option.isSome(Schema.decodeUnknownOption(Technique)(detail.technique))).toBe(true)
  })

  test("last_used_at 有值的行保留 lastUsedAt", async () => {
    const detail = await getTechnique("tech-used", projectDir)
    expect(detail.technique.lastUsedAt).toBe(2000)
  })
})