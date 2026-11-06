/**
 * 「事件顺序」维度升维测试（chapter-sequence-guard · tasks 4.1 · design D5）
 *
 * 序号重复检测 + 派生漂移对账（tension_log/technique_shadow_log 按号定位、
 * arc_beats/story_spine_entries 按 chapter_id 锚定），检出保持 WARN 级
 * 并附 repair_chapter_sequence 修复指引；干净库 PASS 不回退。
 *
 * 仿 chapter-sequential-gate.test.ts 的临时目录 SQLite 真实布局模式；
 * 每个用例独立建书（3 章），互不共享脏状态。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

const testDir = join(tmpdir(), `novel-writer-sequence-continuity-${Date.now()}`)
const projectDir = join(testDir, "novel-project")
const dbPath = join(projectDir, ".novel", "novel.db")
let prevOpenNovelDb: string | undefined
mkdirSync(join(projectDir, ".novel"), { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { checkContinuity } from "../../src/novel-writer/continuity-check.js"
import {
  ArcBeatTable,
  ChapterTable,
  StoryArcTable,
  StorySpineEntryTable,
  TechniqueShadowLogTable,
  TensionLogTable,
  closeDb,
  getDb,
} from "@opennovel-ai/novel-store"
import { and, eq } from "drizzle-orm"

beforeAll(() => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = dbPath
  const result = initNovelProject(projectDir)
  expect(result).toContain("初始化")
})

afterAll(() => {
  closeDb(projectDir)
  if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = prevOpenNovelDb
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
})

/** 建独立 3 章书（章纲顺序生成过跳号门禁），返回书籍 ID */
async function setupBook(title: string): Promise<string> {
  const novelId = await createBook(title, "玄幻", "事件顺序维度升维测试用书籍。")
  for (const order of [1, 2, 3]) {
    await generateChapterOutline(novelId, order, projectDir)
  }
  return novelId
}

function chapterAt(novelId: string, order: number) {
  return getDb(projectDir)
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, order)))
    .get()!
}

async function timelineDimension(novelId: string) {
  const result = await checkContinuity(novelId, 1, projectDir)
  expect(result).not.toBeNull()
  return result!.dimensions.find((d) => d.dimension === "事件顺序")!
}

/** 漂移对账所需的弧线与锚定派生（beat/spine 各一条，锚号由调用方指定） */
function seedAnchors(
  novelId: string,
  anchors: { beatChapterOrder: number; beatActualOrder: number; spineChapterOrder: number; spineActualOrder: number },
) {
  const db = getDb(projectDir)
  db.insert(StoryArcTable)
    .values({
      id: `arc-${novelId}`,
      novel_id: novelId,
      arc_type: "main",
      title: "主线",
      planned_start_chapter: 1,
      planned_end_chapter: 3,
      actual_start_chapter: 1,
      actual_end_chapter: 3,
    })
    .run()
  db.insert(ArcBeatTable)
    .values({
      id: `beat-${novelId}`,
      novel_id: novelId,
      arc_id: `arc-${novelId}`,
      chapter_id: chapterAt(novelId, anchors.beatActualOrder).id,
      chapter_order: anchors.beatChapterOrder,
      label: "节拍",
    })
    .run()
  db.insert(StorySpineEntryTable)
    .values({
      id: `spine-${novelId}`,
      novel_id: novelId,
      chapter_id: chapterAt(novelId, anchors.spineActualOrder).id,
      chapter_order: anchors.spineChapterOrder,
      content: "主线事件",
    })
    .run()
}

describe("事件顺序维度升维（chapter-sequence-guard · D5）", () => {
  test("干净库 PASS：序号连续唯一且派生锚定无漂移", async () => {
    const novelId = await setupBook("干净库书")
    const db = getDb(projectDir)
    db.insert(TensionLogTable)
      .values({ id: `tension-${novelId}`, novel_id: novelId, chapter_number: 2, level: 0.5 })
      .run()
    seedAnchors(novelId, { beatChapterOrder: 2, beatActualOrder: 2, spineChapterOrder: 3, spineActualOrder: 3 })

    const dimension = await timelineDimension(novelId)
    expect(dimension.status).toBe("PASS")
    expect(dimension.detail).toContain("连续唯一")
    expect(dimension.detail).toContain("无漂移")
  })

  test("序号重复检出 WARN 并附修复指引", async () => {
    const novelId = await setupBook("重复号书")
    const db = getDb(projectDir)
    db.update(ChapterTable).set({ order: 3 }).where(eq(ChapterTable.id, chapterAt(novelId, 2).id)).run()

    const dimension = await timelineDimension(novelId)
    expect(dimension.status).toBe("WARN")
    expect(dimension.detail).toContain("第 3 章存在 2 条记录（序号重复）")
    expect(dimension.detail).toContain("repair_chapter_sequence")
  })

  test("缺口检出保留：删章后报缺章 WARN", async () => {
    const novelId = await setupBook("缺口书")
    getDb(projectDir).delete(ChapterTable).where(eq(ChapterTable.id, chapterAt(novelId, 2).id)).run()

    const dimension = await timelineDimension(novelId)
    expect(dimension.status).toBe("WARN")
    expect(dimension.detail).toContain("第 1 章后缺章")
  })

  test("派生漂移对账：张力/技法影子指向不存在的章号、节拍/主线锚号过期，均为 WARN 非 FAIL", async () => {
    const novelId = await setupBook("漂移书")
    const db = getDb(projectDir)
    db.insert(TensionLogTable)
      .values({ id: `tension-ghost-${novelId}`, novel_id: novelId, chapter_number: 99, level: 0.5 })
      .run()
    db.insert(TechniqueShadowLogTable)
      .values({ id: `shadow-ghost-${novelId}`, novel_id: novelId, chapter_number: 55, scene_type: "battle" })
      .run()
    // 删第 2 章后锚号过期：节拍记录第 7 章、实为第 3 章；主线记录第 8 章、实为第 1 章
    db.delete(ChapterTable).where(eq(ChapterTable.id, chapterAt(novelId, 2).id)).run()
    seedAnchors(novelId, { beatChapterOrder: 7, beatActualOrder: 3, spineChapterOrder: 8, spineActualOrder: 1 })

    const dimension = await timelineDimension(novelId)
    expect(dimension.status).toBe("WARN")
    expect(dimension.detail).toContain("张力记录指向不存在的第 99 章")
    expect(dimension.detail).toContain("技法影子记录指向不存在的第 55 章")
    expect(dimension.detail).toContain("弧线节拍锚号过期：记录第 7 章、实为第 3 章")
    expect(dimension.detail).toContain("主线事件锚号过期：记录第 8 章、实为第 1 章")
    expect(dimension.status).not.toBe("FAIL")
  })
})
