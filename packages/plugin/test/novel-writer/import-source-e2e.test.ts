/**
 * 原文驱动导入集成夹具（source-driven-import 6.1/6.2）：
 * 真实书稿形态端到端——常规章题、连续对话断段、局部乱序、错字与噪声、
 * 卷题归属、25% 校准、首次标题计划、source_exhausted / work_remaining 尾部修正、
 * 响应丢失幂等重放、章节提交后退出（新工具实例）恢复与最终原文全覆盖。
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { join } from "path"
import { mkdirSync } from "fs"
import { tmpdir } from "os"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import type { NovelImportRepairLevel } from "@opennovel-ai/schema/novel"

let projectDir: string
let tools: ReturnType<typeof createWritingTools>
let jobId: string
let novelId: string

// 书稿 A：常规章题 + 连续对话断段 + 错字 + 广告/机械重复噪声 + 局部乱序 + 卷题
const BOOK_A = [
  "第一卷 风起",
  "第一章 夜色",
  "夜风掠过青阳镇的屋檐，带着初冬的凉意。",
  "「你来了。」她说。",
  "「我来了。」",
  "灯火次第亮起，长街尽头传来马蹄声。",
  "云诵翻涌，山雨欲来。",
  "第二章 晨光",
  "晨光微亮，驿站外积了一层薄霜。",
  "请记住本书首发域名 www.qidian.example 免费阅读",
  "晨光微亮，驿站外积了一层薄霜。",
  "他翻开手里的旧地图，指尖停在西山口。",
  "老矿工信誓旦旦地拍着胸口。",
  "「矿脉在地下三百尺。」他说。",
  "第三章 雷鸣",
  "雷声滚过峡谷，惊起一群寒鸦。",
  "雨点砸在帐篷上，像密集的鼓点。",
  "少年握紧刀柄，望向漆黑的山道。",
  "第四章 归途",
  "雨后初晴，山路泥泞难行。",
  "商队重新启程，铃声渐远。",
  "他回头望了一眼青阳镇的方向。",
  "天边挂起一道淡淡的彩虹。",
].join("\n")

function freshDir() {
  projectDir = join(tmpdir(), "novel-import-e2e-" + Date.now() + "-" + Math.random().toString(36).slice(2))
  mkdirSync(projectDir, { recursive: true })
}

async function createBook(raw: string, options: Record<string, unknown> = {}) {
  const { getDb, NovelTable, withTransaction, createImportJobTx } = await import("../../src/novel-writer/session-store.js")
  const db = getDb(projectDir)
  novelId = "novel-e2e-" + Math.random().toString(36).slice(2)
  db.insert(NovelTable).values({ id: novelId, title: "集成书稿", genre: "玄幻", synopsis: "", status: "draft" }).run()
  jobId = withTransaction(db, (tx) =>
    createImportJobTx(tx, {
      novelId,
      filename: "book.txt",
      encoding: "utf-8",
      sourceHash: "hash-e2e",
      rawText: raw,
      options: { targetChapterChars: 3000, repairLevel: "standard", ...options },
    }),
  )
}

const ctx = () => createToolContext(projectDir)

function call(action: string, extra: Record<string, unknown> = {}) {
  return tools.source_import.execute({ action, job_id: jobId, ...extra }, ctx())
}

const parsed = (result: unknown) => JSON.parse(result as string) as Record<string, unknown>

function keep(source: number, reason?: string) {
  return reason === undefined ? { kind: "keep", source } : { kind: "keep", source, reason }
}
function exclude(source: number, category: string, reason: string) {
  return { kind: "exclude", source, category, reason }
}
function draft(input: {
  order: number
  title: string
  volumeTitle?: string
  ops: Record<string, unknown>[]
  carry: number[]
  windowSize: number
}) {
  return {
    title: input.title,
    volume_title: input.volumeTitle ?? null,
    chapter_order: input.order,
    ops: input.ops,
    carry: input.carry,
    window_size: input.windowSize,
  }
}

beforeEach(() => {
  freshDir()
  tools = createWritingTools()
})

describe("原文驱动导入集成夹具（书稿 A）", () => {
  test("章题/卷题、连续对话断段、乱序、错字、噪声、25% 校准、source_exhausted 收尾与崩溃恢复", async () => {
    await createBook(BOOK_A)
    const { getDb, NovelTable, ChapterTable, withTransaction, updateImportJobTx } = await import("../../src/novel-writer/session-store.js")

    // 首轮阅读：整书入窗，标题 hint 识别卷题与四个章题
    const first = parsed(await call("read", { max_chars: 20_000 }))
    expect(first.title_hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paragraph: 0, kind: "volume" }),
        expect.objectContaining({ paragraph: 1, kind: "chapter", title: "夜色" }),
        expect.objectContaining({ paragraph: 18, kind: "chapter", title: "归途" }),
      ]),
    )

    // 第 1 章：卷题归属 + 连续对话 merge + 错字 replace；其余 carry
    const ch1 = await call("commit", {
      draft: draft({
        order: 1,
        title: "第一章 夜色",
        volumeTitle: "第一卷 风起",
        ops: [
          exclude(0, "heading", "卷题归入标题"),
          exclude(1, "heading", "章题归入标题"),
          keep(2),
          { kind: "merge", source: [3, 4], separator: "", reason: "连续对话断段" },
          keep(5),
          { kind: "replace", source: 6, original: "云诵", replacement: "云涌", category: "typo", reason: "错字：云诵→云涌" },
        ],
        carry: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
        windowSize: 23,
      }),
    })
    expect(parsed(ch1).idempotent_replay).toBe(false)

    // 响应丢失：相同提交重放返回幂等结果，不重复建章
    const replay = parsed(await call("commit", {
      draft: draft({
        order: 1,
        title: "第一章 夜色",
        volumeTitle: "第一卷 风起",
        ops: [
          exclude(0, "heading", "卷题归入标题"),
          exclude(1, "heading", "章题归入标题"),
          keep(2),
          { kind: "merge", source: [3, 4], separator: "", reason: "连续对话断段" },
          keep(5),
          { kind: "replace", source: 6, original: "云诵", replacement: "云涌", category: "typo", reason: "错字：云诵→云涌" },
        ],
        carry: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
        windowSize: 23,
      }),
    }))
    expect(replay.idempotent_replay).toBe(true)
    expect(parsed(await call("status")).chapter_count).toBe(1)

    // 第 2 章：噪声排除（广告 + 机械重复）+ 局部乱序（先矿脉后老矿工）
    await call("commit", {
      draft: draft({
        order: 2,
        title: "第二章 晨光",
        ops: [
          exclude(7, "heading", "章题归入标题"),
          keep(8),
          exclude(9, "ad", "广告行"),
          exclude(10, "duplicate", "机械重复行"),
          keep(11),
          keep(13, "乱序：矿脉句应在老矿工之后，调整为先矿脉后老矿工"),
          keep(12),
        ],
        carry: [14, 15, 16, 17, 18, 19, 20, 21, 22],
        windowSize: 0,
      }),
    })

    // 章节提交后退出（进程重启）：新工具实例读持久化状态，只补未完成阶段
    tools = createWritingTools()
    const resumed = parsed(await call("status"))
    expect(resumed.chapter_count).toBe(2)
    expect(resumed.next_paragraph_index).toBe(23) // 首轮 23 段已全部读过，未处置部分由 carry 表达
    const stages = (resumed.chapters as Array<Record<string, unknown>>).map((c) => c.settings_stage)
    expect(stages).toEqual(["pending", "pending"])
    expect(parsed(await call("read", { max_chars: 20_000 })).carry).toHaveLength(9)

    // 第 3 章：提交后首次达到 25% 且 ≥3 章 → 校准达标
    const ch3 = parsed(await call("commit", {
      draft: draft({
        order: 3,
        title: "第三章 雷鸣",
        ops: [exclude(14, "heading", "章题归入标题"), keep(15), keep(16), keep(17)],
        carry: [18, 19, 20, 21, 22],
        windowSize: 0,
      }),
    }))
    expect(ch3.signal).toMatchObject({ calibrationReached: true, sourceExhausted: false })

    // 首次计划：剩余段落含「第四章 归途」→ 标题计划
    const plan = parsed(await call("plan", { reason: "first_plan" }))
    expect(plan.plan_version).toBe(1)
    expect(plan.items).toEqual(["第 4 章《归途》"])

    // 第 4 章：全部原文处置完毕 → source_exhausted
    const ch4 = parsed(await call("commit", {
      draft: draft({
        order: 4,
        title: "第四章 归途",
        ops: [exclude(18, "heading", "章题归入标题"), keep(19), keep(20), keep(21), keep(22)],
        carry: [],
        windowSize: 0,
      }),
    }))
    expect(ch4.signal.sourceExhausted).toBe(true)

    // 尾部修正一（source_exhausted）：取消多余占位，只保留收尾任务
    const tail = parsed(await call("plan", { reason: "source_exhausted" }))
    expect(tail.items).toEqual(["书籍简介生成", "汇总汇报"])
    expect(tail.plan_version).toBe(2)

    // 阶段补齐（书籍简介生成 → update_novel 语义：直接写简介）后 finalize
    for (const order of [1, 2, 3, 4]) {
      await call("mark_stage", { chapter_order: order, stage: "settings" })
      await call("mark_stage", { chapter_order: order, stage: "technique" })
    }
    getDb(projectDir).update(NovelTable).set({ synopsis: "青阳镇少年西行寻矿的旅途。" }).where(eq(NovelTable.id, novelId)).run()
    const done = parsed(await call("finalize"))
    expect(done.ok).toBe(true)
    expect(done.report).toMatchObject({
      chapterCount: 4,
      planVersion: 2,
      opCounts: expect.objectContaining({ merge: 1, replace: 1, move: 1 }),
    })
    // 排除内容只含广告与机械重复（章题/卷题属结构处置，不列入用户-facing 排除）
    const excluded = (done.report as Record<string, unknown>).excluded as Array<Record<string, unknown>>
    expect(excluded).toHaveLength(2)
    expect(excluded.map((item) => item.reason).sort()).toEqual(["广告行", "机械重复行"])

    // 最终原文全覆盖：正式章节内容含修复结果（merge 对话 + replace 错字 + move 顺序）
    const chapters = getDb(projectDir)
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novelId))
      .all()
    expect(chapters).toHaveLength(4)
    const ch1Content = chapters.find((c) => c.order === 1)?.content ?? ""
    expect(ch1Content).toContain("「你来了。」她说。「我来了。」")
    expect(ch1Content).toContain("云涌翻涌")
    expect(ch1Content).not.toContain("云诵")
    const ch2Content = chapters.find((c) => c.order === 2)?.content ?? ""
    expect(ch2Content.indexOf("矿脉在地下三百尺")).toBeGreaterThanOrEqual(0)
    expect(ch2Content.indexOf("矿脉在地下三百尺")).toBeLessThan(ch2Content.indexOf("老矿工信誓旦旦"))
    expect(ch2Content).not.toContain("www.qidian.example")
    expect(ch2Content).not.toContain("归入标题")
    expect(parsed(await call("status")).status).toBe("completed")
  })
})

describe("原文驱动导入集成夹具（书稿 B：work_remaining 尾部修正）", () => {
  test("首次计划低估剩余章节时追加未开始任务，最终全覆盖", async () => {
    // 校准期三章各 5 段（长章），剩余 15 段按短章（2 段/章）实际需 8 章：
    // 中位数章长偏大 → 首次计划低估 → 提交完计划后触发 work_remaining。
    const longPara = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥甲乙丙丁戊己" // 30 字
    const lines = Array.from({ length: 30 }, (_, i) => longPara + "第" + i + "段")
    await createBook(lines.join("\n"))
    await call("commit", {
      draft: draft({ order: 1, title: "校准第 1 章", ops: Array.from({ length: 5 }, (_, i) => keep(i)), carry: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14], windowSize: 15 }),
    })
    await call("commit", {
      draft: draft({ order: 2, title: "校准第 2 章", ops: Array.from({ length: 5 }, (_, i) => keep(5 + i)), carry: [10, 11, 12, 13, 14], windowSize: 0 }),
    })
    await call("commit", {
      draft: draft({ order: 3, title: "校准第 3 章", ops: Array.from({ length: 5 }, (_, i) => keep(10 + i)), carry: [], windowSize: 0 }),
    })
    const third = parsed(await call("status"))
    expect(third.calibration_reached).toBe(true)
    const plan = parsed(await call("plan", { reason: "first_plan" }))
    const planned = plan.items as string[]
    expect(planned.length).toBe(plan.planned_count as number)
    expect(planned.length).toBeLessThan(8) // 中位数高估章长 → 计划低估

    // 提交完计划内章节后仍有未消费原文 → work_remaining 追加
    let nextOrder = 4
    let cursor = 15
    const commitOne = async (size: number) => {
      const ops = Array.from({ length: size }, (_, i) => keep(cursor + i))
      await call("commit", {
        draft: draft({
          order: nextOrder,
          title: "第 " + nextOrder + " 章",
          ops,
          carry: [],
          windowSize: size,
        }),
      })
      cursor += size
      nextOrder += 1
    }
    for (let i = 0; i < planned.length; i++) await commitOne(2)
    let status = parsed(await call("status"))
    expect(status.source_exhausted).toBe(false)
    const refill = parsed(await call("plan", { reason: "work_remaining" }))
    expect(refill.items.length).toBeGreaterThan(0)
    const refillCount = (refill.items as string[]).length
    for (let i = 0; i < refillCount && cursor < lines.length; i++) await commitOne(Math.min(2, lines.length - cursor))
    // 若仍剩余（二次低估），继续 work_remaining 直到耗尽
    for (let guard = 0; guard < 5 && !(parsed(await call("status")).source_exhausted); guard++) {
      const more = parsed(await call("plan", { reason: "work_remaining" }))
      const count = (more.items as string[]).length
      for (let i = 0; i < count && cursor < lines.length; i++) await commitOne(Math.min(2, lines.length - cursor))
    }
    status = parsed(await call("status"))
    expect(status.source_exhausted).toBe(true)
    const history = (status.plan_history as Array<Record<string, unknown>>).map((h) => h.reason)
    expect(history[0]).toBe("first_plan")
    expect(history).toContain("work_remaining")
  })
})

