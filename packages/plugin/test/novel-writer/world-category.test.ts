import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"

const originalCwd = process.cwd()
const testDir = join(tmpdir(), `novel-category-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const NOVEL = "novel-category"
const CHAPTER = "chapter-category"

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

describe("validateWorldCategory", () => {
  test("标准主分类合法", async () => {
    const { validateWorldCategory } = await import("../../src/novel-writer/world-category.js")
    expect(validateWorldCategory("力量体系")).toBeNull()
    expect(validateWorldCategory("核心设定")).toBeNull()
  })

  test("主分类/子分类形式合法", async () => {
    const { validateWorldCategory } = await import("../../src/novel-writer/world-category.js")
    expect(validateWorldCategory("地点/城市")).toBeNull()
  })

  test("未知分类与空分类被拒绝", async () => {
    const { validateWorldCategory } = await import("../../src/novel-writer/world-category.js")
    expect(validateWorldCategory("组织")).toContain("不在标准列表")
    expect(validateWorldCategory("")).toContain("不在标准列表")
  })
})

describe("observer delta 的 world_entry 分类拦截", () => {
  async function seed() {
    const { getDb, NovelTable, ChapterTable, WorldEntryTable, PendingSettingTable } = await import(
      "../../src/novel-writer/session-store.js"
    )
    const db = getDb(null, { fresh: true })
    db.delete(PendingSettingTable).run()
    db.delete(WorldEntryTable).run()
    db.delete(ChapterTable).run()
    db.delete(NovelTable).run()
    db.insert(NovelTable).values({ id: NOVEL, title: "分类测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
    db.insert(ChapterTable)
      .values({ id: CHAPTER, novel_id: NOVEL, title: "第一章", content: "", word_count: 0, status: "draft", order: 1 })
      .run()
    return db
  }

  test("非法分类的高重要度 world_entry 降级到候选区，不直达正式表", async () => {
    const db = await seed()
    const { WorldEntryTable, PendingSettingTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    await commitState(NOVEL, CHAPTER, [
      {
        fact_type: "world_entry",
        action: "create",
        entity_id: "we-bad-category",
        data: { category: "组织", title: "暗影会", content: "神秘组织", importance: 3 },
      },
    ])

    expect(db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "we-bad-category")).all()).toHaveLength(0)
    const pending = db.select().from(PendingSettingTable).where(eq(PendingSettingTable.novel_id, NOVEL)).all()
    expect(pending).toHaveLength(1)
    expect(pending[0].display_title).toBe("暗影会")
  })

  test("update action 的非法分类被静默丢弃，不绕过白名单", async () => {
    const db = await seed()
    const { WorldEntryTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    // 先建一条合法分类的条目
    await commitState(NOVEL, CHAPTER, [
      {
        fact_type: "world_entry",
        action: "create",
        entity_id: "we-update-target",
        data: { category: "地理", title: "东域", content: "大陆东部", importance: 3 },
      },
    ])

    // update 试图把分类改成非法值，应被忽略（title 仍正常更新）
    await commitState(NOVEL, CHAPTER, [
      {
        fact_type: "world_entry",
        action: "update",
        entity_id: "we-update-target",
        data: { category: "乱七八糟", title: "东域·新" },
      },
    ])

    const row = db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "we-update-target")).get()!
    expect(row.category).toBe("地理")
    expect(row.title).toBe("东域·新")
  })

  test("合法分类（含子分类）正常直达正式表", async () => {
    const db = await seed()
    const { WorldEntryTable, PendingSettingTable } = await import("../../src/novel-writer/session-store.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    await commitState(NOVEL, CHAPTER, [
      {
        fact_type: "world_entry",
        action: "create",
        entity_id: "we-good-category",
        data: { category: "势力/宗门", title: "星辰阁", content: "主角所在宗门", importance: 3 },
      },
    ])

    const entries = db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "we-good-category")).all()
    expect(entries).toHaveLength(1)
    expect(entries[0].category).toBe("势力/宗门")
    expect(db.select().from(PendingSettingTable).where(eq(PendingSettingTable.novel_id, NOVEL)).all()).toHaveLength(0)
  })
})
