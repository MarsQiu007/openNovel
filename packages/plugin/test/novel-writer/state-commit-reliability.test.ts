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
  const { closeDb } = require("@opennovel-ai/novel-store")
  closeDb()
  delete process.env.OPENNOVEL_DB
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
  test("同章重复提交不会翻倍候选、冲突、摘要、日志和 FTS", async () => {
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
    // 状态日志同为章级「一章一份」（agent-background-job-recovery D5）：reset 先清本章旧行
    expect(logs).toHaveLength(3)
  })

  test("中途失败时回滚日志、物化视图和 FTS", async () => {
    const db = await seedNovel()
    const {
      ChapterSummaryTable,
      NovelStateLogTable,
    } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    const logsBefore = db.select().from(NovelStateLogTable).all().length

    // 失败注入：chapter_summary 指向不存在章节，物化视图写入触发外键约束
    // （角色重复主键注入已随 agent-background-job-recovery D5 的幂等修复失效）
    await expect(
      commitState(NOVEL, CHAPTER, [
        {
          fact_type: "chapter_summary",
          action: "create",
          entity_id: "cs-rollback",
          data: { chapter_id: CHAPTER, summary: "应被回滚", key_events: [] },
        },
        {
          fact_type: "chapter_summary",
          action: "create",
          entity_id: "cs-rollback-2",
          data: { chapter_id: "ch-nonexistent", summary: "触发外键失败", key_events: [] },
        },
      ]),
    ).rejects.toThrow()

    const logsAfter = db.select().from(NovelStateLogTable).all().length
    const summaries = db.select().from(ChapterSummaryTable).all()
    const ftsCount = db.all(
      sql`SELECT count(*) as count FROM chapter_summary_fts WHERE novel_id = ${NOVEL}`,
    ) as Array<{ count: number }>

    expect(logsAfter).toBe(logsBefore)
    expect(summaries).toHaveLength(0)
    expect(ftsCount[0].count).toBe(0)
  })
})

describe("commitState style 规则归一化", () => {
  test("嵌套规则展平落库，不再静默丢弃", async () => {
    const db = await seedNovel()
    const { StyleGuideTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    await commitState(NOVEL, CHAPTER, [
      {
        fact_type: "style",
        action: "create",
        entity_id: "style-main",
        data: { tone: "热血", rules: { "异能体系": { "等级严格": "三级" } } },
      },
    ])

    const [row] = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, NOVEL)).all()
    expect(row!.rules).toMatchObject({ "异能体系.等级严格": "三级" })
  })

  test("非空规则无法归一化时整次提交失败并回滚", async () => {
    const db = await seedNovel()
    const { NovelStateLogTable, StyleGuideTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    const logsBefore = db.select().from(NovelStateLogTable).all().length

    await expect(
      commitState(NOVEL, CHAPTER, [
        {
          fact_type: "chapter_summary",
          action: "create",
          entity_id: "cs-style-rb",
          data: { chapter_id: CHAPTER, summary: "不应写入", key_events: [] },
        },
        {
          fact_type: "style",
          action: "update",
          entity_id: "style-main",
          data: { rules: { bad: null } },
        },
      ]),
    ).rejects.toThrow("无法归一化")

    expect(db.select().from(NovelStateLogTable).all().length).toBe(logsBefore)
    expect(db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, NOVEL)).all()).toHaveLength(0)
  })
})
