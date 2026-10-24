import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Effect } from "effect"
import { eq, sql } from "drizzle-orm"
import { ChapterTable, MemoryFactTable, NovelTable, closeDb, getDb } from "@opennovel-ai/novel-store"
import { ChapterNotFoundError } from "@opennovel-ai/protocol/groups/novel"
import {
  approveMemoryFact,
  createMemoryFact,
  editMemoryFact,
  listMemoryFacts,
  memoryFactCounts,
  memoryMaintenance,
  retireMemoryFact,
  unmergeMemoryFact,
} from "../src/memory-facts"

let projectDir: string
let novelId: string
const chapterId = "ch-1"

/** 直插记忆卡 + FTS 行（模拟 observer 写入路径的应用级同步惯例） */
function insertFact(id: string, overrides: Partial<typeof MemoryFactTable.$inferInsert> = {}) {
  const db = getDb(projectDir)
  const now = Date.now()
  const row = {
    id,
    novel_id: novelId,
    chapter_id: chapterId,
    fact_type: "timeline",
    quote: null,
    entity_hint: null,
    text: `事实 ${id}`,
    status: "pending",
    confidence: 50,
    proof_count: 1,
    created_by: "observer",
    created_at: now,
    updated_at: now,
    ...overrides,
  }
  db.insert(MemoryFactTable).values(row).run()
  db.run(
    sql`INSERT INTO memory_fact_fts (novel_id, fact_id, text, quote) VALUES (${novelId}, ${id}, ${row.text}, ${row.quote ?? ""})`,
  )
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "memory-facts-"))
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "记忆卡测试小说",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  db.insert(ChapterTable).values({
    id: chapterId,
    novel_id: novelId,
    title: "第一章",
    order: 1,
    created_at: now,
    updated_at: now,
  }).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 FTS5 写路径的句柄释放有延迟（FTS 写入后 rm 必 EBUSY，已最小复现验证），进程退出后系统回收
  }
})

