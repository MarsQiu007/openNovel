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
 * - deleteVolume 卷号补位与 deleteChapter 统一删除（D4：解锚/级联/补位/回滚）
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { and, eq, sql } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  createVolume,
  deleteChapter,
  deleteChapterTx,
  deleteVolume,
  deleteVolumeTx,
  beginWritingBatch,
  getWritingBatch,
  moveChapter,
  moveChapterTx,
  relocateChapters,
  relocateChaptersTx,
  repairChapterSequence,
  resolveChapterSlot,
  withTransaction,
  type RelocateResult,
  NovelTable,
  AnnotationRoundTable,
  AnnotationTable,
  ChapterReviewTable,
  ChapterSummaryTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterStateTable,
  CharacterTable,
  EntityRefTable,
  ForeshadowingTable,
  HookRotationTable,
  NovelStateLogTable,
  VolumeTable,
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

describe("deleteVolume 卷号补位（tasks 1.2）", () => {  let volumes: Array<{ id: string; order: number }>

  beforeEach(async () => {
    volumes = []
    for (const title of ["卷一", "卷二", "卷三"]) {
      volumes.push(await createVolume("novel-1", title, undefined, projectDir))
    }
    for (const [index, chapter] of chapters.entries()) {
      const volumeIndex = Math.floor(index / 2)
      if (volumeIndex < volumes.length) {
        getDb(projectDir).update(ChapterTable).set({ volume_id: volumes[volumeIndex].id }).where(eq(ChapterTable.id, chapter.id)).run()
      }
    }
  })

  function remainingVolumes(): Array<{ id: string; order: number }> {
    return getDb(projectDir)
      .select({ id: VolumeTable.id, order: VolumeTable.order })
      .from(VolumeTable)
      .where(eq(VolumeTable.novel_id, "novel-1"))
      .all()
      .sort((a, b) => a.order - b.order)
  }

  function chapterVolume(chapterId: string): string | null {
    return getDb(projectDir).select({ volume_id: ChapterTable.volume_id }).from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!.volume_id
  }

  test("删除中间卷：章置未分组且序号不变，后续卷号 -1 连续", async () => {
    await deleteVolume(volumes[1].id, projectDir)
    expect(chapterVolume(chapterAt(3).id)).toBeNull()
    expect(chapterVolume(chapterAt(4).id)).toBeNull()
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(remainingVolumes()).toEqual([
      { id: volumes[0].id, order: 1 },
      { id: volumes[2].id, order: 2 },
    ])
  })

  test("删除末卷：剩余卷号不变", async () => {
    await deleteVolume(volumes[2].id, projectDir)
    expect(remainingVolumes()).toEqual([
      { id: volumes[0].id, order: 1 },
      { id: volumes[1].id, order: 2 },
    ])
  })

  test("卷不存在抛错", async () => {
    await expect(deleteVolume("vol-missing", projectDir)).rejects.toThrow("Volume not found")
  })

  test("事务回滚：章归属与卷号均不变", () => {
    const db = getDb(projectDir)
    expect(() =>
      withTransaction(db, (tx) => {
        deleteVolumeTx(tx, volumes[1].id)
        throw new Error("模拟下游失败")
      }),
    ).toThrow("模拟下游失败")
    expect(chapterVolume(chapterAt(3).id)).toBe(volumes[1].id)
    expect(remainingVolumes()).toEqual([
      { id: volumes[0].id, order: 1 },
      { id: volumes[1].id, order: 2 },
      { id: volumes[2].id, order: 3 },
    ])
  })
})

