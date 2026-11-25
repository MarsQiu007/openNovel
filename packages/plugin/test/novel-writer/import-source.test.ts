/**
 * source_import 工具测试（原文驱动导入编排）。
 *
 * 覆盖：status 进度与阶段、read 预算与硬上限、commit 校验/幂等/暂停拒绝、
 * plan 校准判定与四类重规划证据、mark_stage、finalize 收尾门禁。
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string
let tools: ReturnType<typeof createWritingTools>
let jobId: string
let novelId: string

const PARA = "甲乙丙丁戊己庚辛壬癸" // 10 字
const BOOK_20 = Array.from({ length: 20 }, (_, i) => PARA + i).join("\n")
const BOOK_WITH_HEADS = [
  "第一章 风起",
  PARA + "0",
  PARA + "1",
  "第二章 云涌",
  PARA + "2",
  PARA + "3",
].join("\n")

function freshDir() {
  projectDir = join(tmpdir(), "novel-import-source-" + Date.now() + "-" + Math.random().toString(36).slice(2))
  mkdirSync(projectDir, { recursive: true })
}

async function createBook(raw: string, options: Record<string, unknown> = {}) {
  const { getDb, NovelTable, withTransaction, createImportJobTx } = await import("../../src/novel-writer/session-store.js")
  const db = getDb(projectDir)
  novelId = "novel-" + Math.random().toString(36).slice(2)
  db.insert(NovelTable).values({ id: novelId, title: "导入书", genre: "玄幻", synopsis: "", status: "draft" }).run()
  jobId = withTransaction(db, (tx) =>
    createImportJobTx(tx, {
      novelId,
      filename: "book.txt",
      encoding: "utf-8",
      sourceHash: "hash-" + Math.random(),
      rawText: raw,
      options: { targetChapterChars: 3000, repairLevel: "standard", ...options },
    }),
  )
}

const ctx = () => createToolContext(projectDir)

function call(action: string, extra: Record<string, unknown> = {}) {
  return tools.source_import.execute({ action, job_id: jobId, ...extra }, ctx())
}

function parsed(result: unknown) {
  return JSON.parse(result as string) as Record<string, unknown>
}

function draft(order: number, startIndex: number, count: number, extra: Record<string, unknown> = {}) {
  return {
    title: "第" + order + "章",
    volume_title: null,
    chapter_order: order,
    ops: Array.from({ length: count }, (_, i) => ({ kind: "keep", source: startIndex + i })),
    carry: [] as number[],
    window_size: count,
    ...extra,
  }
}

beforeEach(() => {
  freshDir()
  tools = createWritingTools()
})

describe("source_import status/read", () => {
  test("status 返回进度、carry、章节阶段与硬预算", async () => {
    await createBook(BOOK_20)
    await call("commit", { draft: draft(1, 0, 2) })
    const status = parsed(await call("status"))
    expect(status.ok).toBe(true)
    expect(status.chapter_count).toBe(1)
    expect(status.processed_chars).toBeGreaterThan(0)
    expect(status.hard_budget).toMatchObject({ used: 0 })
    const chapters = status.chapters as Array<Record<string, unknown>>
    expect(chapters[0].settings_stage).toBe("pending")
  })

  test("read 返回 carry、本批段落、章题 hint 并累计硬预算", async () => {
    await createBook(BOOK_WITH_HEADS)
    const first = parsed(await call("read", { max_chars: 30 }))
    expect(first.ok).toBe(true)
    expect(first.carry).toEqual([])
    const fresh = first.fresh as Array<Record<string, unknown>>
    expect(fresh.length).toBeGreaterThan(1)
    const hints = first.title_hints as Array<Record<string, unknown>>
    expect(hints.some((h) => h.kind === "chapter" && h.title === "风起")).toBe(true)
    const used1 = (first.hard_budget as Record<string, number>).used
    expect(used1).toBeGreaterThan(0)
    const second = parsed(await call("read", { max_chars: 30 }))
    expect(second.ok).toBe(true)
    const used2 = (second.hard_budget as Record<string, number>).used
    expect(used2).toBeGreaterThan(used1)
  })

  test("carry 段落进入下一次 read 窗口", async () => {
    await createBook(BOOK_20)
    await call("commit", { draft: { ...draft(1, 0, 2), carry: [2], window_size: 3 } })
    const next = parsed(await call("read", { max_chars: 40 }))
    expect(next.ok).toBe(true)
    const carry = next.carry as Array<Record<string, unknown>>
    expect(carry.map((p) => p.index)).toEqual([2])
  })

  test("暂停后推进类动作被拒绝，status 仍可读", async () => {
    await createBook(BOOK_20)
    const { getDb, withTransaction, updateImportJobTx } = await import("../../src/novel-writer/session-store.js")
    withTransaction(getDb(projectDir), (tx) => updateImportJobTx(tx, jobId, { status: "paused" }))
    expect(parsed(await call("status")).status).toBe("paused")
    await expect(call("read", { max_chars: 100 })).rejects.toThrow("导入已暂停")
    await expect(call("commit", { draft: draft(1, 0, 2) })).rejects.toThrow("导入已暂停")
  })

  test("硬预算耗尽返回可操作错误且游标不动", async () => {
    await createBook(BOOK_20)
    const { getDb, withTransaction, updateImportJobTx } = await import("../../src/novel-writer/session-store.js")
    withTransaction(getDb(projectDir), (tx) =>
      updateImportJobTx(tx, jobId, { stats_json: JSON.stringify({ readCharsTotal: 120_000 }) }),
    )
    const result = parsed(await call("read", { max_chars: 1000 }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe("hard-budget-exhausted")
    expect(String(result.message)).toContain("block_item")
    const status = parsed(await call("status"))
    expect(status.next_paragraph_index).toBe(0)
  })
})

describe("source_import commit", () => {
  test("校验失败拒绝提交且游标不动", async () => {
    await createBook(BOOK_20)
    await expect(call("commit", { draft: draft(1, 0, 99) })).rejects.toThrow("草稿校验失败")
    const status = parsed(await call("status"))
    expect(status.chapter_count).toBe(0)
    expect(status.next_paragraph_index).toBe(0)
  })

  test("相同重试返回幂等回放，冲突提交被拒绝", async () => {
    await createBook(BOOK_20)
    const first = parsed(await call("commit", { draft: draft(1, 0, 2) }))
    expect(first.idempotent_replay).toBe(false)
    const replay = parsed(await call("commit", { draft: draft(1, 0, 2) }))
    expect(replay.idempotent_replay).toBe(true)
    await expect(call("commit", { draft: draft(1, 3, 2) })).rejects.toThrow("冲突")
    const status = parsed(await call("status"))
    expect(status.chapter_count).toBe(1)
  })

  test("关闭正文修复时 merge 被拒绝", async () => {
    await createBook(BOOK_20, { repairLevel: "off" })
    const merged = {
      title: "第一章",
      volume_title: null,
      chapter_order: 1,
      ops: [{ kind: "merge", source: [0, 1], separator: "" }],
      carry: [] as number[],
      window_size: 2,
    }
    await expect(call("commit", { draft: merged })).rejects.toThrow("repair-disabled")
    const kept = parsed(await call("commit", { draft: draft(1, 0, 2) }))
    expect(kept.ok).toBe(true)
  })
})

describe("source_import plan", () => {
  test("校准阈值前 first_plan 被拒绝", async () => {
    await createBook(BOOK_20)
    await call("commit", { draft: draft(1, 0, 2) })
    await expect(call("plan", { reason: "first_plan" })).rejects.toThrow("校准阈值")
  })

  test("处置比例达 25% 但不足 3 章时仍不校准", async () => {
    // 两章吃完全书（每章 10 段 × 10 字）：比例 100% ≥ 25%，但章节数 < 3
    const twoChapterRaw = Array.from({ length: 20 }, (_, i) => PARA + i).join("\n")
    await createBook(twoChapterRaw)
    await call("commit", { draft: draft(1, 0, 10) })
    const second = parsed(await call("commit", { draft: draft(2, 10, 10) }))
    expect(second.signal.calibrationReached).toBe(false)
    const status = parsed(await call("status"))
    expect(status.calibration_reached).toBe(false)
    expect(status.source_exhausted).toBe(true)
    await expect(call("plan", { reason: "first_plan" })).rejects.toThrow("校准阈值")
  })
  test("达到 25% 且至少 3 章后 first_plan 生成剩余任务并记录版本", async () => {
    await createBook(BOOK_20)
    await call("commit", { draft: draft(1, 0, 2) })
    await call("commit", { draft: draft(2, 2, 2) })
    const third = parsed(await call("commit", { draft: draft(3, 4, 2) }))
    expect(third.signal).toMatchObject({ calibrationReached: true })
    expect(String(third.guidance)).toContain("first_plan")
    const plan = parsed(await call("plan", { reason: "first_plan" }))
    expect(plan.ok).toBe(true)
    expect(plan.plan_version).toBe(1)
    expect(plan.planned_count).toBeGreaterThan(0)
    const items = plan.items as string[]
    expect(items.length).toBe(plan.planned_count)
    expect(items[0]).toContain("第 4 章")
    const status = parsed(await call("status"))
    const history = status.plan_history as Array<Record<string, unknown>>
    expect(history).toHaveLength(1)
    expect(history[0].reason).toBe("first_plan")
  })

  test("structure_invalidated 必须携带证据", async () => {
    await createBook(BOOK_20)
    await call("commit", { draft: draft(1, 0, 2) })
    await call("commit", { draft: draft(2, 2, 2) })
    await call("commit", { draft: draft(3, 4, 2) })
    await call("plan", { reason: "first_plan" })
    await expect(call("plan", { reason: "structure_invalidated" })).rejects.toThrow("证据")
    const ok = parsed(await call("plan", { reason: "structure_invalidated", evidence: "第三卷卷题出现在第 5 章之后" }))
    expect(ok.plan_version).toBe(2)
  })

  test("原文未耗尽时 source_exhausted 被拒绝", async () => {
    await createBook(BOOK_20)
    await expect(call("plan", { reason: "source_exhausted" })).rejects.toThrow("尚未处置完")
  })
})

describe("source_import finalize", () => {
  async function finishAllStages() {
    const status = parsed(await call("status"))
    const chapters = status.chapters as Array<Record<string, unknown>>
    for (const c of chapters) {
      await call("mark_stage", { chapter_order: c.chapter_order, stage: "settings" })
      await call("mark_stage", { chapter_order: c.chapter_order, stage: "technique" })
    }
  }

  test("未消费原文时禁止完成", async () => {
    await createBook(BOOK_20)
    await call("commit", { draft: draft(1, 0, 2) })
    await expect(call("finalize")).rejects.toThrow("未消费原文")
  })

  test("阶段未齐时禁止完成", async () => {
    await createBook(BOOK_20.slice(0, 30))
    await call("commit", { draft: draft(1, 0, 2) })
    await call("commit", { draft: draft(2, 2, 1) })
    await expect(call("finalize")).rejects.toThrow("mark_stage")
  })

  test("简介为空时禁止完成", async () => {
    await createBook(BOOK_20.slice(0, 30))
    await call("commit", { draft: draft(1, 0, 2) })
    await call("commit", { draft: draft(2, 2, 1) })
    await finishAllStages()
    await expect(call("finalize")).rejects.toThrow("简介")
  })

  test("全部就绪后完成导入并返回统一报告", async () => {
    await createBook(BOOK_20.slice(0, 30))
    await call("commit", { draft: draft(1, 0, 2) })
    await call("commit", { draft: draft(2, 2, 1) })
    await finishAllStages()
    const { getDb, NovelTable } = await import("../../src/novel-writer/session-store.js")
    getDb(projectDir).update(NovelTable).set({ synopsis: "一本测试书" }).where(eq(NovelTable.id, novelId)).run()
    const done = parsed(await call("finalize"))
    expect(done.ok).toBe(true)
    expect(done.report).toMatchObject({ chapterCount: 2 })
    expect(String(done.summary)).toContain("导入完成")
    expect(parsed(await call("status")).status).toBe("completed")
  })
})


