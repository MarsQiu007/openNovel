/**
 * 候选区操作共享服务测试（setting-review-hub 任务 2.1）
 *
 * 覆盖 accept / reject / merge / list 的核心路径与业务失败分支。
 * 使用临时 SQLite 数据库，测试结束后自动清理。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { CharacterTable, WorldEntryTable } from "@opennovel-ai/novel-store"
import {
  getDb,
  NovelTable,
  PendingSettingTable,
  closeDb,
} from "../../src/novel-writer/session-store.js"
import {
  acceptPendingSetting,
  listPendingSettingRows,
  mergePendingSettings,
  rejectPendingSetting,
} from "../../src/novel-writer/setting-review-candidates.js"

const testDir = join(tmpdir(), `novel-review-candidates-${Date.now()}`)
let prevOpenNovelDb: string | undefined
mkdirSync(testDir, { recursive: true })

const novelId = crypto.randomUUID()

beforeAll(async () => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = join(testDir, "test.db")
  const db = getDb()
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "候选服务测试小说", genre: "玄幻", synopsis: "", created_at: Date.now(), updated_at: Date.now(), status: "draft" })
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

async function insertPending(partial: {
  id?: string
  candidate_type: string
  display_title: string
  payload_json: string
  status?: string
}) {
  const db = getDb()
  const id = partial.id ?? crypto.randomUUID()
  await db
    .insert(PendingSettingTable)
    .values({
      id,
      novel_id: novelId,
      candidate_type: partial.candidate_type,
      display_title: partial.display_title,
      payload_json: partial.payload_json,
      status: partial.status ?? "pending",
      created_at: Date.now(),
    })
    .run()
  return id
}

describe("acceptPendingSetting", () => {
  test("world_entry 候选接受入库并标记 accepted", async () => {
    const pendingId = await insertPending({
      candidate_type: "world_entry",
      display_title: "青云宗",
      payload_json: JSON.stringify({ category: "地理", title: "青云宗", content: "位于东洲的正道大派。\n\n立派三千年。" }),
    })
    const result = await acceptPendingSetting(getDb(), pendingId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidate_type).toBe("world_entry")
    expect(result.display_title).toBe("青云宗")

    const db = getDb()
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, result.created_id)).all()
    expect(entry?.title).toBe("青云宗")
    expect(entry?.category).toBe("地理")
    const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, pendingId)).all()
    expect(row?.status).toBe("accepted")
    expect(row?.resolved_at).not.toBeNull()
  })

  test("character 候选接受时撞同名角色被拒", async () => {
    const db = getDb()
    await db
      .insert(CharacterTable)
      .values({ id: crypto.randomUUID(), novel_id: novelId, name: "林天", role: "", description: "", status: "active" })
      .run()
    const pendingId = await insertPending({
      candidate_type: "character",
      display_title: "林天",
      payload_json: JSON.stringify({ name: "林天", description: "主角。" }),
    })
    const result = await acceptPendingSetting(getDb(), pendingId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("已存在同名角色")
  })

  test("非 pending 状态不可接受；不存在候选报错", async () => {
    const acceptedId = await insertPending({
      candidate_type: "character",
      display_title: "已收",
      payload_json: "{}",
      status: "accepted",
    })
    const result = await acceptPendingSetting(getDb(), acceptedId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("不是 pending")

    const missing = await acceptPendingSetting(getDb(), "no-such-id")
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.error).toContain("候选不存在")
  })

  test("Markdown 文本候选格式校验失败并列出明细", async () => {
    const pendingId = await insertPending({
      candidate_type: "world_entry",
      display_title: "带标记条目",
      payload_json: JSON.stringify({ category: "历史", title: "带标记条目", content: "历史上有 **加粗** 记载。" }),
    })
    const result = await acceptPendingSetting(getDb(), pendingId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("设定文本格式校验失败")
    expect(result.format_errors?.length).toBeGreaterThan(0)
  })
})

describe("rejectPendingSetting", () => {
  test("拒绝后标记 rejected；不可重复拒绝", async () => {
    const pendingId = await insertPending({
      candidate_type: "character",
      display_title: "待拒绝",
      payload_json: JSON.stringify({ name: "待拒绝", description: "弱关系。" }),
    })
    const result = await rejectPendingSetting(getDb(), pendingId)
    expect(result.ok).toBe(true)
    const db = getDb()
    const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, pendingId)).all()
    expect(row?.status).toBe("rejected")
    const again = await rejectPendingSetting(getDb(), pendingId)
    expect(again.ok).toBe(false)
  })
})

describe("mergePendingSettings", () => {
  test("同类型候选合并创建新条目并回填 merged_into", async () => {
    const idA = await insertPending({
      candidate_type: "world_entry",
      display_title: "青云宗",
      payload_json: JSON.stringify({ category: "势力", title: "青云宗", content: "短介绍。" }),
    })
    const idB = await insertPending({
      candidate_type: "world_entry",
      display_title: "青云宗补遗",
      payload_json: JSON.stringify({ category: "势力", title: "青云宗", content: "更长更完整的介绍，包含立派时间与历代掌门。" }),
    })
    const result = await mergePendingSettings(getDb(), [idA, idB])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged_count).toBe(2)
    const db = getDb()
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, result.created_id)).all()
    expect(entry?.content).toContain("历代掌门")
    for (const id of [idA, idB]) {
      const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, id)).all()
      expect(row?.status).toBe("merged")
      expect(row?.merged_into).toBe(result.created_id)
    }
  })

  test("跨类型与跨小说候选不可合并", async () => {
    const idA = await insertPending({
      candidate_type: "character",
      display_title: "甲",
      payload_json: JSON.stringify({ name: "甲", description: "角色。" }),
    })
    const idB = await insertPending({
      candidate_type: "world_entry",
      display_title: "乙",
      payload_json: JSON.stringify({ category: "历史", title: "乙", content: "条目。" }),
    })
    const mixed = await mergePendingSettings(getDb(), [idA, idB])
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) expect(mixed.error).toContain("candidate_type")

    const db = getDb()
    await db
      .insert(NovelTable)
      .values({ id: "novel-other", title: "另一本", genre: "都市", synopsis: "", created_at: Date.now(), updated_at: Date.now(), status: "draft" })
      .run()
    const foreignId = crypto.randomUUID()
    await db
      .insert(PendingSettingTable)
      .values({
        id: foreignId,
        novel_id: "novel-other",
        candidate_type: "character",
        display_title: "别书角色",
        payload_json: JSON.stringify({ name: "别书角色", description: "。" }),
        created_at: Date.now(),
      })
      .run()
    const cross = await mergePendingSettings(getDb(), [idA, foreignId])
    expect(cross.ok).toBe(false)
    if (!cross.ok) expect(cross.error).toContain("不可跨书合并")
  })
})

describe("listPendingSettingRows", () => {
  test("默认列 pending，支持类型过滤与计数", async () => {
    await insertPending({ candidate_type: "character", display_title: "列甲", payload_json: JSON.stringify({ name: "列甲" }) })
    await insertPending({ candidate_type: "world_entry", display_title: "列乙", payload_json: JSON.stringify({ category: "地理", title: "列乙", content: "。" }) })
    const pending = await listPendingSettingRows(getDb(), { novelId })
    expect(pending.total).toBeGreaterThanOrEqual(2)
    expect(pending.rows.every((r) => r.status === "pending")).toBe(true)
    const filtered = await listPendingSettingRows(getDb(), { novelId, candidateType: "character" })
    expect(filtered.rows.every((r) => r.candidate_type === "character")).toBe(true)
  })
})