describe("resolveChapterSlot 章纲落位（tasks 2.1）", () => {
  let defaultVolumeId: string

  beforeEach(async () => {
    defaultVolumeId = (await createVolume("novel-1", "默认卷", undefined, projectDir)).id
  })

  const slotInput = (overrides: Record<string, unknown>) => ({
    novelId: "novel-1",
    order: 1,
    volumeId: defaultVolumeId,
    hasExplicitVolume: false,
    ...overrides,
  })

  test("跳号拒绝并报首个缺口：仅 3 章的书生成第 6 章 → 报第 4 章缺失", () => {
    const db = getDb(projectDir)
    for (let order = 4; order <= 10; order++) {
      db.delete(ChapterTable).where(eq(ChapterTable.id, chapterAt(order).id)).run()
    }
    const result = resolveChapterSlot(slotInput({ order: 6 }), projectDir)
    expect(result).toEqual({ kind: "gap", missingOrder: 4 })
    expect(currentOrders()).toEqual([1, 2, 3])
  })

  test("第 1 章不受限：空书直接创建", () => {
    const db = getDb(projectDir)
    db.insert(NovelTable)
      .values({ id: "novel-2", title: "空书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()
    const result = resolveChapterSlot(slotInput({ novelId: "novel-2", order: 1 }), projectDir)
    expect(result.kind).toBe("created")
  })

  test("重复生成复用原记录：改标题置 outline 态、显式换卷，不产生第二条同号记录", async () => {
    const volume = await createVolume("novel-1", "新卷", undefined, projectDir)
    const result = resolveChapterSlot(
      slotInput({ order: 3, title: "第三章 觉醒", volumeId: volume.id, hasExplicitVolume: true }),
      projectDir,
    )
    expect(result).toEqual({ kind: "reused", chapterId: chapterAt(3).id })
    const db = getDb(projectDir)
    const row = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterAt(3).id)).get()!
    expect(row.title).toBe("第三章 觉醒")
    expect(row.status).toBe("outline")
    expect(row.volume_id).toBe(volume.id)
    const atOrder3 = db
      .select()
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, "novel-1"), eq(ChapterTable.order, 3)))
      .all()
    expect(atOrder3).toHaveLength(1)
  })

  test("复用但不改名不换卷时记录原样不动", () => {
    const before = getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.id, chapterAt(3).id)).get()!
    const result = resolveChapterSlot(slotInput({ order: 3 }), projectDir)
    expect(result).toEqual({ kind: "reused", chapterId: chapterAt(3).id })
    const after = getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.id, chapterAt(3).id)).get()!
    expect(after).toEqual(before)
  })

  test("跨卷连续号合法：前置章在别的卷也可落位", async () => {
    const otherVolume = await createVolume("novel-1", "别卷", undefined, projectDir)
    const db = getDb(projectDir)
    db.update(ChapterTable).set({ volume_id: otherVolume.id }).where(eq(ChapterTable.id, chapterAt(3).id)).run()
    const result = resolveChapterSlot(slotInput({ order: 4, volumeId: defaultVolumeId }), projectDir)
    expect(result).toEqual({ kind: "reused", chapterId: chapterAt(4).id })
  })

  test("顺序下一章正常创建（非复用）", () => {
    const db = getDb(projectDir)
    db.delete(ChapterTable).where(eq(ChapterTable.novel_id, "novel-1")).run()
    // 空书后手动补回第 1 章，再落第 2 章
    const first = resolveChapterSlot(slotInput({ order: 1, title: "开篇" }), projectDir)
    expect(first.kind).toBe("created")
    const second = resolveChapterSlot(slotInput({ order: 2 }), projectDir)
    expect(second.kind).toBe("created")
    expect(currentOrders()).toEqual([1, 2])
  })

  test("序号小于 1 抛错", () => {
    expect(() => resolveChapterSlot(slotInput({ order: 0 }), projectDir)).toThrow("章节序号非法")
  })
})

