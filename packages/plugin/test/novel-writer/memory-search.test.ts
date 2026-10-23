import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { sql } from "drizzle-orm"

// agent-memory-system Wave 5：memory_search（FTS5 全文 + 结构化过滤 + limit 可配）
// 与 memory_lookup（实体全史：本体 + 记忆事实 + 章节引用）。

const originalCwd = process.cwd()
const testDir = join(tmpdir(), `novel-memory-search-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const NOVEL = "novel-search"

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
  process.chdir(testDir)
})

afterAll(() => {
  const { closeDb } = require("@opennovel-ai/novel-store")
  closeDb()
  delete process.env.OPENNOVEL_DB
  process.chdir(originalCwd)
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

beforeEach(async () => {
  const store = await import("../../src/novel-writer/session-store.js")
  const db = store.getDb(null, { fresh: true })
  db.delete(store.MemoryFactTable).run()
  db.run(sql`DELETE FROM memory_fact_fts`)
  db.delete(store.EntityRefTable).run()
  db.delete(store.CharacterStateTable).run()
  db.delete(store.CharacterTable).run()
  db.delete(store.WorldEntryTable).run()
  db.delete(store.ChapterTable).run()
  db.delete(store.NovelTable).run()
  db.insert(store.NovelTable).values({ id: NOVEL, title: "检索测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  for (let order = 1; order <= 4; order++) {
    db.insert(store.ChapterTable).values({
      id: `ch-${order}`, novel_id: NOVEL, title: `第${order}章`, content: "", word_count: 0, status: "draft", order,
    }).run()
  }

  const fact = (
    id: string,
    chapter: string | null,
    text: string,
    extra: { status?: string; entityHint?: string; quote?: string; factType?: string } = {},
  ) => {
    db.insert(store.MemoryFactTable).values({
      id, novel_id: NOVEL, chapter_id: chapter, fact_type: extra.factType ?? "timeline", text,
      status: extra.status ?? "approved", entity_hint: extra.entityHint ?? null, quote: extra.quote ?? null,
      created_at: 1, updated_at: 1,
    }).run()
    db.run(
      sql`INSERT INTO memory_fact_fts (novel_id, fact_id, text, quote) VALUES (${NOVEL}, ${id}, ${text}, ${extra.quote ?? ""})`,
    )
  }
  fact("fact-yintong-3", "ch-3", "银瞳症在雨夜首次发作", { entityHint: "we-yintong", quote: "她的瞳孔泛起银色" })
  fact("fact-yintong-1", "ch-1", "银瞳症被列为禁症", { status: "pending", entityHint: "we-yintong" })
  fact("fact-yintong-none", null, "银瞳症的古籍记载", { entityHint: "we-yintong" })
  fact("fact-other", "ch-2", "断魂崖决战开始", { factType: "plot" })
})

async function call() {
  const archive = await import("../../src/novel-writer/archive.js")
  return archive
}

describe("memory_search", () => {
  test("FTS 全文命中并按章节降序返回，默认 3 条", async () => {
    const archive = await call()
    const results = await archive.memorySearch(NOVEL, "银瞳症")
    expect(results.length).toBe(3)
    expect(results.map((r) => r.id)).toEqual(["fact-yintong-3", "fact-yintong-1", "fact-yintong-none"])
    expect(results[0].chapterOrder).toBe(3)
    expect(results[0].quote).toBe("她的瞳孔泛起银色")
    // 不相关事实不命中
    expect(results.map((r) => r.id)).not.toContain("fact-other")
  }, 60000)

  test("结构化过滤：status / chapter 范围 / limit 放宽", async () => {
    const archive = await call()
    const approvedOnly = await archive.memorySearch(NOVEL, "银瞳症", { status: "approved" })
    expect(approvedOnly.map((r) => r.id)).toEqual(["fact-yintong-3", "fact-yintong-none"])

    const ranged = await archive.memorySearch(NOVEL, "银瞳症", { chapterFrom: 2 })
    expect(ranged.map((r) => r.id)).toEqual(["fact-yintong-3"])

    const limited = await archive.memorySearch(NOVEL, "银瞳症", { limit: 1 })
    expect(limited.length).toBe(1)

    const missed = await archive.memorySearch(NOVEL, "不存在的词")
    expect(missed).toEqual([])
  }, 60000)
})

describe("memory_lookup", () => {
  test("实体全史：本体 + 记忆事实 + 章节引用合并", async () => {
    const store = await import("../../src/novel-writer/session-store.js")
    const db = store.getDb(null)
    db.insert(store.WorldEntryTable).values({
      id: "we-yintong", novel_id: NOVEL, category: "核心设定", title: "银瞳症", content: "罕见血脉病症", created_at: 1,
    }).run()
    db.insert(store.EntityRefTable).values({
      id: "ref-1", novel_id: NOVEL, source_type: "chapter", source_id: "ch-2",
      target_type: "world_entry", target_id: "we-yintong", ref_field: "content", ref_text: "银瞳症", created_at: 1,
    }).run()
    db.insert(store.EntityRefTable).values({
      id: "ref-2", novel_id: NOVEL, source_type: "chapter", source_id: "ch-3",
      target_type: "world_entry", target_id: "we-yintong", ref_field: "content", ref_text: "银瞳症", created_at: 1,
    }).run()

    const archive = await call()
    const history = await archive.memoryLookup(NOVEL, "we-yintong")
    expect(history).not.toBeNull()
    if (!history) return
    expect(history.kind).toBe("world_entry")
    expect(history.title).toBe("银瞳症")
    expect(history.facts.length).toBe(3)
    expect(history.facts[0].chapterOrder).toBe(3)
    expect(history.appearances.map((a) => a.chapterOrder)).toEqual([2, 3])
  }, 60000)

  test("角色实体合并状态记录章；未知实体返回 null", async () => {
    const store = await import("../../src/novel-writer/session-store.js")
    const db = store.getDb(null)
    db.insert(store.CharacterTable).values({ id: "char-lin", novel_id: NOVEL, name: "林天", role: "主角", description: "", created_at: 1 }).run()
    db.insert(store.CharacterStateTable).values({ id: "cs-a", character_id: "char-lin", chapter_id: "ch-1", active: 1 }).run()
    db.insert(store.CharacterStateTable).values({ id: "cs-b", character_id: "char-lin", chapter_id: "ch-4", active: 1 }).run()

    const archive = await call()
    const history = await archive.memoryLookup(NOVEL, "char-lin")
    expect(history?.kind).toBe("character")
    expect(history?.appearances.map((a) => a.chapterOrder)).toEqual([1, 4])
    expect(history?.appearances.every((a) => a.source === "character_state")).toBe(true)

    expect(await archive.memoryLookup(NOVEL, "entity-nowhere")).toBeNull()
  }, 60000)
})
