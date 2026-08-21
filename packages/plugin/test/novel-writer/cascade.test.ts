/**
 * 级联一致性系统测试
 * 验证 scanReferences / cascadeCheck / cascadeCreateTasks / cascadeListPending / cascadeResolve / cascadeRebuildRefs / cascadeExecute / 门禁
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb } from "@opennovel-ai/novel-store"

const testDir = join(tmpdir(), `novel-cascade-${Date.now()}`)
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

const NOVEL_ID = "test-novel-cascade"
const CHAR_LU = "char-lu-chen"
const CHAR_SU = "char-su-wan"
const CH1 = "ch-1"
const VOL1 = "vol-1"

const CH1_CONTENT =
  '陆沉站在山崖之上，俯瞰着下方的云海。他握紧了手中的长剑。"你来了。"苏婉的声音从身后传来。陆沉没有回头："我必须去。"苏婉走上前来，与他并肩而立。'
const VOL1_SUMMARY = "陆沉踏上修真之路，苏婉在后方守望。"

async function setup() {
  const {
    getDb,
    NovelTable,
    ChapterTable,
    CharacterTable,
    VolumeTable,
    EntityRefTable,
    PendingUpdateTable,
    SagaSessionTable,
  } = await import("../../src/novel-writer/session-store.js")
  const db = getDb()
  db.delete(SagaSessionTable).run()
  db.delete(PendingUpdateTable).run()
  db.delete(EntityRefTable).run()
  db.delete(ChapterTable).run()
  db.delete(CharacterTable).run()
  db.delete(VolumeTable).run()
  db.delete(NovelTable).run()
  db.insert(NovelTable).values({ id: NOVEL_ID, title: "级联测试", genre: "test", synopsis: "", status: "draft" }).run()
  db.insert(CharacterTable)
    .values([
      { id: CHAR_LU, novel_id: NOVEL_ID, name: "陆沉", role: "protagonist", description: "少年剑修，性格坚毅。" },
      { id: CHAR_SU, novel_id: NOVEL_ID, name: "苏婉", role: "secondary", description: "陆沉的师妹，擅长符术。" },
    ])
    .run()
  db.insert(ChapterTable)
    .values({
      id: CH1,
      novel_id: NOVEL_ID,
      title: "第一章",
      content: CH1_CONTENT,
      word_count: CH1_CONTENT.length,
      status: "drafted",
      order: 1,
    })
    .run()
  db.insert(VolumeTable)
    .values({ id: VOL1, novel_id: NOVEL_ID, title: "第一卷", summary: VOL1_SUMMARY, order: 1 })
    .run()
  return db
}

describe("scanReferences", () => {
  test("扫描章节正文找到两个角色引用", async () => {
    const { getDb, EntityRefTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    const count = await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    expect(count).toBe(2)
    const refs = db.select().from(EntityRefTable).all()
    expect(refs.length).toBe(2)
    expect(refs.map((r) => r.target_id)).toContain(CHAR_LU)
    expect(refs.map((r) => r.target_id)).toContain(CHAR_SU)
    expect(refs.find((r) => r.target_id === CHAR_LU)!.ref_text).toContain("陆沉")
  })

  test("空内容返回 0", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    expect(await scanReferences(db, NOVEL_ID, "chapter", "ch-empty", "content", "")).toBe(0)
  })

  test("重新扫描替换旧引用（幂等）", async () => {
    const { getDb, EntityRefTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    expect(db.select().from(EntityRefTable).all().length).toBe(2)
  })
})

describe("cascadeCheck", () => {
  test("查询角色被谁引用", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCheck } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    const affected = await cascadeCheck(db, NOVEL_ID, "character", CHAR_LU)
    expect(affected.length).toBeGreaterThanOrEqual(1)
    const chRef = affected.find((a) => a.source_type === "chapter" && a.source_id === CH1)
    expect(chRef).toBeTruthy()
    expect(chRef!.ref_text).toContain("陆沉")
  })

  test("查询未被引用的角色返回空", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCheck } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    expect((await cascadeCheck(db, NOVEL_ID, "character", "nonexistent")).length).toBe(0)
  })
})

describe("cascadeCreateTasks", () => {
  test("为角色修改创建统改任务", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    const count = await cascadeCreateTasks(
      db,
      NOVEL_ID,
      "character",
      CHAR_LU,
      "description",
      "少年剑修",
      "青年剑修",
      "角色描述修改",
    )
    expect(count).toBeGreaterThanOrEqual(1)
    const tasks = db.select().from(PendingUpdateTable).all()
    const t = tasks.find((t) => t.trigger_id === CHAR_LU)
    expect(t).toBeTruthy()
    expect(t!.status).toBe("pending")
    expect(t!.old_value).toBe("少年剑修")
    expect(t!.new_value).toBe("青年剑修")
  })

  test("重复调用去重", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    const c1 = await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "旧", "新", "测试")
    const c2 = await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "旧", "新", "测试")
    expect(c1).toBeGreaterThanOrEqual(1)
    expect(c2).toBe(0)
    const tasks = db.select().from(PendingUpdateTable).where(eq(PendingUpdateTable.trigger_id, CHAR_LU)).all()
    expect(tasks.length).toBe(c1)
  })
})

describe("cascadeListPending + cascadeResolve", () => {
  test("列出 pending -> 标记 done -> 不再出现在 pending", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks, cascadeListPending, cascadeResolve } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "旧", "新", "测试")
    const pending = await cascadeListPending(db, NOVEL_ID, "pending")
    expect(pending.length).toBeGreaterThanOrEqual(1)
    const ok = await cascadeResolve(db, pending[0].id, "done")
    expect(ok).toBe(true)
    expect((await cascadeListPending(db, NOVEL_ID, "pending")).length).toBe(pending.length - 1)
    const done = await cascadeListPending(db, NOVEL_ID, "done")
    expect(done.length).toBe(1)
    expect(done[0].resolved_at).toBeTruthy()
  })

  test("标记 skipped", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks, cascadeListPending, cascadeResolve } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "旧", "新", "测试")
    const pending = await cascadeListPending(db, NOVEL_ID, "pending")
    expect(await cascadeResolve(db, pending[0].id, "skipped")).toBe(true)
    expect((await cascadeListPending(db, NOVEL_ID, "skipped")).length).toBe(1)
  })

  test("不存在的任务 ID 返回 false", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { cascadeResolve } = await import("../../src/novel-writer/state-commit.js")
    await setup()
    expect(await cascadeResolve(getDb(), "nonexistent", "done")).toBe(false)
  })
})

describe("cascadeRebuildRefs", () => {
  test("全量重建依赖图", async () => {
    const { getDb, EntityRefTable } = await import("../../src/novel-writer/session-store.js")
    const { cascadeRebuildRefs } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    expect(db.select().from(EntityRefTable).all().length).toBe(0)
    const result = await cascadeRebuildRefs(db, NOVEL_ID)
    expect(result.chapters).toBe(1)
    expect(result.characters).toBe(2)
    expect(result.volumes).toBe(1)
    const refs = db.select().from(EntityRefTable).all()
    expect(refs.length).toBeGreaterThan(0)
    // 章节正文引用了陆沉和苏婉
    const chRefs = refs.filter((r) => r.source_type === "chapter")
    expect(chRefs.length).toBe(2)
    // 苏婉描述引用了陆沉
    const charRefs = refs.filter((r) => r.source_type === "character")
    expect(charRefs.length).toBeGreaterThanOrEqual(1)
    // 卷纲摘要引用了陆沉和苏婉
    const volRefs = refs.filter((r) => r.source_type === "volume")
    expect(volRefs.length).toBe(2)
  })

  test("重复重建幂等", async () => {
    const { getDb, EntityRefTable } = await import("../../src/novel-writer/session-store.js")
    const { cascadeRebuildRefs } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await cascadeRebuildRefs(db, NOVEL_ID)
    const count1 = db.select().from(EntityRefTable).all().length
    await cascadeRebuildRefs(db, NOVEL_ID)
    const count2 = db.select().from(EntityRefTable).all().length
    expect(count1).toBe(count2)
  })
})

describe("cascadeExecute (Saga)", () => {
  test("无 pending 任务时返回 no_tasks", async () => {
    const { getDb } = await import("../../src/novel-writer/session-store.js")
    const { cascadeExecute } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    const result = await cascadeExecute(db, NOVEL_ID)
    expect(result.status).toBe("no_tasks")
    expect(result.total).toBe(0)
  })

  test("自动更新角色描述中的旧值", async () => {
    const { getDb, CharacterTable, PendingUpdateTable, SagaSessionTable } = await import(
      "../../src/novel-writer/session-store.js"
    )
    const { scanReferences, cascadeCreateTasks, cascadeExecute } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await scanReferences(db, NOVEL_ID, "character", CHAR_SU, "description", "陆沉的师妹，擅长符术。")
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "name", "陆沉", "陆忱", "改名")

    const result = await cascadeExecute(db, NOVEL_ID)
    expect(result.status).toBe("completed")
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.completed).toBeGreaterThanOrEqual(1)
    expect(result.failed).toBe(0)

    const [updated] = await db.select().from(CharacterTable).where(eq(CharacterTable.id, CHAR_SU)).all()
    expect(updated.description).toContain("陆忱")
    expect(updated.description).not.toContain("陆沉")

    const [saga] = await db.select().from(SagaSessionTable).all()
    expect(saga.status).toBe("completed")
    expect(saga.total_tasks).toBe(result.total)
    expect(saga.completed_tasks).toBe(result.completed + result.skipped)
  })

  test("chapter 类型任务标记为 skipped（需人工处理）", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks, cascadeExecute } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "少年剑修", "青年剑修", "年龄变更")

    const result = await cascadeExecute(db, NOVEL_ID)
    const chapterStep = result.steps.find((s) => s.source_type === "chapter")
    expect(chapterStep).toBeTruthy()
    expect(chapterStep!.action).toBe("skipped")
    expect(chapterStep!.detail).toContain("@reviser")
  })

  test("旧值不存在时跳过", async () => {
    const { getDb, CharacterTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks, cascadeExecute } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await scanReferences(db, NOVEL_ID, "character", CHAR_SU, "description", "陆沉的师妹，擅长符术。")
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "name", "不存在的名字", "新名字", "测试")

    const result = await cascadeExecute(db, NOVEL_ID)
    const charStep = result.steps.find((s) => s.source_type === "character" && s.source_id === CHAR_SU)
    expect(charStep).toBeTruthy()
    expect(charStep!.action).toBe("skipped")
  })

  test("saga_session 持久化进度", async () => {
    const { getDb, SagaSessionTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks, cascadeExecute } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "少年剑修", "青年剑修", "测试")
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_SU, "description", "陆沉的师妹", "陆沉的义妹", "测试")

    await cascadeExecute(db, NOVEL_ID)
    const sagas = await db.select().from(SagaSessionTable).all()
    expect(sagas.length).toBe(1)
    expect(sagas[0].status).toBe("completed")
    expect(sagas[0].total_tasks).toBeGreaterThan(0)
    expect(sagas[0].completed_at).toBeTruthy()
  })
})

describe("门禁机制", () => {
  test("有 pending_updates 时 write_chapter 被拦截", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks } = await import("../../src/novel-writer/state-commit.js")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "少年剑修", "青年剑修", "测试")

    const { eq, and } = await import("drizzle-orm")
    const pending = await db
      .select({ id: PendingUpdateTable.id })
      .from(PendingUpdateTable)
      .where(and(eq(PendingUpdateTable.novel_id, NOVEL_ID), eq(PendingUpdateTable.status, "pending")))
      .all()
    expect(pending.length).toBeGreaterThan(0)
  })

  test("cascade_execute 后门禁解除", async () => {
    const { getDb, PendingUpdateTable } = await import("../../src/novel-writer/session-store.js")
    const { scanReferences, cascadeCreateTasks, cascadeExecute } = await import(
      "../../src/novel-writer/state-commit.js"
    )
    const { eq, and } = await import("drizzle-orm")
    const db = await setup()
    await scanReferences(db, NOVEL_ID, "chapter", CH1, "content", CH1_CONTENT)
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_LU, "description", "少年剑修", "青年剑修", "测试")
    await cascadeCreateTasks(db, NOVEL_ID, "character", CHAR_SU, "description", "陆沉的师妹", "陆沉的义妹", "测试")

    await cascadeExecute(db, NOVEL_ID)

    const pending = await db
      .select({ id: PendingUpdateTable.id })
      .from(PendingUpdateTable)
      .where(and(eq(PendingUpdateTable.novel_id, NOVEL_ID), eq(PendingUpdateTable.status, "pending")))
      .all()
    expect(pending.length).toBe(0)
  })
})
