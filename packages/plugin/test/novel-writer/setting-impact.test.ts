/**
 * 统一设定影响面服务测试
 * 覆盖：影响计划只读、确定性引用任务（含母子关系改名夹具）、稳定任务键判重、
 * 结构性依赖、语义建议确认/忽略、统一报告、旧数据兼容与引用重建。
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb } from "@opennovel-ai/novel-store"

const testDir = join(tmpdir(), `novel-setting-impact-${Date.now()}`)
const dbPath = join(testDir, "test.db")

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
})

afterAll(() => {
  delete process.env.OPENNOVEL_DB
  closeDb()
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

const NOVEL_ID = "test-novel-impact"
const CHAR_MOTHER = "char-mother"
const CHAR_SON = "char-son"
const REL_ID = "rel-1"
const CH1 = "ch-1"
const WORLD_ID = "world-1"

const CH1_CONTENT =
  "云清站在院中教小雨剑法，讲的正是「剑气九重」的入门。小雨资质平平，云清却不厌其烦。院外传来门派钟声，小雨望向钟楼。"

async function setup() {
  const {
    getDb,
    NovelTable,
    ChapterTable,
    CharacterTable,
    RelationshipTable,
    WorldEntryTable,
    EntityRefTable,
    PendingUpdateTable,
  } = await import("../../src/novel-writer/session-store.js")
  const { scanReferences } = await import("../../src/novel-writer/state-commit.js")
  const db = getDb()
  db.delete(PendingUpdateTable).run()
  db.delete(EntityRefTable).run()
  db.delete(ChapterTable).run()
  db.delete(RelationshipTable).run()
  db.delete(CharacterTable).run()
  db.delete(WorldEntryTable).run()
  db.delete(NovelTable).run()
  db.insert(NovelTable).values({ id: NOVEL_ID, title: "影响面测试", genre: "test", synopsis: "", status: "draft" }).run()
  db.insert(CharacterTable)
    .values([
      { id: CHAR_MOTHER, novel_id: NOVEL_ID, name: "云清", role: "secondary", description: "小雨的母亲，剑法沉稳。" },
      { id: CHAR_SON, novel_id: NOVEL_ID, name: "小雨", role: "protagonist", description: "云清的儿子，资质平平但勤奋。" },
    ])
    .run()
  db.insert(RelationshipTable)
    .values({ id: REL_ID, novel_id: NOVEL_ID, char_a_id: CHAR_MOTHER, char_b_id: CHAR_SON, type: "母子", description: "云清是小雨的母亲，教小雨剑法。" })
    .run()
  db.insert(WorldEntryTable)
    .values({ id: WORLD_ID, novel_id: NOVEL_ID, category: "力量体系", title: "剑气九重", content: "剑修境界分九重，小雨目前处于第二重。" })
    .run()
  db.insert(ChapterTable)
    .values({ id: CH1, novel_id: NOVEL_ID, title: "第一章", content: CH1_CONTENT, word_count: CH1_CONTENT.length, status: "drafted", order: 1 })
    .run()
  // 扫描章节引用：正文含 云清/小雨
  await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
  return db
}

describe("SettingImpactService", () => {
  test("空变更意图返回明确错误", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { planImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    await expect(
      planImpact(db, { novelId: NOVEL_ID, entityType: "", entityId: "", field: "", oldValue: "", newValue: "", reason: "" }),
    ).rejects.toThrow("变更意图不完整")
  })

  test("影响计划查询只读：返回引用发现且不生成任务、不改设定", async () => {
    const { getDb, PendingUpdateTable, CharacterTable } = await import("../../src/novel-writer/session-store.js")
    const { planImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    const before = db.select({ name: CharacterTable.name }).from(CharacterTable).where(eq(CharacterTable.id, CHAR_MOTHER)).all()
    const findings = await planImpact(db, {
      novelId: NOVEL_ID,
      entityType: "character",
      entityId: CHAR_MOTHER,
      field: "name",
      oldValue: "云清",
      newValue: "云清师太",
      reason: "角色改名",
    })
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const chFinding = findings.find((f) => f.sourceType === "chapter" && f.sourceId === CH1)
    expect(chFinding).toBeTruthy()
    expect(chFinding!.refText).toContain("云清")
    expect(chFinding!.kind).toBe("deterministic")
    // 结构性依赖：母子关系以云清为一端
    const relFinding = findings.find((f) => f.kind === "structural" && f.sourceType === "relationship")
    expect(relFinding).toBeTruthy()
    // 只读：无任务产生，设定未变
    expect(db.select().from(PendingUpdateTable).all().length).toBe(0)
    expect(db.select({ name: CharacterTable.name }).from(CharacterTable).where(eq(CharacterTable.id, CHAR_MOTHER)).all()).toEqual(before)
  })

  test("确定性影响生成任务：母子角色改名夹具，任务含旧值新值与证据", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { applyImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    const count = await applyImpact(db, {
      novelId: NOVEL_ID,
      entityType: "character",
      entityId: CHAR_MOTHER,
      field: "name",
      oldValue: "云清",
      newValue: "云清师太",
      reason: "角色「云清」改名为「云清师太」",
    })
    // 章节（正文引用）+ 关系（结构依赖，描述含旧名）至少 2 个任务
    expect(count).toBeGreaterThanOrEqual(2)
    const tasks = db.select().from(PendingUpdateTable).all()
    const chapterTask = tasks.find((t) => t.source_type === "chapter")
    expect(chapterTask!.old_value).toBe("云清")
    expect(chapterTask!.new_value).toBe("云清师太")
    expect(chapterTask!.trigger_field).toBe("name")
  })

  test("稳定任务键：重复应用同一变更不产生重复任务", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { applyImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    const intent = {
      novelId: NOVEL_ID,
      entityType: "character",
      entityId: CHAR_MOTHER,
      field: "name",
      oldValue: "云清",
      newValue: "云清师太",
      reason: "角色改名",
    }
    const first = await applyImpact(db, intent)
    const second = await applyImpact(db, intent)
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(0)
    expect(db.select().from(PendingUpdateTable).all().length).toBe(first)
  })

  test("稳定任务键含字段：同实体不同字段变化允许新任务", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { applyImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    await applyImpact(db, { novelId: NOVEL_ID, entityType: "character", entityId: CHAR_MOTHER, field: "name", oldValue: "云清", newValue: "云清师太", reason: "改名" })
    const count = await applyImpact(db, { novelId: NOVEL_ID, entityType: "character", entityId: CHAR_MOTHER, field: "description", oldValue: "旧描述", newValue: "新描述", reason: "描述更新" })
    expect(count).toBeGreaterThan(0)
  })

  test("世界观标题变化：引用章节生成任务且重复应用不重复", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { applyImpact, planImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    const count = await applyImpact(db, {
      novelId: NOVEL_ID,
      entityType: "world_entry",
      entityId: WORLD_ID,
      field: "title",
      oldValue: "剑气九重",
      newValue: "剑气十重",
      reason: "力量体系改名",
    })
    expect(count).toBeGreaterThanOrEqual(1)
    const dup = await planImpact(db, { novelId: NOVEL_ID, entityType: "world_entry", entityId: WORLD_ID, field: "title", oldValue: "剑气九重", newValue: "剑气十重", reason: "力量体系改名" })
    expect(dup.length).toBeGreaterThan(0)
    const again = await applyImpact(db, { novelId: NOVEL_ID, entityType: "world_entry", entityId: WORLD_ID, field: "title", oldValue: "剑气九重", newValue: "剑气十重", reason: "力量体系改名" })
    expect(again).toBe(0)
    const chapterTask = db.select().from(PendingUpdateTable).all().find((t) => t.source_type === "chapter")
    expect(chapterTask).toBeTruthy()
  })

  test("语义建议：requires_confirmation 不算 pending，确认后进入队列，忽略后不执行", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { createSemanticSuggestions, confirmSemanticSuggestion, ignoreSemanticSuggestion, applyImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    // 世界观内容变化 + 一条语义建议（小雨能力描写需联动）
    await applyImpact(db, { novelId: NOVEL_ID, entityType: "world_entry", entityId: WORLD_ID, field: "content", oldValue: "第二重", newValue: "第三重", reason: "力量体系调整" })
    const made = await createSemanticSuggestions(db, { novelId: NOVEL_ID, entityType: "world_entry", entityId: WORLD_ID, field: "content", oldValue: "第二重", newValue: "第三重", reason: "力量体系调整" }, [
      { sourceType: "chapter", sourceId: CH1, refField: "ability描写", refText: "小雨练剑情节可能与新境界冲突", priority: "low" },
    ])
    expect(made).toBe(1)
    const [suggestion] = db.select().from(PendingUpdateTable).all().filter((t) => t.status === "requires_confirmation")
    expect(suggestion).toBeTruthy()
    expect(suggestion!.reason.startsWith("[语义建议]")).toBe(true)
    // 重复提交同建议不重复
    expect(await createSemanticSuggestions(db, { novelId: NOVEL_ID, entityType: "world_entry", entityId: WORLD_ID, field: "content", oldValue: "第二重", newValue: "第三重", reason: "力量体系调整" }, [
      { sourceType: "chapter", sourceId: CH1, refField: "ability描写", refText: "重复建议" },
    ])).toBe(0)
    // 确认 → pending，可被门禁与批量执行看到
    expect(await confirmSemanticSuggestion(db, suggestion!.id)).toBe(true)
    expect(db.select().from(PendingUpdateTable).all().find((t) => t.id === suggestion!.id)!.status).toBe("pending")
    // 第二条建议走忽略路径
    const made2 = await createSemanticSuggestions(db, { novelId: NOVEL_ID, entityType: "world_entry", entityId: WORLD_ID, field: "content", oldValue: "第二重", newValue: "第三重", reason: "力量体系调整" }, [
      { sourceType: "chapter", sourceId: CH1, refField: "ability描写2", refText: "另一条建议" },
    ])
    expect(made2).toBe(1)
    const [second] = db.select().from(PendingUpdateTable).all().filter((t) => t.status === "requires_confirmation" && t.trigger_field === "ability描写2")
    expect(await ignoreSemanticSuggestion(db, second!.id)).toBe(true)
    expect(db.select().from(PendingUpdateTable).all().find((t) => t.id === second!.id)!.status).toBe("ignored")
    // 已处理的建议不可再次确认/忽略
    expect(await confirmSemanticSuggestion(db, second!.id)).toBe(false)
  })

  test("统一影响报告：任务数、待处理数、门禁与建议动作", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { applyImpact, buildImpactReport, planImpact } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    const intent = { novelId: NOVEL_ID, entityType: "character", entityId: CHAR_MOTHER, field: "name", oldValue: "云清", newValue: "云清师太", reason: "角色改名" }
    const created = await applyImpact(db, intent)
    const report = await buildImpactReport(db, intent, await planImpact(db, intent), created)
    expect(report.impact_plan.entity_type).toBe("character")
    expect(report.task_count).toBe(created)
    expect(report.pending_count).toBe(created)
    expect(report.blocked_writing).toBe(true)
    expect(report.next_actions.some((a) => a.includes("cascade_list_pending"))).toBe(true)
  })

  test("旧数据兼容：缺省字段的历史任务可查看并处理", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { createSemanticSuggestions, ignoreSemanticSuggestion } = await import("../../src/novel-writer/setting-impact.js")
    const db = await setup()
    // 模拟旧版本写入的任务：不带新状态值，仅旧状态机（pending）
    db.insert(PendingUpdateTable)
      .values({ id: "legacy-task", novel_id: NOVEL_ID, source_type: "chapter", source_id: CH1, trigger_type: "character", trigger_id: CHAR_SON, trigger_field: "", old_value: "", new_value: "", reason: "历史遗留", status: "pending", priority: "medium" })
      .run()
    // 新服务不影响旧任务读取与处理（通过状态查询与 resolve 路径复用 cascadeResolve，这里验证状态不变）
    const rows = db.select().from(PendingUpdateTable).all().filter((t) => t.id === "legacy-task")
    expect(rows.length).toBe(1)
    expect(rows[0]!.status).toBe("pending")
    // 语义建议服务对旧库同样可用
    const made = await createSemanticSuggestions(db, { novelId: NOVEL_ID, entityType: "character", entityId: CHAR_SON, field: "description", oldValue: "a", newValue: "b", reason: "旧库新建议" }, [
      { sourceType: "chapter", sourceId: CH1, refField: "semantic", refText: "旧库语义建议" },
    ])
    expect(made).toBe(1)
    const [s] = db.select().from(PendingUpdateTable).all().filter((t) => t.status === "requires_confirmation")
    expect(await ignoreSemanticSuggestion(db, s!.id)).toBe(true)
  })

  test("全量引用重建不破坏既有数据", async () => {
    const { getDb, ChapterTable, CharacterTable, EntityRefTable } = await import("../../src/novel-writer/session-store.js")
    const { cascadeRebuildRefs } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    const result = await cascadeRebuildRefs(db, NOVEL_ID)
    expect(result.chapters).toBe(1)
    expect(result.characters).toBe(2)
    expect(db.select().from(ChapterTable).all().length).toBe(1)
    expect(db.select().from(CharacterTable).all().length).toBe(2)
    const refs = db.select().from(EntityRefTable).all()
    expect(refs.length).toBeGreaterThanOrEqual(2)
  })
})
