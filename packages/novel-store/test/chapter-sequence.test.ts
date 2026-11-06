/**
 * 章节序号重排事务原语测试（chapter-sequence-guard · tasks 1.1）
 *
 * 覆盖（design D1）：
 * - move 后移 / 前移 / 同卷交换三形态与全书 1..N 排列不变
 * - remove 删除补位（章记录先由调用方删除，原位置后区间 -1）
 * - 派生表逐项同步：tension_log / technique_shadow_log / story_arcs 四字段按号平移、
 *   arc_beats / story_spine_entries 按 chapter_id 回写、segment_summaries 相交段删除、
 *   memory_injection_snapshot 受影响章删行、chapter_summary_fts 重建、running 批量作废
 * - no-op 不动派生、不作废批量；越界/跨书/不存在章校验抛错
 * - 调用方事务内中途失败完整回滚；存量重号脏库不平移区外旧号、不越权修复
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, sql } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  beginWritingBatch,
  getWritingBatch,
  relocateChapters,
  relocateChaptersTx,
  withTransaction,
  type RelocateResult,
  NovelTable,
  ChapterTable,
  ChapterSummaryTable,
  TensionLogTable,
  ArcBeatTable,
  StoryArcTable,
  StorySpineEntryTable,
  TechniqueShadowLogTable,
  SegmentSummaryTable,
  MemoryInjectionSnapshotTable,
} from "../src/index.js"

let projectDir: string
let chapters: Array<{ id: string }>

beforeEach(async () => {
  projectDir = join(tmpdir(), `chapter-sequence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  db.insert(NovelTable)
    .values({ id: "novel-1", title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  chapters = []
  for (let order = 1; order <= 10; order++) {
    const chapter = await createChapter("novel-1", `第${order}章`, order, null, projectDir)
    chapters.push(chapter)
  }
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

const chapterAt = (order: number) => chapters[order - 1]

function currentOrders(): number[] {
  return getDb(projectDir)
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, "novel-1"))
    .all()
    .map((row) => row.order)
    .sort((a, b) => a - b)
}

function changeMap(result: RelocateResult): Record<string, { oldOrder: number; newOrder: number }> {
  return Object.fromEntries(result.changes.map((c) => [c.chapterId, { oldOrder: c.oldOrder, newOrder: c.newOrder }]))
}

function tensionNumbers(): number[] {
  return getDb(projectDir)
    .select({ chapter_number: TensionLogTable.chapter_number })
    .from(TensionLogTable)
    .where(eq(TensionLogTable.novel_id, "novel-1"))
    .all()
    .map((row) => row.chapter_number)
    .sort((a, b) => a - b)
}

/** 按号定位派生数据全套落库（号码见各表断言）。 */
async function seedDerived() {
  const db = getDb(projectDir)
  for (const n of [3, 4, 5, 8]) {
    db.insert(TensionLogTable)
      .values({ id: `tension-${n}`, novel_id: "novel-1", chapter_number: n, level: 0.5 })
      .run()
  }
  db.insert(StoryArcTable)
    .values({
      id: "arc-1",
      novel_id: "novel-1",
      arc_type: "main",
      title: "主线",
      planned_start_chapter: 3,
      planned_end_chapter: 8,
      actual_start_chapter: 4,
      actual_end_chapter: 7,
    })
    .run()
  db.insert(ArcBeatTable)
    .values({ id: "beat-1", novel_id: "novel-1", arc_id: "arc-1", chapter_id: chapterAt(4).id, chapter_order: 4, label: "节拍" })
    .run()
  db.insert(StorySpineEntryTable)
    .values({ id: "spine-1", novel_id: "novel-1", chapter_id: chapterAt(5).id, chapter_order: 5, content: "主线事件" })
    .run()
  db.insert(TechniqueShadowLogTable)
    .values({ id: "shadow-1", novel_id: "novel-1", chapter_number: 5, scene_type: "battle" })
    .run()
  db.insert(SegmentSummaryTable).values({ id: "seg-a", novel_id: "novel-1", start_chapter: 2, end_chapter: 4, summary: "段一" }).run()
  db.insert(SegmentSummaryTable).values({ id: "seg-b", novel_id: "novel-1", start_chapter: 9, end_chapter: 10, summary: "段二" }).run()
  db.insert(MemoryInjectionSnapshotTable).values({ novel_id: "novel-1", chapter_id: chapterAt(3).id, payload: "{}" }).run()
  db.insert(MemoryInjectionSnapshotTable).values({ novel_id: "novel-1", chapter_id: chapterAt(9).id, payload: "{}" }).run()
  db.insert(ChapterSummaryTable).values({ id: "sum-3", chapter_id: chapterAt(3).id, summary: "第三章摘要", key_events: ["事件三"] }).run()
  db.insert(ChapterSummaryTable).values({ id: "sum-9", chapter_id: chapterAt(9).id, summary: "第九章摘要", key_events: ["事件九"] }).run()
  db.run(sql`INSERT INTO chapter_summary_fts (novel_id, chapter_id, chapter_order, title, body) VALUES (${"novel-1"}, ${chapterAt(3).id}, ${3}, ${"第三章"}, ${"第三章 摘要"})`)
  db.run(sql`INSERT INTO chapter_summary_fts (novel_id, chapter_id, chapter_order, title, body) VALUES (${"novel-1"}, ${chapterAt(9).id}, ${9}, ${"第九章"}, ${"第九章 摘要"})`)
  await beginWritingBatch({ novelId: "novel-1", sessionId: "ses-1", startChapter: 1, total: 10 }, projectDir)
}

