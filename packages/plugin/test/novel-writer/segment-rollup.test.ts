import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

const testDir = join(tmpdir(), `novel-segment-${Date.now()}`)
const dbPath = join(testDir, "test.db")

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
})

afterAll(() => {
  delete process.env.OPENNOVEL_DB
  const { closeDb } = require("@opennovel-ai/novel-store")
  closeDb()
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

const NOVEL = "novel-segment"

async function setupDb(chapterCount: number) {
  const { getDb, NovelTable, ChapterTable, ChapterSummaryTable, SegmentSummaryTable } = await import(
    "../../src/novel-writer/session-store.js"
  )
  const db = getDb()
  db.delete(SegmentSummaryTable).run()
  db.delete(ChapterSummaryTable).run()
  db.delete(ChapterTable).run()
  db.delete(NovelTable).run()

  db.insert(NovelTable).values({ id: NOVEL, title: "segment-test", genre: "玄幻", synopsis: "test", status: "draft" }).run()
  for (let i = 1; i <= chapterCount; i++) {
    const chapterId = `ch-${i}`
    db.insert(ChapterTable)
      .values({
        id: chapterId,
        novel_id: NOVEL,
        volume_id: null,
        title: `标题${i}`,
        content: "",
        word_count: 0,
        status: "final",
        order: i,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()
    // 偶数章有摘要，奇数章无摘要（验证"暂无摘要"降级）
    if (i % 2 === 0) {
      db.insert(ChapterSummaryTable)
        .values({ id: `cs-${i}`, chapter_id: chapterId, summary: `第${i}章摘要`, key_events: [`事件${i}`], char_changes: [] })
        .run()
    }
  }
  return db
}

describe("ensureSegmentSummaries", () => {
  test("不满一个窗口时不生成任何段摘要", async () => {
    const db = await setupDb(15)
    const { ensureSegmentSummaries, listSegmentSummaries } = await import("../../src/novel-writer/segment-rollup.js")
    const created = await ensureSegmentSummaries(db, NOVEL, 15)
    expect(created).toBe(0)
    expect(await listSegmentSummaries(db, NOVEL)).toEqual([])
  })

  test("第21章时生成第1-20章段摘要，进行中的段不压缩", async () => {
    const db = await setupDb(25)
    const { ensureSegmentSummaries, listSegmentSummaries } = await import("../../src/novel-writer/segment-rollup.js")
    const created = await ensureSegmentSummaries(db, NOVEL, 21)
    expect(created).toBe(1)

    const segments = await listSegmentSummaries(db, NOVEL)
    expect(segments).toHaveLength(1)
    expect(segments[0].startChapter).toBe(1)
    expect(segments[0].endChapter).toBe(20)
    // 有摘要的章节纳入段摘要文本
    expect(segments[0].summary).toContain("第2章《标题2》：第2章摘要")
    expect(segments[0].summary).toContain("事件2")
    // 无摘要的章节降级占位
    expect(segments[0].summary).toContain("第1章《标题1》：（暂无摘要）")
    // 进行中的段（21-25章）不出现
    expect(segments[0].summary).not.toContain("标题21")
  })

  test("幂等：完整段重复调用不重复生成、不刷新", async () => {
    const db = await setupDb(25)
    const { ensureSegmentSummaries, listSegmentSummaries } = await import("../../src/novel-writer/segment-rollup.js")
    await ensureSegmentSummaries(db, NOVEL, 21)
    const second = await ensureSegmentSummaries(db, NOVEL, 21)
    expect(second).toBe(0)
    expect(await listSegmentSummaries(db, NOVEL)).toHaveLength(1)
  })

  test("占位段在缺失摘要补齐后刷新，不永久冻结", async () => {
    const db = await setupDb(21)
    const { ensureSegmentSummaries, listSegmentSummaries } = await import("../../src/novel-writer/segment-rollup.js")
    // 第21章关闭第1段；setupDb 中奇数章（含第1章）暂无摘要
    await ensureSegmentSummaries(db, NOVEL, 21)
    let segments = await listSegmentSummaries(db, NOVEL)
    expect(segments[0].summary).toContain("第1章《标题1》：（暂无摘要）")

    // 事后补齐第1章摘要
    const { ChapterSummaryTable } = await import("../../src/novel-writer/session-store.js")
    db.insert(ChapterSummaryTable)
      .values({ id: "cs-1", chapter_id: "ch-1", summary: "第1章摘要", key_events: ["事件1"], char_changes: [] })
      .run()

    const refreshed = await ensureSegmentSummaries(db, NOVEL, 21)
    expect(refreshed).toBe(1)
    segments = await listSegmentSummaries(db, NOVEL)
    expect(segments).toHaveLength(1)
    // 第1章占位已被真实摘要替换，且没有重复行
    expect(segments[0].summary).toContain("第1章《标题1》：第1章摘要")
    expect(segments[0].summary).not.toContain("第1章《标题1》：（暂无摘要）")
  })

  test("推进到第41章时补生成第21-40章段摘要", async () => {
    const db = await setupDb(45)
    const { ensureSegmentSummaries, listSegmentSummaries } = await import("../../src/novel-writer/segment-rollup.js")
    await ensureSegmentSummaries(db, NOVEL, 21)
    const created = await ensureSegmentSummaries(db, NOVEL, 41)
    expect(created).toBe(1)

    const segments = await listSegmentSummaries(db, NOVEL)
    expect(segments).toHaveLength(2)
    expect(segments[1].startChapter).toBe(21)
    expect(segments[1].endChapter).toBe(40)
    expect(segments[1].summary).toContain("第22章《标题22》")
  })
})