describe("deleteChapter 统一删除（tasks 2.2 · D4）", () => {
  test("删除第 5 章：级联清空、节拍/主线解锚无旧号残留、后续章补位并同步派生表", async () => {
    await seedDerived()
    const db = getDb(projectDir)
    const ch5 = chapterAt(5).id
    db.insert(CharacterTable).values({ id: "char-1", novel_id: "novel-1", name: "角色甲" }).run()
    db.insert(ChapterVersionTable).values({ id: "ver-5", chapter_id: ch5, version: 1, content: "旧稿", created_by: "test" }).run()
    db.insert(CharacterStateTable).values({ id: "cs-5", character_id: "char-1", chapter_id: ch5 }).run()
    db.insert(ChapterReviewTable).values({ id: "rev-5", chapter_id: ch5, round: 1, source: "audit", overall: "ok" }).run()
    db.insert(NovelStateLogTable).values({ id: "log-5", novel_id: "novel-1", chapter_id: ch5, fact_type: "event", fact_data: { x: 1 } }).run()
    db.insert(HookRotationTable).values({ id: "hook-5", novel_id: "novel-1", hook_type: "cliffhanger", chapter_id: ch5 }).run()
    db.insert(EntityRefTable)
      .values({ id: "ref-5", novel_id: "novel-1", source_type: "chapter", source_id: ch5, target_type: "character", target_id: "char-1", ref_field: "content" })
      .run()
    db.insert(AnnotationTable)
      .values({ id: "ann-5", novel_id: "novel-1", target_type: "chapter", target_id: ch5, field: "content", quote: "段" })
      .run()
    db.insert(AnnotationRoundTable)
      .values({ id: "round-5", novel_id: "novel-1", target_type: "chapter", target_id: ch5, prompt_snapshot: "p" })
      .run()
    db.insert(ForeshadowingTable).values({ id: "fore-5a", novel_id: "novel-1", planted_chapter_id: ch5, content: "伏笔甲" }).run()
    db.insert(ForeshadowingTable).values({ id: "fore-5b", novel_id: "novel-1", resolved_chapter_id: ch5, content: "伏笔乙" }).run()
    db.insert(MemoryInjectionSnapshotTable).values({ novel_id: "novel-1", chapter_id: ch5, payload: "{}" }).run()
    db.insert(ChapterSummaryTable).values({ id: "sum-5", chapter_id: ch5, summary: "第五章摘要", key_events: [] }).run()
    db.run(sql`INSERT INTO chapter_summary_fts (novel_id, chapter_id, chapter_order, title, body) VALUES (${"novel-1"}, ${ch5}, ${5}, ${"第五章"}, ${"第五章 摘要"})`)
    db.insert(ArcBeatTable)
      .values({ id: "beat-2", novel_id: "novel-1", arc_id: "arc-1", chapter_id: ch5, chapter_order: 5, label: "被删节拍" })
      .run()

    const deletion = await deleteChapter(ch5, projectDir)
    expect(deletion).toMatchObject({ novelId: "novel-1", oldOrder: 5, batchCancelled: true })

    expect(db.select().from(ChapterTable).where(eq(ChapterTable.id, ch5)).get()).toBeUndefined()
    expect(db.select().from(ChapterVersionTable).where(eq(ChapterVersionTable.chapter_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(CharacterStateTable).where(eq(CharacterStateTable.chapter_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(ChapterReviewTable).where(eq(ChapterReviewTable.chapter_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(NovelStateLogTable).where(eq(NovelStateLogTable.chapter_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(HookRotationTable).where(eq(HookRotationTable.chapter_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(EntityRefTable).where(eq(EntityRefTable.source_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(AnnotationTable).where(eq(AnnotationTable.target_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(AnnotationRoundTable).where(eq(AnnotationRoundTable.target_id, ch5)).all()).toHaveLength(0)
    expect(db.select().from(MemoryInjectionSnapshotTable).where(eq(MemoryInjectionSnapshotTable.chapter_id, ch5)).all()).toHaveLength(0)
    const foreshadowing = db.select().from(ForeshadowingTable).all()
    expect(foreshadowing.map((f) => [f.planted_chapter_id, f.resolved_chapter_id])).toEqual([
      [null, null],
      [null, null],
    ])

    // 补位：1..9 连续；张力按旧号删（5 消失、8→7）；影子日志同删
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tensionNumbers()).toEqual([3, 4, 7])
    const shadowRows = db
      .select({ chapter_number: TechniqueShadowLogTable.chapter_number })
      .from(TechniqueShadowLogTable)
      .where(eq(TechniqueShadowLogTable.novel_id, "novel-1"))
      .all()
    expect(shadowRows).toHaveLength(0)

    // 解锚：被删章的节拍/主线条目保留但章号清空；幸存节拍按 chapter_id 回写新号（4 号章未动号，锚号保持）
    expect(db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, "beat-2")).get()!.chapter_order).toBeNull()
    expect(db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.id, "spine-1")).get()!.chapter_order).toBeNull()
    expect(db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, "beat-1")).get()!.chapter_order).toBe(4)
    const arc = db.select().from(StoryArcTable).where(eq(StoryArcTable.id, "arc-1")).get()!
    expect({
      planned_start_chapter: arc.planned_start_chapter,
      planned_end_chapter: arc.planned_end_chapter,
      actual_start_chapter: arc.actual_start_chapter,
      actual_end_chapter: arc.actual_end_chapter,
    }).toEqual({ planned_start_chapter: 3, planned_end_chapter: 7, actual_start_chapter: 4, actual_end_chapter: 6 })

    // 段/快照/FTS：区外段保留，相交段与被删章/变动章清行，FTS 重建后无被删章
    const segments = db.select().from(SegmentSummaryTable).where(eq(SegmentSummaryTable.novel_id, "novel-1")).all()
    expect(segments.map((s) => s.id)).toEqual(["seg-a"])
    const snapshots = db
      .select({ chapter_id: MemoryInjectionSnapshotTable.chapter_id })
      .from(MemoryInjectionSnapshotTable)
      .where(eq(MemoryInjectionSnapshotTable.novel_id, "novel-1"))
      .all()
    expect(snapshots.map((s) => s.chapter_id)).toEqual([chapterAt(3).id])
    const ftsOrders = db.all(sql`SELECT chapter_id, chapter_order FROM chapter_summary_fts WHERE novel_id = ${"novel-1"}`) as Array<{
      chapter_id: string
      chapter_order: number
    }>
    expect(Object.fromEntries(ftsOrders.map((row) => [row.chapter_id, row.chapter_order]))).toEqual({
      [chapterAt(3).id]: 3,
      [chapterAt(9).id]: 8,
    })
  })

  test("删除末章：级联照常、无补位、不作废批量", async () => {
    await seedDerived()
    const ch10 = chapterAt(10).id
    const deletion = await deleteChapter(ch10, projectDir)
    expect(deletion.batchCancelled).toBe(false)
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
  })

  test("章不存在抛错", async () => {
    await expect(deleteChapter("ch-missing", projectDir)).rejects.toThrow("Chapter not found")
  })

  test("事务回滚：删除中途失败整体还原", async () => {
    await seedDerived()
    const db = getDb(projectDir)
    const ch5 = chapterAt(5).id
    expect(() =>
      withTransaction(db, (tx) => {
        deleteChapterTx(tx, ch5)
        throw new Error("模拟下游失败")
      }),
    ).toThrow("模拟下游失败")
    expect(db.select().from(ChapterTable).where(eq(ChapterTable.id, ch5)).get()).toBeDefined()
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
  })
})

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe("moveChapter 移卷与交换（tasks 3.1 · design D2）", () => {
  let volumes60: Array<{ id: string }>

  beforeEach(async () => {
    const db = getDb(projectDir)
    db.insert(NovelTable)
      .values({ id: "novel-2", title: "六十章书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()
    volumes60 = []
    for (const title of ["卷一", "卷二", "卷三"]) {
      volumes60.push(await createVolume("novel-2", title, undefined, projectDir))
    }
    for (let order = 1; order <= 60; order++) {
      const volumeIndex = order <= 20 ? 0 : order <= 40 ? 1 : 2
      await createChapter("novel-2", `第${order}章`, order, volumes60[volumeIndex]!.id, projectDir)
    }
  })

  function chapterAtNovel2(order: number) {
    return getDb(projectDir)
      .select()
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, "novel-2"), eq(ChapterTable.order, order)))
      .get()!
  }

  function ordersOfNovel2(): number[] {
    return getDb(projectDir)
      .select({ order: ChapterTable.order })
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, "novel-2"))
      .all()
      .map((row) => row.order)
      .sort((a, b) => a - b)
  }

  function volumeOrders(volumeIndex: number): number[] {
    return getDb(projectDir)
      .select({ order: ChapterTable.order })
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, "novel-2"), eq(ChapterTable.volume_id, volumes60[volumeIndex]!.id)))
      .all()
      .map((row) => row.order)
      .sort((a, b) => a - b)
  }

  test("三卷 60 章把第 5 章移到卷二：落卷二末位 40，原 6~40 补位 -1，全书仍 1~60", async () => {
    const movedId = chapterAtNovel2(5).id
    const result = await moveChapter(movedId, "to-volume", volumes60[1]!.id, projectDir)
    expect(result.order).toBe(40)
    expect(result.volume_id).toBe(volumes60[1]!.id)

    expect(ordersOfNovel2()).toEqual(range(1, 60))
    expect(volumeOrders(0)).toEqual(range(1, 19))
    expect(volumeOrders(1)).toEqual(range(20, 40))
    expect(volumeOrders(2)).toEqual(range(41, 60))
    // 落到阅读末位：卷二内无高于 40 的号
    expect(chapterAtNovel2(40).id).toBe(movedId)
  })

  test("后移章入卷不再撞号：目标卷末位 +1 被占用时全书重排无重复", async () => {
    // 卷一 1~3、卷二 4~5；把 3 号章移到卷二（旧实现直接 SET 末位+1 会撞 5 号位制造断档）
    const db = getDb(projectDir)
    db.delete(ChapterTable).where(eq(ChapterTable.novel_id, "novel-2")).run()
    await createChapter("novel-2", "甲", 1, volumes60[0]!.id, projectDir)
    await createChapter("novel-2", "乙", 2, volumes60[0]!.id, projectDir)
    await createChapter("novel-2", "丙", 3, volumes60[0]!.id, projectDir)
    await createChapter("novel-2", "丁", 4, volumes60[1]!.id, projectDir)
    await createChapter("novel-2", "戊", 5, volumes60[1]!.id, projectDir)

    const result = await moveChapter(chapterAtNovel2(3).id, "to-volume", volumes60[1]!.id, projectDir)
    expect(result.order).toBe(5)
    expect(ordersOfNovel2()).toEqual([1, 2, 3, 4, 5])
    expect(volumeOrders(0)).toEqual([1, 2])
    expect(volumeOrders(1)).toEqual([3, 4, 5])
  })

  test("空卷落点 = 前一卷末章 + 1（摘出后口径）", async () => {
    const db = getDb(projectDir)
    db.delete(ChapterTable).where(eq(ChapterTable.novel_id, "novel-2")).run()
    await createChapter("novel-2", "甲", 1, volumes60[0]!.id, projectDir)
    await createChapter("novel-2", "乙", 2, volumes60[0]!.id, projectDir)
    await createChapter("novel-2", "丙", 3, volumes60[0]!.id, projectDir)
    // 卷二保持空卷
    const result = await moveChapter(chapterAtNovel2(1).id, "to-volume", volumes60[1]!.id, projectDir)
    expect(result.order).toBe(3)
    expect(ordersOfNovel2()).toEqual([1, 2, 3])
    expect(volumeOrders(1)).toEqual([3])
  })

  test("移到未分组仅改归属：序号保持 10，其余章不重排、派生不动、批量不作废", async () => {
    const db = getDb(projectDir)
    db.update(ChapterTable).set({ volume_id: volumes60[0]!.id }).where(eq(ChapterTable.novel_id, "novel-2")).run()
    await seedDerived()

    const result = await moveChapter(chapterAt(10).id, "to-volume", undefined, projectDir)
    expect(result.volume_id).toBeNull()
    expect(result.order).toBe(10)
    expect(currentOrders()).toEqual(range(1, 10))
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
  })

  test("up/down 同卷相邻交换走同一原语：仅两章换号并同步派生表", async () => {
    const db = getDb(projectDir)
    const volume = await createVolume("novel-1", "交换卷", undefined, projectDir)
    db.update(ChapterTable).set({ volume_id: volume.id }).where(eq(ChapterTable.novel_id, "novel-1")).run()
    await seedDerived()

    // 3 号章上移：与 2 号交换（2↔3），其余章不动号
    const result = await moveChapter(chapterAt(3).id, "up", undefined, projectDir)
    expect(result.order).toBe(2)
    expect(currentOrders()).toEqual(range(1, 10))
    expect(tensionNumbers()).toEqual([2, 4, 5, 8])
    const beat = db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, "beat-1")).get()!
    expect(beat.chapter_order).toBe(4)
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("cancelled")
  })

  test("卷首上移到组界：no-op，序号与派生不动", async () => {
    const db = getDb(projectDir)
    db.update(ChapterTable).set({ volume_id: volumes60[0]!.id }).where(eq(ChapterTable.novel_id, "novel-2")).run()
    await seedDerived()

    const firstOfVolume = chapterAtNovel2(1)
    const result = await moveChapter(firstOfVolume.id, "up", undefined, projectDir)
    expect(result.order).toBe(1)
    expect(ordersOfNovel2()).toEqual(range(1, 60))
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
  })

  test("down 与相邻章交换并同步派生表：节拍/主线/影子按新号", async () => {
    await seedDerived()
    const db = getDb(projectDir)
    // 4 号章下移：与 5 号交换（4↔5）
    const result = await moveChapter(chapterAt(4).id, "down", undefined, projectDir)
    expect(result.order).toBe(5)
    expect(currentOrders()).toEqual(range(1, 10))
    const beat = db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, "beat-1")).get()!
    expect(beat.chapter_order).toBe(5)
    const spine = db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.id, "spine-1")).get()!
    expect(spine.chapter_order).toBe(4)
    const shadow = db.select().from(TechniqueShadowLogTable).where(eq(TechniqueShadowLogTable.id, "shadow-1")).get()!
    expect(shadow.chapter_number).toBe(4)
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("cancelled")
  })

  test("目标卷不存在 / 跨书卷抛错", async () => {
    const db = getDb(projectDir)
    db.insert(NovelTable)
      .values({ id: "novel-x", title: "别书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()
    db.insert(VolumeTable)
      .values({ id: "vol-other", novel_id: "novel-x", title: "别书卷", order: 1, created_at: 1 })
      .run()
    await expect(moveChapter(chapterAt(2).id, "to-volume", "vol-missing", projectDir)).rejects.toThrow("Volume not found")
    await expect(moveChapter(chapterAt(2).id, "to-volume", "vol-other", projectDir)).rejects.toThrow("Volume not found")
  })

  test("事务回滚：移卷中途失败主表整体还原", () => {
    const db = getDb(projectDir)
    const ch5Id = chapterAtNovel2(5).id
    expect(() =>
      withTransaction(db, (tx) => {
        moveChapterTx(tx, ch5Id, "to-volume", volumes60[1]!.id)
        throw new Error("模拟下游失败")
      }),
    ).toThrow("模拟下游失败")
    expect(ordersOfNovel2()).toEqual(range(1, 60))
    expect(chapterAtNovel2(5).volume_id).toBe(volumes60[0]!.id)
  })
})

