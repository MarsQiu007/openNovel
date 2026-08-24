import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, sql } from "drizzle-orm"

const originalCwd = process.cwd()
const testDir = join(tmpdir(), `novel-state-commit-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const NOVEL = "novel-state-commit"
const CHAPTER = "chapter-state"

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
  process.chdir(testDir)
})

afterAll(() => {
  delete process.env.OPENNOVEL_DB
  const { closeDb } = require("@opennovel-ai/novel-store")
  closeDb()
  process.chdir(originalCwd)
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

async function resetDb() {
  const {
    getDb,
    NovelTable,
    ChapterTable,
    ChapterSummaryTable,
    CharacterTable,
    WorldEntryTable,
    PendingSettingTable,
    WorldEntryConflictTable,
    NovelStateLogTable,
  } = await import("../../src/novel-writer/session-store.js")
  const db = getDb(null, { fresh: true })
  db.delete(WorldEntryConflictTable).run()
  db.delete(PendingSettingTable).run()
  db.delete(ChapterSummaryTable).run()
  db.delete(NovelStateLogTable).run()
  db.delete(WorldEntryTable).run()
  db.delete(CharacterTable).run()
  db.delete(ChapterTable).run()
  db.delete(NovelTable).run()
  db.run(sql`DELETE FROM chapter_summary_fts`)
  return db
}

beforeEach(() => resetDb())

async function seedNovel() {
  const db = await resetDb()
  const { NovelTable, ChapterTable } = await import("../../src/novel-writer/session-store.js")
  db.insert(NovelTable).values({
    id: NOVEL,
    title: "状态提交测试",
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

describe("commitState 可靠性", () => {
  test("同章重复提交不会翻倍候选、冲突、摘要和 FTS", async () => {
    const db = await seedNovel()
    const {
      ChapterSummaryTable,
      PendingSettingTable,
      WorldEntryConflictTable,
      WorldEntryTable,
      NovelStateLogTable,
    } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    db.insert(WorldEntryTable).values({
      id: "we-existing",
      novel_id: NOVEL,
      category: "力量体系",
      title: "炼气期",
      content: "旧内容",
    }).run()

    const delta = [
      {
        fact_type: "chapter_summary" as const,
        action: "create" as const,
        entity_id: "cs-1",
        data: {
          chapter_id: CHAPTER,
          summary: "陆沉在黑市拍卖获得残缺功法",
          key_events: ["黑市拍卖"],
        },
      },
      {
        fact_type: "world_entry" as const,
        action: "create" as const,
        entity_id: "we-pending",
        data: {
          category: "力量体系",
          title: "金丹期",
          content: "新境界",
          importance: 1,
        },
      },
      {
        fact_type: "world_entry" as const,
        action: "create" as const,
        entity_id: "we-local",
        data: {
          category: "力量体系",
          title: "炼气期",
          content: "新内容",
          conflict_note: "层数不一致",
          conflict_kind: "number_inconsistency",
        },
      },
    ]

    await commitState(NOVEL, CHAPTER, delta)
    await commitState(NOVEL, CHAPTER, delta)

    const summaries = db.select().from(ChapterSummaryTable).all()
    const pending = db
      .select()
      .from(PendingSettingTable)
      .where(eq(PendingSettingTable.source_chapter_id, CHAPTER))
      .all()
    const conflicts = db
      .select()
      .from(WorldEntryConflictTable)
      .where(eq(WorldEntryConflictTable.source_chapter_id, CHAPTER))
      .all()
    const ftsRows = db.all(
      sql`SELECT body FROM chapter_summary_fts WHERE novel_id = ${NOVEL} AND chapter_id = ${CHAPTER}`,
    ) as Array<{ body: string }>
    const logs = db.select().from(NovelStateLogTable).all()

    expect(summaries).toHaveLength(1)
    expect(pending).toHaveLength(1)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].conflict_kind).toBe("number_inconsistency")
    expect(ftsRows).toHaveLength(1)
    expect(ftsRows[0].body).toContain("黑市拍卖")
    expect(logs).toHaveLength(6)
  })

  test("中途失败时回滚日志、物化视图和 FTS", async () => {
    const db = await seedNovel()
    const {
      ChapterSummaryTable,
      CharacterTable,
      NovelStateLogTable,
    } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    db.insert(CharacterTable).values({
      id: "char-dup",
      novel_id: NOVEL,
      name: "重复角色",
      role: "",
      description: "原始描述",
      status: "active",
    }).run()

    const logsBefore = db.select().from(NovelStateLogTable).all().length

    await expect(
      commitState(NOVEL, CHAPTER, [
        {
          fact_type: "chapter_summary",
          action: "create",
          entity_id: "cs-rollback",
          data: { chapter_id: CHAPTER, summary: "应被回滚", key_events: [] },
        },
        {
          fact_type: "character",
          action: "create",
          entity_id: "char-dup",
          data: { name: "重复角色", role: "主角", description: "不应写入" },
        },
      ]),
    ).rejects.toThrow()

    const logsAfter = db.select().from(NovelStateLogTable).all().length
    const summaries = db.select().from(ChapterSummaryTable).all()
    const character = db.select().from(CharacterTable).where(eq(CharacterTable.id, "char-dup")).all()[0]
    const ftsCount = db.all(
      sql`SELECT count(*) as count FROM chapter_summary_fts WHERE novel_id = ${NOVEL}`,
    ) as Array<{ count: number }>

    expect(logsAfter).toBe(logsBefore)
    expect(summaries).toHaveLength(0)
    expect(character.description).toBe("原始描述")
    expect(ftsCount[0].count).toBe(0)
  })
})