/**
 * 冲突读取与处理共享服务测试（setting-review-hub 任务 2.2）
 *
 * 覆盖 listConflicts 过滤/分页与两条处理路径（生成暂存草案 / 保留现状忽略）及留痕字段。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  StagedChangeTable,
  WorldEntryConflictTable,
  WorldEntryTable,
} from "@opennovel-ai/novel-store"
import { getDb, NovelTable, closeDb } from "../../src/novel-writer/session-store.js"
import { listConflicts, resolveConflict } from "../../src/novel-writer/setting-review-conflicts.js"

const testDir = join(tmpdir(), `novel-review-conflicts-${Date.now()}`)
let prevOpenNovelDb: string | undefined
mkdirSync(testDir, { recursive: true })

const novelId = crypto.randomUUID()
const entryId = crypto.randomUUID()

beforeAll(async () => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = join(testDir, "test.db")
  const db = getDb()
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "冲突服务测试小说", genre: "玄幻", synopsis: "", created_at: Date.now(), updated_at: Date.now(), status: "draft" })
    .run()
  await db
    .insert(WorldEntryTable)
    .values({ id: entryId, novel_id: novelId, category: "地理", title: "青云宗", content: "位于东洲。" })
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

async function insertConflict(partial: { world_entry_id?: string; conflict_note?: string; conflict_kind?: string } = {}) {
  const db = getDb()
  const id = crypto.randomUUID()
  await db
    .insert(WorldEntryConflictTable)
    .values({
      id,
      novel_id: novelId,
      world_entry_id: partial.world_entry_id ?? entryId,
      conflict_kind: partial.conflict_kind ?? "number_inconsistency",
      source_chapter_id: null,
      conflict_note: partial.conflict_note ?? "正文称弟子三千，条目记为八百",
      created_at: Date.now(),
    })
    .run()
  return id
}

describe("listConflicts", () => {
  test("默认列未解决冲突并带条目标题；处理后移出默认列表", async () => {
    const idA = await insertConflict()
    const idB = await insertConflict({ conflict_note: "同义词漂移：掌门/宗主混用", conflict_kind: "synonym_drift" })
    const unresolved = await listConflicts(getDb(), { novelId })
    expect(unresolved.total).toBe(2)
    expect(unresolved.rows.map((r) => r.id)).toEqual(expect.arrayContaining([idA, idB]))
    expect(unresolved.rows[0]?.entry_title).toBe("青云宗")

    await resolveConflict(getDb(), idA, { action: "keep_current", note: "以条目为准" })
    const after = await listConflicts(getDb(), { novelId })
    expect(after.total).toBe(1)
    const resolved = await listConflicts(getDb(), { novelId, status: "resolved" })
    expect(resolved.total).toBe(1)
    expect(resolved.rows[0]?.id).toBe(idA)

    // 分页
    const page = await listConflicts(getDb(), { novelId, limit: 1, offset: 0 })
    expect(page.rows.length).toBe(1)
  })
})

describe("resolveConflict", () => {
  test("保留现状：记录 ignored 留痕，不产生草案", async () => {
    const id = await insertConflict()
    const result = await resolveConflict(getDb(), id, { action: "keep_current", note: "条目数据更权威" })
    expect(result.ok).toBe(true)
    const db = getDb()
    const [row] = await db.select().from(WorldEntryConflictTable).where(eq(WorldEntryConflictTable.id, id)).all()
    expect(row?.resolved).toBe(1)
    expect(row?.resolution_kind).toBe("ignored")
    expect(row?.resolution_note).toBe("条目数据更权威")
    expect(row?.resolved_at).not.toBeNull()
    const staged = await db.select().from(StagedChangeTable).all()
    expect(staged.length).toBe(0)
  })

  test("按正文更新：冲突留痕 update_draft 并生成暂存草案", async () => {
    const id = await insertConflict()
    const result = await resolveConflict(getDb(), id, {
      action: "update_entry",
      content: "青云宗弟子三千。\n\n护山大阵由历代掌门维护。",
      source: "agent",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staged_change_id).toBeTruthy()

    const db = getDb()
    const [conflictRow] = await db.select().from(WorldEntryConflictTable).where(eq(WorldEntryConflictTable.id, id)).all()
    expect(conflictRow?.resolved).toBe(1)
    expect(conflictRow?.resolution_kind).toBe("update_draft")
    const [staged] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, result.staged_change_id!)).all()
    expect(staged?.status).toBe("pending")
    expect(staged?.entity_type).toBe("world_entry")
    expect(staged?.source).toBe("agent")
    expect(JSON.parse(staged?.entry_ids ?? "[]")).toEqual([entryId])
    expect(JSON.parse(staged?.after_json ?? "{}").content).toContain("弟子三千")
    expect(JSON.parse(staged?.before_json ?? "{}").title).toBe("青云宗")
    expect(JSON.parse(staged?.evidence_json ?? "{}").conflict_id).toBe(id)
    expect(staged?.reason).toContain("弟子三千")
  })

  test("update_entry 缺内容报错；重复处理报错", async () => {
    const id = await insertConflict()
    const noContent = await resolveConflict(getDb(), id, { action: "update_entry" })
    expect(noContent.ok).toBe(false)
    if (!noContent.ok) expect(noContent.error).toContain("需要提供草案内容")

    await resolveConflict(getDb(), id, { action: "keep_current" })
    const again = await resolveConflict(getDb(), id, { action: "keep_current" })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).toContain("不可重复处理")
  })

  test("update_entry 草案含 Markdown 时格式校验失败", async () => {
    const id = await insertConflict()
    const result = await resolveConflict(getDb(), id, { action: "update_entry", content: "正文有 **加粗** 标记。" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("不是纯文本格式")
  })
})