describe("repairChapterSequence 显式修复（tasks 4.2 · D6）", () => {
  test("缺口库：按阅读序重排 1..N、映射按新号升序、派生同步、running 批量作废", async () => {
    await seedDerived()
    const db = getDb(projectDir)
    // 绕过 deleteChapter 直接删第 2 章：序号为 1,3,4,...,10（缺口）
    db.delete(ChapterTable).where(eq(ChapterTable.id, chapterAt(2).id)).run()

    const repair = repairChapterSequence("novel-1", projectDir)
    expect(repair.alreadyContiguous).toBe(false)
    expect(repair.batchCancelled).toBe(true)
    expect(currentOrders()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const changes = changeMap(repair)
    expect(changes[chapterAt(3).id]).toEqual({ oldOrder: 3, newOrder: 2 })
    expect(changes[chapterAt(10).id]).toEqual({ oldOrder: 10, newOrder: 9 })
    expect(Object.keys(changes)).toHaveLength(8)
    // 派生随重排同步：张力 3→2、4→3、5→4、8→7
    expect(tensionNumbers()).toEqual([2, 3, 4, 7])
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("cancelled")
  })

  test("幂等重跑：已连续返回 no-op，不作废批量、不触派生", async () => {
    await seedDerived()
    const first = repairChapterSequence("novel-1", projectDir)
    expect(first.alreadyContiguous).toBe(true)
    expect(first.changes).toHaveLength(0)
    expect(first.batchCancelled).toBe(false)
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("running")
    expect(tensionNumbers()).toEqual([3, 4, 5, 8])
  })
})

describe("createChapter 自编号接续全书末位（归档后收尾修复）", () => {
  beforeEach(() => {
    const db = getDb(projectDir)
    db.insert(NovelTable)
      .values({ id: "novel-3", title: "自编号书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()
  })

  function ordersOfNovel3(): number[] {
    return getDb(projectDir)
      .select({ order: ChapterTable.order })
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, "novel-3"))
      .all()
      .map((row) => row.order)
      .sort((a, b) => a - b)
  }

  test("无号建章接续末位：两章得 1、2 而非全 0 重号（HttpApi 练习场景同形）", async () => {
    const first = await createChapter("novel-3", "第一章", undefined, undefined, projectDir)
    const second = await createChapter("novel-3", "第二章", undefined, undefined, projectDir)
    expect(first.order).toBe(1)
    expect(second.order).toBe(2)
    expect(ordersOfNovel3()).toEqual([1, 2])
  })

  test("双无号章后 up 移动成功且全书仍 1..N", async () => {
    await createChapter("novel-3", "第一章", undefined, undefined, projectDir)
    const second = await createChapter("novel-3", "第二章", undefined, undefined, projectDir)
    const moved = await moveChapter(second.id, "up", undefined, projectDir)
    expect(moved.order).toBe(1)
    expect(ordersOfNovel3()).toEqual([1, 2])
  })

  test("显式 order 仍然优先：自动号不覆盖指定号，接续指定号之后", async () => {
    await createChapter("novel-3", "指定章", 5, undefined, projectDir)
    const auto = await createChapter("novel-3", "自动章", undefined, undefined, projectDir)
    expect(auto.order).toBe(6)
  })
})
