import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"

const testDir = join(tmpdir(), `novel-recall-${Date.now()}`)
const dbPath = join(testDir, "test.db")

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
})

afterAll(() => {
  delete process.env.OPENNOVEL_DB
  const { closeDb } = require("@opennovel-ai/novel-store")
  closeDb()
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

const NOVEL = "novel-recall"

async function setupDb() {
  const {
    getDb,
    NovelTable,
    ChapterTable,
    CharacterTable,
    WorldEntryTable,
    PlotThreadTable,
    ForeshadowingTable,
    ChapterSummaryTable,
    EntityRefTable,
  } = await import("../../src/novel-writer/session-store.js")
  const db = getDb()
  // Clean slate
  db.delete(EntityRefTable).run()
  db.delete(ChapterSummaryTable).run()
  db.delete(ForeshadowingTable).run()
  db.delete(PlotThreadTable).run()
  db.delete(WorldEntryTable).run()
  db.delete(CharacterTable).run()
  db.delete(ChapterTable).run()
  db.delete(NovelTable).run()
  db.run("DELETE FROM chapter_summary_fts")

  db.insert(NovelTable).values({ id: NOVEL, title: "recall-test", genre: "玄幻", synopsis: "test", status: "draft" }).run()
  return db
}

describe("extractMentionedEntities", () => {
  test("finds character names and world entry titles in outline", async () => {
    const db = await setupDb()
    const { CharacterTable, WorldEntryTable } = await import("../../src/novel-writer/session-store.js")
    db.insert(CharacterTable).values([
      { id: "c1", novel_id: NOVEL, name: "陆沉", role: "主角", description: "", status: "active" },
      { id: "c2", novel_id: NOVEL, name: "苏婉", role: "配角", description: "", status: "active" },
    ]).run()
    db.insert(WorldEntryTable).values([
      { id: "w1", novel_id: NOVEL, category: "力量", title: "金丹期", content: "境界" },
      { id: "w2", novel_id: NOVEL, category: "地理", title: "天剑山", content: "门派" },
    ]).run()

    const { extractMentionedEntities } = await import("../../src/novel-writer/recall.js")
    const mentioned = await extractMentionedEntities(db, NOVEL, "陆沉在金丹期突破后，前往天剑山寻找苏婉")
    expect(mentioned.characterIds).toContain("c1")
    expect(mentioned.characterIds).toContain("c2")
    expect(mentioned.worldEntryIds).toContain("w1")
    expect(mentioned.worldEntryIds).toContain("w2")
  })
})

describe("runRecall", () => {
  test("entity overlap recalls historical chapters referencing same entities", async () => {
    const db = await setupDb()
    const {
      CharacterTable,
      ChapterTable,
      ChapterSummaryTable,
      EntityRefTable,
    } = await import("../../src/novel-writer/session-store.js")
    const { runRecall, extractMentionedEntities } = await import("../../src/novel-writer/recall.js")

    db.insert(CharacterTable).values([
      { id: "c1", novel_id: NOVEL, name: "陆沉", role: "主角", description: "", status: "active" },
    ]).run()

    // Chapter 1 (old, references Lu Chen)
    db.insert(ChapterTable).values({
      id: "ch1", novel_id: NOVEL, title: "第一章", content: "陆沉出场", word_count: 100, status: "final", order: 1,
    }).run()
    db.insert(ChapterSummaryTable).values({
      id: "cs1", chapter_id: "ch1", summary: "陆沉觉醒", key_events: ["觉醒"], char_changes: [],
    }).run()
    db.insert(EntityRefTable).values({
      id: "ref1", novel_id: NOVEL, source_type: "chapter", source_id: "ch1",
      target_type: "character", target_id: "c1", ref_field: "content", ref_text: "陆沉",
    }).run()

    // Recent chapters 2,3,4 (already in P2, should be excluded)
    for (let i = 2; i <= 4; i++) {
      const cid = `ch${i}`
      db.insert(ChapterTable).values({
        id: cid, novel_id: NOVEL, title: `第${i}章`, content: "近期", word_count: 100, status: "final", order: i,
      }).run()
      db.insert(ChapterSummaryTable).values({
        id: `cs${i}`, chapter_id: cid, summary: `第${i}章摘要`, key_events: [], char_changes: [],
      }).run()
    }

    const mentioned = await extractMentionedEntities(db, NOVEL, "陆沉继续修炼")
    const recentOrders = new Set([2, 3, 4])
    const results = await runRecall(db, NOVEL, 5, mentioned, recentOrders, 7)

    expect(results.length).toBeGreaterThan(0)
    const ch1Result = results.find((r) => r.chapterOrder === 1)
    expect(ch1Result).toBeDefined()
    expect(ch1Result!.matchedBy).toBe("entity")
    expect(ch1Result!.matchedEntities).toContain("陆沉")
  })

  test("foreshadow forced recall brings back planting chapter", async () => {
    const db = await setupDb()
    const {
      ForeshadowingTable,
      ChapterTable,
      ChapterSummaryTable,
    } = await import("../../src/novel-writer/session-store.js")
    const { runRecall, extractMentionedEntities } = await import("../../src/novel-writer/recall.js")

    db.insert(ChapterTable).values({
      id: "ch1", novel_id: NOVEL, title: "第一章", content: "x", word_count: 1, status: "final", order: 1,
    }).run()
    db.insert(ChapterSummaryTable).values({
      id: "cs1", chapter_id: "ch1", summary: "埋下玉佩伏笔", key_events: [], char_changes: [],
    }).run()
    db.insert(ForeshadowingTable).values({
      id: "f1", novel_id: NOVEL, planted_chapter_id: "ch1", content: "神秘玉佩", state: "planted",
    }).run()

    const mentioned = await extractMentionedEntities(db, NOVEL, "神秘玉佩的力量觉醒")
    const results = await runRecall(db, NOVEL, 10, mentioned, new Set([8, 9, 10]), 7)
    const f1Result = results.find((r) => r.chapterOrder === 1)
    expect(f1Result).toBeDefined()
    expect(f1Result!.matchedBy).toBe("foreshadow")
  })
})

describe("selectRelevantWorldEntries", () => {
  test("outline-mentioned entries go to core, rest to index", async () => {
    const db = await setupDb()
    const { WorldEntryTable } = await import("../../src/novel-writer/session-store.js")
    const { selectRelevantWorldEntries } = await import("../../src/novel-writer/recall.js")

    db.insert(WorldEntryTable).values([
      { id: "w1", novel_id: NOVEL, category: "力量", title: "金丹期", content: "金丹期境界..." },
      { id: "w2", novel_id: NOVEL, category: "地理", title: "天剑山", content: "天剑山..." },
      { id: "w3", novel_id: NOVEL, category: "势力", title: "魔宗", content: "魔宗..." },
    ]).run()

    const all = [
      { id: "w1", category: "力量", title: "金丹期", content: "金丹期境界..." },
      { id: "w2", category: "地理", title: "天剑山", content: "天剑山..." },
      { id: "w3", category: "势力", title: "魔宗", content: "魔宗..." },
    ]

    const { core, index } = await selectRelevantWorldEntries(db, NOVEL, all, "陆沉突破金丹期", [], [])
    expect(core.map((e) => e.id)).toContain("w1")
    expect(index.map((e) => e.title)).toContain("魔宗")
  })
})

describe("recallByQuery", () => {
  test("FTS finds chapter summary by phrase", async () => {
    const db = await setupDb()
    const { ChapterTable, ChapterSummaryTable } = await import("../../src/novel-writer/session-store.js")
    const { recallByQuery } = await import("../../src/novel-writer/recall.js")

    db.insert(ChapterTable).values({
      id: "ch5", novel_id: NOVEL, title: "第五章", content: "陆沉在黑市拍卖获得残缺功法", word_count: 100, status: "final", order: 5,
    }).run()
    db.insert(ChapterSummaryTable).values({
      id: "cs5", chapter_id: "ch5", summary: "陆沉在黑市拍卖获得残缺功法", key_events: ["黑市拍卖"], char_changes: [],
    }).run()
    // Sync FTS
    const { sql } = await import("drizzle-orm")
    db.run(sql`INSERT INTO chapter_summary_fts (novel_id, chapter_id, chapter_order, title, body) VALUES (${NOVEL}, ${"ch5"}, ${5}, ${"第五章"}, ${"陆沉在黑市拍卖获得残缺功法 黑市拍卖"})`)

    const results = await recallByQuery(db, NOVEL, "黑市拍卖", 5, "summary")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chapterNumber).toBe(5)
  })
})