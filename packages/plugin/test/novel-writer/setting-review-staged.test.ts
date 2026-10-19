/**
 * 暂存变更共享服务测试（setting-review-hub 任务 2.3）
 *
 * 覆盖 stage 落点（校验通过才落、不执行、superseded）、accept 重校验与执行留痕、
 * 重校验失败不执行、reject 状态流转。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { StagedChangeTable, WorldEntryTable } from "@opennovel-ai/novel-store"
import { getDb, NovelTable, closeDb } from "../../src/novel-writer/session-store.js"
import {
  acceptStagedChange,
  createStagedChangesFromPlan,
  listStagedChanges,
  rejectStagedChange,
} from "../../src/novel-writer/setting-review-staged.js"
import type { OrganizePlan } from "../../src/novel-writer/setting-reorganization.js"

const testDir = join(tmpdir(), `novel-review-staged-${Date.now()}`)
let prevOpenNovelDb: string | undefined
mkdirSync(join(testDir, ".novel"), { recursive: true })

const novelId = crypto.randomUUID()

beforeAll(async () => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = join(testDir, ".novel", "novel.db")
  const db = getDb(testDir)
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "暂存服务测试小说", genre: "玄幻", synopsis: "", created_at: Date.now(), updated_at: Date.now(), status: "draft" })
    .run()
})

afterAll(() => {
  closeDb(testDir)
  if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = prevOpenNovelDb
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

async function insertEntry(partial: { title: string; content: string; category?: string }) {
  const db = getDb(testDir)
  const id = crypto.randomUUID()
  await db
    .insert(WorldEntryTable)
    .values({ id, novel_id: novelId, category: partial.category ?? "地理", title: partial.title, content: partial.content })
    .run()
  return id
}

function updatePlan(entityType: "world_entry", id: string, fields: Record<string, unknown>): OrganizePlan {
  return { version: 2, operations: [{ action: "update", entity_type: entityType, id, fields: fields as never, reason: "测试草案" }] }
}

describe("createStagedChangesFromPlan", () => {
  test("校验通过才落暂存且不执行；同目标旧草案标 superseded", async () => {
    const entryId = await insertEntry({ title: "北境荒原", content: "冰原地带。" })
    const planA = updatePlan("world_entry", entryId, { content: "冰原地带。\n\n冬季长达半年。" })
    const first = await createStagedChangesFromPlan(testDir, novelId, planA)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.staged_ids.length).toBe(1)

    const db = getDb(testDir)
    // 正式数据未变
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).all()
    expect(entry?.content).toBe("冰原地带。")
    const [rowA] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, first.staged_ids[0]!)).all()
    expect(rowA?.status).toBe("pending")
    expect(JSON.parse(rowA?.before_json ?? "{}").content).toBe("冰原地带。")

    // 再次 stage 同一目标 → 旧草案 superseded
    const planB = updatePlan("world_entry", entryId, { content: "极寒冰原，冬季长达八个月。" })
    const second = await createStagedChangesFromPlan(testDir, novelId, planB)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const [afterA] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, first.staged_ids[0]!)).all()
    expect(afterA?.status).toBe("superseded")
    const [afterB] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, second.staged_ids[0]!)).all()
    expect(afterB?.status).toBe("pending")
  })

  test("校验失败不产出暂存并列出逐条错误", async () => {
    const ghostPlan = updatePlan("world_entry", "no-such-entry", { content: "内容。" })
    const result = await createStagedChangesFromPlan(testDir, novelId, ghostPlan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join("\n")).toContain("不存在")
    const pending = await listStagedChanges(getDb(testDir), { novelId, status: "pending" })
    const reasons = pending.rows.filter((r) => r.reason === "测试草案" && JSON.parse(r.after_json).content === "内容。")
    expect(reasons.length).toBe(0)
  })
})

describe("acceptStagedChange", () => {
  test("接受后执行更新并标记 accepted", async () => {
    const entryId = await insertEntry({ title: "青云坊市", content: "凡人集散地。" })
    const staged = await createStagedChangesFromPlan(testDir, novelId, updatePlan("world_entry", entryId, { content: "凡人与低阶修士交易的坊市。\n\n每逢初五开市。" }))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const result = await acceptStagedChange(testDir, staged.staged_ids[0]!)
    expect(result.ok).toBe(true)

    const db = getDb(testDir)
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).all()
    expect(entry?.content).toContain("初五开市")
    const [row] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, staged.staged_ids[0]!)).all()
    expect(row?.status).toBe("accepted")
    expect(row?.resolved_at).not.toBeNull()
  })

  test("编辑 after 后接受：合法内容按编辑值执行", async () => {
    const entryId = await insertEntry({ title: "落霞谷", content: "西境山谷。" })
    const staged = await createStagedChangesFromPlan(testDir, novelId, updatePlan("world_entry", entryId, { content: "西境山谷，多雾。" }))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const result = await acceptStagedChange(testDir, staged.staged_ids[0]!, {
      afterOverride: { content: "西境山谷，终年多雾。\n\n谷底有温泉。" },
    })
    expect(result.ok).toBe(true)
    const db = getDb(testDir)
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).all()
    expect(entry?.content).toContain("谷底有温泉")
  })

  test("重校验失败不执行且保持 pending", async () => {
    const entryId = await insertEntry({ title: "黑水湖", content: "湖水漆黑。" })
    const staged = await createStagedChangesFromPlan(testDir, novelId, updatePlan("world_entry", entryId, { content: "湖水漆黑，深不见底。" }))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    // 底座被并发删除 → 重校验必然失败
    const db = getDb(testDir)
    await db.delete(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).run()
    const result = await acceptStagedChange(testDir, staged.staged_ids[0]!)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors?.join("\n")).toContain("不存在")
    const [row] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, staged.staged_ids[0]!)).all()
    expect(row?.status).toBe("pending")
  })

  test("编辑后的非法内容（Markdown）重校验拒绝", async () => {
    const entryId = await insertEntry({ title: "星陨原", content: "陨石坠落之地。" })
    const staged = await createStagedChangesFromPlan(testDir, novelId, updatePlan("world_entry", entryId, { content: "陨石坠落之地，遍布深坑。" }))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const result = await acceptStagedChange(testDir, staged.staged_ids[0]!, {
      afterOverride: { content: "陨石坠落之地，**深坑遍布**。" },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.errors ?? []).join("\n")).toContain("不是纯文本格式")
  })
})

describe("rejectStagedChange", () => {
  test("拒绝后标记 rejected；不可重复处理", async () => {
    const entryId = await insertEntry({ title: "枯木林", content: "草木不生。" })
    const staged = await createStagedChangesFromPlan(testDir, novelId, updatePlan("world_entry", entryId, { content: "草木不生，偶有枯枝。" }))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const db = getDb(testDir)
    const rejected = await rejectStagedChange(db, staged.staged_ids[0]!)
    expect(rejected.ok).toBe(true)
    const [row] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, staged.staged_ids[0]!)).all()
    expect(row?.status).toBe("rejected")
    const again = await rejectStagedChange(db, staged.staged_ids[0]!)
    expect(again.ok).toBe(false)
  })

  test("accept 不存在的暂存与非法 after 覆盖均报错", async () => {
    const missing = await acceptStagedChange(testDir, "no-such-staged")
    expect(missing.ok).toBe(false)
    const entryId = await insertEntry({ title: "无名丘", content: "低矮土丘。" })
    const staged = await createStagedChangesFromPlan(testDir, novelId, updatePlan("world_entry", entryId, { content: "低矮土丘，无草木。" }))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const broken = await acceptStagedChange(testDir, staged.staged_ids[0]!, { afterOverride: { nonsense_field: "x" } })
    expect(broken.ok).toBe(false)
  })
})