describe("memory-facts HTTP 业务实现", () => {
  test("列表：状态过滤与分页", async () => {
    insertFact("f-p1")
    insertFact("f-p2")
    insertFact("f-r1", { status: "reviewed" })
    insertFact("f-a1", { status: "approved" })

    const pendingOnly = await Effect.runPromise(listMemoryFacts(novelId, projectDir, { status: "pending" }))
    expect(pendingOnly.items.map((i) => i.id).sort()).toEqual(["f-p1", "f-p2"])
    expect(pendingOnly.total).toBe(2)

    const page1 = await Effect.runPromise(listMemoryFacts(novelId, projectDir, { limit: 3, offset: 0 }))
    const page2 = await Effect.runPromise(listMemoryFacts(novelId, projectDir, { limit: 3, offset: 3 }))
    expect(page1.items).toHaveLength(3)
    expect(page1.total).toBe(4)
    expect(page2.items).toHaveLength(1)
    // 分页不重复不遗漏
    expect(new Set([...page1.items, ...page2.items].map((i) => i.id)).size).toBe(4)
    // 出处章序随列表带出（leftJoin chapters）
    expect(page1.items[0]?.chapterOrder).toBe(1)
  })

  test("计数徽标口径：total = pending + reviewed + stale", async () => {
    insertFact("f-p1")
    insertFact("f-r1", { status: "reviewed" })
    insertFact("f-s1", { status: "stale" })
    insertFact("f-a1", { status: "approved" })
    insertFact("f-t1", { status: "retired" })

    const counts = await Effect.runPromise(memoryFactCounts(novelId, projectDir))
    expect(counts).toEqual({ pending: 1, reviewed: 1, stale: 1, total: 3 })
  })

  test("手记创建：created_by=author 落 pending，FTS 可检索", async () => {
    const created = await Effect.runPromise(
      createMemoryFact(novelId, projectDir, { text: "主角的真实身份是前朝遗孤", chapterId, quote: "他摸了摸那块旧玉佩" }),
    )
    expect(created).toMatchObject({ ok: true, status: "pending" })

    const db = getDb(projectDir)
    const row = db.select().from(MemoryFactTable).where(eq(MemoryFactTable.id, created.factId!)).get()
    expect(row).toMatchObject({ created_by: "author", fact_type: "note", status: "pending", chapter_id: chapterId })

    const hits = await Effect.runPromise(listMemoryFacts(novelId, projectDir, { q: "前朝遗孤" }))
    expect(hits.items.map((i) => i.id)).toEqual([created.factId])
  })

  test("手记创建：章节不属本书返回 ChapterNotFoundError", async () => {
    const error = await Effect.runPromise(
      Effect.flip(createMemoryFact(novelId, projectDir, { text: "挂到别书章节", chapterId: "ch-x" })),
    )
    expect(error).toBeInstanceOf(ChapterNotFoundError)
  })

  test("编辑：text 变更同步 FTS，entity_hint 可修正与清除", async () => {
    insertFact("f-e1", { text: "沈辞获得玄铁剑" })

    const edited = await Effect.runPromise(editMemoryFact(novelId, projectDir, "f-e1", { text: "沈辞获得青冥剑", entityHint: "沈辞" }))
    expect(edited).toMatchObject({ ok: true, status: "pending" })

    const newHits = await Effect.runPromise(listMemoryFacts(novelId, projectDir, { q: "青冥剑" }))
    expect(newHits.items.map((i) => i.id)).toEqual(["f-e1"])
    const oldHits = await Effect.runPromise(listMemoryFacts(novelId, projectDir, { q: "玄铁剑" }))
    expect(oldHits.items).toHaveLength(0)

    const db = getDb(projectDir)
    expect(db.select().from(MemoryFactTable).where(eq(MemoryFactTable.id, "f-e1")).get()?.entity_hint).toBe("沈辞")

    await Effect.runPromise(editMemoryFact(novelId, projectDir, "f-e1", { entityHint: null }))
    expect(db.select().from(MemoryFactTable).where(eq(MemoryFactTable.id, "f-e1")).get()?.entity_hint).toBeNull()
  })

  test("批准：pending/reviewed 直达 approved，其余状态报状态冲突", async () => {
    insertFact("f-p1")
    insertFact("f-r1", { status: "reviewed" })
    insertFact("f-s1", { status: "stale" })
    insertFact("f-a1", { status: "approved" })

    expect(await Effect.runPromise(approveMemoryFact(novelId, projectDir, "f-p1"))).toMatchObject({ ok: true, status: "approved" })
    expect(await Effect.runPromise(approveMemoryFact(novelId, projectDir, "f-r1"))).toMatchObject({ ok: true, status: "approved" })

    const stale = await Effect.runPromise(approveMemoryFact(novelId, projectDir, "f-s1"))
    expect(stale.ok).toBe(false)
    expect(stale.error).toContain("stale")
    const again = await Effect.runPromise(approveMemoryFact(novelId, projectDir, "f-a1"))
    expect(again.ok).toBe(false)
    const missing = await Effect.runPromise(approveMemoryFact(novelId, projectDir, "f-x"))
    expect(missing.ok).toBe(false)
  })

  test("作废：留痕不删行，重复作废报状态冲突", async () => {
    insertFact("f-p1")

    expect(await Effect.runPromise(retireMemoryFact(novelId, projectDir, "f-p1"))).toMatchObject({ ok: true, status: "retired" })

    const db = getDb(projectDir)
    const row = db.select().from(MemoryFactTable).where(eq(MemoryFactTable.id, "f-p1")).get()
    expect(row).toMatchObject({ status: "retired", retired_into: null })

    const again = await Effect.runPromise(retireMemoryFact(novelId, projectDir, "f-p1"))
    expect(again.ok).toBe(false)
  })

  test("撤销合并：带留痕被并卡回 pending 并清留痕；普通 retired 卡拒绝", async () => {
    insertFact("f-kept", { status: "approved" })
    insertFact("f-merged", { status: "retired", retired_into: "f-kept" })
    insertFact("f-plain-retired", { status: "retired" })

    const unmerged = await Effect.runPromise(unmergeMemoryFact(novelId, projectDir, "f-merged"))
    expect(unmerged).toMatchObject({ ok: true, status: "pending" })
    const db = getDb(projectDir)
    expect(db.select().from(MemoryFactTable).where(eq(MemoryFactTable.id, "f-merged")).get()).toMatchObject({
      status: "pending",
      retired_into: null,
    })

    const plain = await Effect.runPromise(unmergeMemoryFact(novelId, projectDir, "f-plain-retired"))
    expect(plain.ok).toBe(false)
    const active = await Effect.runPromise(unmergeMemoryFact(novelId, projectDir, "f-kept"))
    expect(active.ok).toBe(false)
  })

  test("维护报告端点：僵尸卡清单 + 滞留阈值透传", async () => {
    insertFact("f-s1", { status: "stale" })
    insertFact("f-t1", { status: "retired" })

    const report = await Effect.runPromise(memoryMaintenance(novelId, projectDir))
    expect(report.stalledThreshold).toBe(10)
    expect(report.zombieFacts).toEqual([{ id: "f-s1", chapterOrder: 1, text: "事实 f-s1" }])
    expect(report.retiredStats.facts).toBe(1)
  })
})
