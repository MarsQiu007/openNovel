/**
 * 批处理编排测试（setting-review-hub 任务 2.4）
 *
 * 覆盖混合计划拆分（白名单直执行 + 语义类入箱）、纯白名单、纯语义、整体校验失败不产出。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { StagedChangeTable, WorldEntryTable } from "@opennovel-ai/novel-store"
import { getDb, NovelTable, closeDb } from "../../src/novel-writer/session-store.js"
import { runSettingReviewBatch } from "../../src/novel-writer/setting-review-batch.js"
import type { OrganizePlan } from "../../src/novel-writer/setting-reorganization.js"

const testDir = join(tmpdir(), `novel-review-batch-${Date.now()}`)
let prevOpenNovelDb: string | undefined
mkdirSync(join(testDir, ".novel"), { recursive: true })

const novelId = crypto.randomUUID()

beforeAll(async () => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = join(testDir, ".novel", "novel.db")
  const db = getDb(testDir)
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "批处理测试小说", genre: "玄幻", synopsis: "", created_at: Date.now(), updated_at: Date.now(), status: "draft" })
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

describe("runSettingReviewBatch", () => {
  test("混合计划拆分：白名单直执行、语义类入箱", async () => {
    const formatId = await insertEntry({ title: "东荒", content: "东荒大地广袤无边。妖兽横行。" })
    const categoryId = await insertEntry({ title: "神秘古地", content: "禁地。", category: "重要设定" })
    const semanticId = await insertEntry({ title: "南岭", content: "南岭多山。" })
    const plan: OrganizePlan = {
      version: 2,
      operations: [
        {
          action: "update",
          entity_type: "world_entry",
          id: formatId,
          fields: { content: "东荒大地广袤无边。\n\n妖兽横行。" },
          reason: "长段落自动分段",
        },
        {
          action: "update",
          entity_type: "world_entry",
          id: categoryId,
          fields: { category: "核心设定" },
          reason: "非标准分类「重要设定」→「核心设定」",
        },
        {
          action: "update",
          entity_type: "world_entry",
          id: semanticId,
          fields: { content: "南岭山脉绵延千里，是妖族祖地。" },
          reason: "语义改写",
        },
      ],
    }
    const result = await runSettingReviewBatch(testDir, novelId, plan)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auto_executed).toBe(2)
    expect(result.pending_added).toBe(1)

    const db = getDb(testDir)
    const [formatEntry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, formatId)).all()
    expect(formatEntry?.content).toBe("东荒大地广袤无边。\n\n妖兽横行。")
    const [categoryEntry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, categoryId)).all()
    expect(categoryEntry?.category).toBe("核心设定")
    const [semanticEntry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, semanticId)).all()
    expect(semanticEntry?.content).toBe("南岭多山。")
    const [staged] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, result.staged_ids[0]!)).all()
    expect(staged?.status).toBe("pending")
    expect(JSON.parse(staged?.entry_ids ?? "[]")).toEqual([semanticId])
  })

  test("纯语义计划全部入箱不执行", async () => {
    const entryId = await insertEntry({ title: "西漠", content: "黄沙万里。" })
    const result = await runSettingReviewBatch(testDir, novelId, {
      version: 2,
      operations: [{ action: "update", entity_type: "world_entry", id: entryId, fields: { content: "黄沙万里，不见人烟。" }, reason: "扩写" }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auto_executed).toBe(0)
    expect(result.execution).toBeNull()
    expect(result.pending_added).toBe(1)
    const db = getDb(testDir)
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).all()
    expect(entry?.content).toBe("黄沙万里。")
  })

  test("纯白名单计划全部直接执行", async () => {
    const entryId = await insertEntry({ title: "北溟", content: "北溟有鱼。其名为鲲。" })
    const result = await runSettingReviewBatch(testDir, novelId, {
      version: 2,
      operations: [
        { action: "update", entity_type: "world_entry", id: entryId, fields: { content: "北溟有鱼。\n\n其名为鲲。" }, reason: "分段" },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auto_executed).toBe(1)
    expect(result.pending_added).toBe(0)
    const db = getDb(testDir)
    const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).all()
    expect(entry?.content).toBe("北溟有鱼。\n\n其名为鲲。")
    const pending = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.status, "pending")).all()
    expect(pending.some((row) => JSON.parse(row.entry_ids).includes(entryId))).toBe(false)
  })

  test("整体校验失败不产出也不执行", async () => {
    const result = await runSettingReviewBatch(testDir, novelId, {
      version: 2,
      operations: [{ action: "update", entity_type: "world_entry", id: "ghost", fields: { content: "内容。" }, reason: "不存在" }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join("\n")).toContain("不存在")
  })
})
