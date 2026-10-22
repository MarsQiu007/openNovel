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
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import type { ToolContext } from "../../src/v2/effect/tool.js"

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

describe("list_conflicts / resolve_conflict tools", () => {
  const toolDir = join(tmpdir(), `novel-review-conflict-tools-${Date.now()}`)
  let tools: ReturnType<typeof createWritingTools>

  function toolCtx(): ToolContext {
    return createToolContext(toolDir, { sessionID: "ses-conflict-tools" })
  }

  beforeAll(async () => {
    mkdirSync(join(toolDir, ".novel"), { recursive: true })
    const toolNovelId = crypto.randomUUID()
    const toolEntryId = crypto.randomUUID()
    const db = getDb(toolDir)
    await db
      .insert(NovelTable)
      .values({ id: toolNovelId, title: "冲突工具测试小说", genre: "玄幻", synopsis: "", status: "draft" })
      .run()
    await db
      .insert(WorldEntryTable)
      .values({ id: toolEntryId, novel_id: toolNovelId, category: "地理", title: "北境雪原", content: "常年风雪。" })
      .run()
    await db
      .insert(WorldEntryConflictTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: toolNovelId,
        world_entry_id: toolEntryId,
        conflict_kind: "semantic_conflict",
        conflict_note: "雪原范围与第二章描述不一致",
        created_at: Date.now(),
      })
      .run()
    tools = createWritingTools()
  })

  afterAll(() => {
    try {
      rmSync(toolDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
    }
  })

  test("list_conflicts 列出未解决冲突并附条目标题", async () => {
    const tool = tools
    const novel = (await getDb(toolDir).select().from(NovelTable).all()).at(-1)!
    const result = await tool.list_conflicts!.execute({ novel_id: novel.id }, toolCtx())
    expect(result.output).toContain("北境雪原")
    expect(result.output).toContain("雪原范围与第二章描述不一致")
  })

  test("resolve_conflict keep_current 留痕并移出未解决列表", async () => {
    const tool = tools
    const db = getDb(toolDir)
    const novelId = (await db.select().from(NovelTable).all()).at(-1)!.id
    const listed = await tool.list_conflicts!.execute({ novel_id: novelId }, toolCtx())
    const items = (listed.metadata as { items: { id: string }[] }).items
    expect(items.length).toBe(1)
    const result = await tool.resolve_conflict!.execute(
      { conflict_id: items[0]!.id, action: "keep_current", note: "以条目为准" },
      toolCtx(),
    )
    expect(result.output).toContain("保留现状")
    const [row] = await db.select().from(WorldEntryConflictTable).where(eq(WorldEntryConflictTable.id, items[0]!.id)).all()
    expect(row?.resolution_kind).toBe("ignored")
    const after = await tool.list_conflicts!.execute({ novel_id: novelId }, toolCtx())
    expect(after.output).toContain("无 未解决冲突")
  })

  test("resolve_conflict update_entry 生成 agent 来源暂存草案", async () => {
    const tool = tools
    const db = getDb(toolDir)
    const conflictId = crypto.randomUUID()
    const novelId = (await db.select().from(NovelTable).all()).at(-1)!.id
    const entryId = (await db.select().from(WorldEntryTable).all()).at(-1)!.id
    await db
      .insert(WorldEntryConflictTable)
      .values({
        id: conflictId,
        novel_id: novelId,
        world_entry_id: entryId,
        conflict_kind: "semantic_conflict",
        conflict_note: "雪原边界描述冲突",
        created_at: Date.now(),
      })
      .run()
    const result = await tool.resolve_conflict!.execute(
      { conflict_id: conflictId, action: "update_entry", content: "北境雪原横贯大陆北疆，常年风雪不歇。" },
      toolCtx(),
    )
    expect(result.output).toContain("暂存草案")
    const stagedId = (result.metadata as { staged_change_id: string }).staged_change_id
    const [staged] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, stagedId)).all()
    expect(staged?.source).toBe("agent")
    expect(staged?.status).toBe("pending")
  })
})