describe("move 后移", () => {
  test("第 2 章移到第 8 位：2~8 区间重排，全书保持 1..10", () => {
    const result = relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(2).id, targetOrder: 8 }, projectDir)
    expect(result.changes).toHaveLength(7)
    const changes = changeMap(result)
    expect(changes[chapterAt(2).id]).toEqual({ oldOrder: 2, newOrder: 8 })
    for (let order = 3; order <= 8; order++) {
      expect(changes[chapterAt(order).id]).toEqual({ oldOrder: order, newOrder: order - 1 })
    }
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.batchCancelled).toBe(false)
  })
})

describe("move 前移", () => {
  test("第 9 章移到第 2 位：2~8 区间 +1，全书保持 1..10", () => {
    const result = relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(9).id, targetOrder: 2 }, projectDir)
    const changes = changeMap(result)
    expect(changes[chapterAt(9).id]).toEqual({ oldOrder: 9, newOrder: 2 })
    for (let order = 2; order <= 8; order++) {
      expect(changes[chapterAt(order).id]).toEqual({ oldOrder: order, newOrder: order + 1 })
    }
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe("move 同卷交换", () => {
  test("第 4 章上移到第 3 位：仅 3、4 两章互换，其余不动", () => {
    const result = relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(4).id, targetOrder: 3 }, projectDir)
    expect(result.changes).toHaveLength(2)
    const changes = changeMap(result)
    expect(changes[chapterAt(4).id]).toEqual({ oldOrder: 4, newOrder: 3 })
    expect(changes[chapterAt(3).id]).toEqual({ oldOrder: 3, newOrder: 4 })
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe("remove 删除补位", () => {
  test("删除第 5 章后补位：原 6~10 章变为 5~9", () => {
    const db = getDb(projectDir)
    db.delete(ChapterTable).where(eq(ChapterTable.id, chapterAt(5).id)).run()
    const result = relocateChapters("novel-1", { kind: "remove", afterOrder: 5 }, projectDir)
    expect(result.changes).toHaveLength(5)
    const changes = changeMap(result)
    for (let order = 6; order <= 10; order++) {
      expect(changes[chapterAt(order).id]).toEqual({ oldOrder: order, newOrder: order - 1 })
    }
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test("删末章无补位：空 changes、不作废批量", () => {
    const result = relocateChapters("novel-1", { kind: "remove", afterOrder: 10 }, projectDir)
    expect(result.changes).toHaveLength(0)
    expect(result.batchCancelled).toBe(false)
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe("派生表同步", () => {
  test("move 第 2 章到第 8 位：按号表平移、按 ID 表回写、段/快照/FTS/批量逐项落地", async () => {
    await seedDerived()
    const result = relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(2).id, targetOrder: 8 }, projectDir)
    const db = getDb(projectDir)

    expect(tensionNumbers()).toEqual([2, 3, 4, 7])
    const shadow = db.select().from(TechniqueShadowLogTable).where(eq(TechniqueShadowLogTable.id, "shadow-1")).get()!
    expect(shadow.chapter_number).toBe(4)
    const arc = db.select().from(StoryArcTable).where(eq(StoryArcTable.id, "arc-1")).get()!
    expect({
      planned_start_chapter: arc.planned_start_chapter,
      planned_end_chapter: arc.planned_end_chapter,
      actual_start_chapter: arc.actual_start_chapter,
      actual_end_chapter: arc.actual_end_chapter,
    }).toEqual({ planned_start_chapter: 2, planned_end_chapter: 7, actual_start_chapter: 3, actual_end_chapter: 6 })

    const beat = db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, "beat-1")).get()!
    expect(beat.chapter_order).toBe(3)
    const spine = db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.id, "spine-1")).get()!
    expect(spine.chapter_order).toBe(4)

    const segments = db.select().from(SegmentSummaryTable).where(eq(SegmentSummaryTable.novel_id, "novel-1")).all()
    expect(segments.map((s) => s.id).sort()).toEqual(["seg-b"])
    const snapshots = db
      .select({ chapter_id: MemoryInjectionSnapshotTable.chapter_id })
      .from(MemoryInjectionSnapshotTable)
      .where(eq(MemoryInjectionSnapshotTable.novel_id, "novel-1"))
      .all()
    expect(snapshots.map((s) => s.chapter_id)).toEqual([chapterAt(9).id])

    const ftsOrders = db.all(sql`SELECT chapter_id, chapter_order FROM chapter_summary_fts WHERE novel_id = ${"novel-1"}`) as Array<{
      chapter_id: string
      chapter_order: number
    }>
    expect(Object.fromEntries(ftsOrders.map((row) => [row.chapter_id, row.chapter_order]))).toEqual({
      [chapterAt(3).id]: 2,
      [chapterAt(9).id]: 9,
    })

    expect(result.batchCancelled).toBe(true)
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("cancelled")
  })

  test("move 第 9 章到第 2 位：交换型映射（3↔4 号对环）按号表不互相覆盖", async () => {
    await seedDerived()
    relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(9).id, targetOrder: 2 }, projectDir)
    // 前移影响区间 [2,9]：与两段汇总都相交，全部删除重建
    const db = getDb(projectDir)
    const segments = db.select().from(SegmentSummaryTable).where(eq(SegmentSummaryTable.novel_id, "novel-1")).all()
    expect(segments).toHaveLength(0)
    expect(tensionNumbers()).toEqual([4, 5, 6, 9])
  })
})

describe("no-op 与校验", () => {
  test("落到原号：空 changes，派生不动、批量不作废", async () => {
    await seedDerived()
    const result = relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(3).id, targetOrder: 3 }, projectDir)
    expect(result.changes).toHaveLength(0)
    expect(result.batchCancelled).toBe(false)
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
  })

  test("目标序号越界 / 章不存在 / 跨书章节均抛错", () => {
    expect(() => relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(2).id, targetOrder: 0 }, projectDir)).toThrow("目标序号越界")
    expect(() => relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(2).id, targetOrder: 11 }, projectDir)).toThrow("目标序号越界")
    expect(() => relocateChapters("novel-1", { kind: "move", chapterId: "ch-missing", targetOrder: 2 }, projectDir)).toThrow("Chapter not found")
  })
})

describe("事务回滚", () => {
  test("调用方事务中途失败：主表与派生表整体回滚", async () => {
    await seedDerived()
    const db = getDb(projectDir)
    expect(() =>
      withTransaction(db, (tx) => {
        relocateChaptersTx(tx, "novel-1", { kind: "move", chapterId: chapterAt(2).id, targetOrder: 8 })
        throw new Error("模拟下游失败")
      }),
    ).toThrow("模拟下游失败")
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
  })
})

describe("存量脏库容错", () => {
  test("前置已重号：只平移涉及区间、区外旧号保留，不越权全量改写", () => {
    const db = getDb(projectDir)
    db.update(ChapterTable).set({ order: 7 }).where(eq(ChapterTable.id, chapterAt(8).id)).run()
    const result = relocateChapters("novel-1", { kind: "move", chapterId: chapterAt(2).id, targetOrder: 8 }, projectDir)
    expect(result.changes).toHaveLength(7)
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 6, 8, 9, 10])
  })
})
