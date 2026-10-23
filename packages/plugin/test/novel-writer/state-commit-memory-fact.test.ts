import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, sql } from "drizzle-orm"

// agent-memory-system Wave 3：timeline delta 落 memory_fact（替换日志-only 分支），
// 实体事实仍走既有表不重复存储；重跑章节幂等、已校准行不回退。

const originalCwd = process.cwd()
const testDir = join(tmpdir(), `novel-memory-fact-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const NOVEL = "novel-memory-fact"
const CHAPTER = "chapter-memory"

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

async function seedNovel() {
  const { getDb, NovelTable, ChapterTable, MemoryFactTable, CharacterTable } = await import(
    "../../src/novel-writer/session-store.js"
  )
  const db = getDb(null, { fresh: true })
  db.delete(MemoryFactTable).run()
  db.run(sql`DELETE FROM memory_fact_fts`)
  db.delete(CharacterTable).run()
  db.delete(ChapterTable).run()
  db.delete(NovelTable).run()
  db.insert(NovelTable).values({
    id: NOVEL,
    title: "记忆事实测试",
    genre: "玄幻",
    synopsis: "",
    status: "draft",
  }).run()
  db.insert(ChapterTable).values({
    id: CHAPTER,
    novel_id: NOVEL,
    title: "第一章",
    content: "",
    word_count: 0,
    status: "draft",
    order: 1,
  }).run()
  return db
}

beforeEach(() => seedNovel())

const timelineDelta = [
  {
    fact_type: "timeline" as const,
    action: "create" as const,
    entity_id: "time_duanhunya",
    data: {
      event: "林天抵达断魂崖",
      timestamp: "三日后黄昏",
      relative_order: 3,
      quote: "黄昏时分，断魂崖出现在地平线上",
      quote_span: "p12",
    },
  },
]

describe("commitState memory_fact 落库", () => {
  test("timeline delta 落 memory_fact（pending/observer/出处），FTS 可检索", async () => {
    const db = await seedNovel()
    const { MemoryFactTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    await commitState(NOVEL, CHAPTER, timelineDelta)

    const facts = db.select().from(MemoryFactTable).all()
    expect(facts.length).toBe(1)
    const fact = facts[0]
    expect(fact.fact_type).toBe("timeline")
    expect(fact.text).toBe("[三日后黄昏] 林天抵达断魂崖")
    expect(fact.status).toBe("pending")
    expect(fact.created_by).toBe("observer")
    expect(fact.chapter_id).toBe(CHAPTER)
    expect(fact.quote).toBe("黄昏时分，断魂崖出现在地平线上")
    expect(fact.quote_span).toBe("p12")
    expect(fact.entity_hint).toBe("time_duanhunya")

    const hits = db
      .all(sql`SELECT fact_id FROM memory_fact_fts WHERE memory_fact_fts MATCH '断魂崖'`)
      .map((row) => (typeof row === "object" && row !== null && "fact_id" in row ? String(row.fact_id) : ""))
    expect(hits).toEqual([fact.id])
  }, 60000)

  test("重跑章节幂等替换 pending 事实，已 reviewed 行保留不回退", async () => {
    const db = await seedNovel()
    const { MemoryFactTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    await commitState(NOVEL, CHAPTER, timelineDelta)
    await commitState(NOVEL, CHAPTER, timelineDelta)
    expect(db.select().from(MemoryFactTable).all().length).toBe(1)

    // 审计校准后重跑：reviewed 行不被清理，新提取的 pending 行并存
    const first = db.select().from(MemoryFactTable).all()[0]
    db.update(MemoryFactTable).set({ status: "reviewed" }).where(eq(MemoryFactTable.id, first.id)).run()
    await commitState(NOVEL, CHAPTER, timelineDelta)
    const after = db.select().from(MemoryFactTable).all()
    expect(after.length).toBe(2)
    expect(after.filter((f) => f.status === "reviewed").length).toBe(1)
    expect(after.filter((f) => f.status === "pending").length).toBe(1)
  }, 60000)

  test("实体事实仍走既有表，不重复写入 memory_fact", async () => {
    const db = await seedNovel()
    const { CharacterTable, MemoryFactTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    await commitState(NOVEL, CHAPTER, [
      {
        fact_type: "character",
        action: "create",
        entity_id: "char_lintian",
        data: { name: "林天", role: "主角", description: "十六岁少年", importance: 3 },
      },
    ])

    const chars = db.select().from(CharacterTable).all()
    expect(chars.length).toBe(1)
    expect(chars[0].name).toBe("林天")
    expect(db.select().from(MemoryFactTable).all().length).toBe(0)
  }, 60000)
})
