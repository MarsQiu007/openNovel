/**
 * 长篇创作 B/C 阶段数据层测试
 *
 * 覆盖：叙事弧/节点、卷末复盘、主编报告、段落批注、画布布局的 CRUD、
 * 状态转换、外键级联和 listStructureForEditor 聚合排序。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  getDb,
  closeDb,
  NovelTable,
  VolumeTable,
  ChapterTable,
  CharacterTable,
  PlotThreadTable,
  ForeshadowingTable,
  StoryArcTable,
  ArcBeatTable,
  createStoryArc,
  updateStoryArc,
  deleteStoryArc,
  createArcBeat,
  updateArcBeat,
  deleteArcBeat,
  listStoryArcs,
  listArcBeats,
  createVolumeReview,
  listVolumeReviews,
  createEditorialReport,
  listEditorialReports,
  createChapterAnnotation,
  updateChapterAnnotation,
  deleteChapterAnnotation,
  listChapterAnnotations,
  getOutlineCanvasLayout,
  upsertOutlineCanvasLayout,
  listStructureForEditor,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-bc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

async function seedNovel(id = "novel-1") {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id, title: "测试书", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  return id
}

async function seedVolumeChapter(novelId: string) {
  const db = getDb(projectDir)
  await db
    .insert(VolumeTable)
    .values({ id: "vol-1", novel_id: novelId, title: "第一卷", summary: "开端", order: 1, created_at: 1 })
    .run()
  await db
    .insert(ChapterTable)
    .values({
      id: "ch-1",
      novel_id: novelId,
      volume_id: "vol-1",
      title: "第一章",
      content: "段落一\n\n段落二\n\n段落三",
      word_count: 6,
      status: "draft",
      order: 1,
      created_at: 1,
      updated_at: 1,
    })
    .run()
  await db
    .insert(ChapterTable)
    .values({
      id: "ch-2",
      novel_id: novelId,
      volume_id: "vol-1",
      title: "第二章",
      content: "内容",
      word_count: 2,
      status: "draft",
      order: 2,
      created_at: 1,
      updated_at: 1,
    })
    .run()
}

describe("story arcs", () => {
  test("创建叙事弧并查询", async () => {
    const novelId = await seedNovel()
    const arc = await createStoryArc(
      novelId,
      { arcType: "narrative", title: "主线", summary: "主角成长", status: "active", plannedStartChapter: 1, plannedEndChapter: 50 },
      projectDir,
    )
    expect(arc.arc_type).toBe("narrative")
    expect(arc.title).toBe("主线")
    expect(arc.status).toBe("active")
    expect(arc.planned_start_chapter).toBe(1)
    expect(arc.planned_end_chapter).toBe(50)

    const arcs = await listStoryArcs(novelId, projectDir)
    expect(arcs).toHaveLength(1)
    expect(arcs[0].id).toBe(arc.id)
  })

  test("更新叙事弧", async () => {
    const novelId = await seedNovel()
    const arc = await createStoryArc(novelId, { arcType: "subplot", title: "支线", status: "planned" }, projectDir)
    const updated = await updateStoryArc(arc.id, { status: "completed", actualEndChapter: 30, summary: "已收尾" }, projectDir)
    expect(updated.status).toBe("completed")
    expect(updated.actual_end_chapter).toBe(30)
    expect(updated.summary).toBe("已收尾")
  })

  test("删除叙事弧级联节点", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const arc = await createStoryArc(novelId, { arcType: "narrative", title: "主线" }, projectDir)
    await createArcBeat(arc.id, { chapterOrder: 1, label: "开场", kind: "setup", summary: "引入" }, projectDir)
    await deleteStoryArc(arc.id, projectDir)
    const beats = await getDb(projectDir).select().from(ArcBeatTable).where(eq(ArcBeatTable.arc_id, arc.id)).all()
    expect(beats).toHaveLength(0)
  })

  test("角色弧关联 target_character_id", async () => {
    const novelId = await seedNovel()
    const db = getDb(projectDir)
    await db.insert(CharacterTable).values({ id: "char-1", novel_id: novelId, name: "主角", role: "protagonist" }).run()
    const arc = await createStoryArc(
      novelId,
      { arcType: "character", title: "主角弧光", targetCharacterId: "char-1" },
      projectDir,
    )
    expect(arc.target_character_id).toBe("char-1")
  })
})

describe("arc beats", () => {
  test("创建并列出结构节点，按 chapter_order 排序", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const arc = await createStoryArc(novelId, { arcType: "narrative", title: "主线" }, projectDir)
    await createArcBeat(arc.id, { chapterOrder: 3, label: "转折", kind: "turn", summary: "发现真相" }, projectDir)
    await createArcBeat(arc.id, { chapterId: "ch-1", chapterOrder: 1, label: "开场", kind: "setup" }, projectDir)
    await createArcBeat(arc.id, { chapterOrder: 2, label: "铺垫", kind: "rising" }, projectDir)

    const beats = await listArcBeats(arc.id, projectDir)
    expect(beats).toHaveLength(3)
    expect(beats[0].chapter_order).toBe(1)
    expect(beats[1].chapter_order).toBe(2)
    expect(beats[2].chapter_order).toBe(3)
    expect(beats[0].chapter_id).toBe("ch-1")
  })

  test("更新节点状态", async () => {
    const novelId = await seedNovel()
    const arc = await createStoryArc(novelId, { arcType: "narrative", title: "主线" }, projectDir)
    const beat = await createArcBeat(arc.id, { chapterOrder: 1, label: "开场", kind: "setup" }, projectDir)
    const updated = await updateArcBeat(beat.id, { status: "reviewed", summary: "已审阅" }, projectDir)
    expect(updated.status).toBe("reviewed")
    expect(updated.summary).toBe("已审阅")
  })
})

describe("volume reviews", () => {
  test("创建卷末复盘并按 round 倒序返回", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const r1 = await createVolumeReview(
      "vol-1",
      {
        overall: "结构完整但节奏偏慢",
        score: 7.5,
        strengths: ["开场悬念强", "角色动机清晰"],
        weaknesses: ["中段拖沓"],
        structure: { acts: 3 },
        characterArcs: [{ characterId: "char-1", arc: "觉醒" }],
        openThreads: ["凶手身份"],
        recommendations: ["加快第二章节奏"],
      },
      projectDir,
    )
    expect(r1.round).toBe(1)
    expect(r1.score).toBe(7.5)

    const r2 = await createVolumeReview(
      "vol-1",
      { overall: "修订后明显改善", score: 8.5, strengths: ["节奏改善"] },
      projectDir,
    )
    expect(r2.round).toBe(2)

    const list = await listVolumeReviews("vol-1", projectDir)
    expect(list[0].round).toBe(2)
    expect(list[1].round).toBe(1)
  })
})

describe("editorial reports", () => {
  test("创建全书主编报告", async () => {
    const novelId = await seedNovel()
    const report = await createEditorialReport(
      novelId,
      {
        scopeType: "book",
        scopeId: null,
        summary: "全书结构风险中等",
        risks: [{ severity: "high", description: "第三卷伏笔未回收" }],
        recommendations: ["在第四卷安排回收"],
      },
      projectDir,
    )
    expect(report.scope_type).toBe("book")
    const list = await listEditorialReports(novelId, projectDir)
    expect(list).toHaveLength(1)
  })
})

describe("chapter annotations", () => {
  test("创建段落批注并查询", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const ann = await createChapterAnnotation(
      "ch-1",
      novelId,
      {
        source: "user",
        anchorType: "paragraph",
        paragraphIndex: 2,
        quote: "段落三",
        comment: "这里需要加强冲突",
      },
      projectDir,
    )
    expect(ann.paragraph_index).toBe(2)
    expect(ann.status).toBe("open")

    const list = await listChapterAnnotations("ch-1", projectDir)
    expect(list).toHaveLength(1)
    expect(list[0].comment).toBe("这里需要加强冲突")
  })

  test("润色建议带有 suggested_replacement，可标记 applied", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const ann = await createChapterAnnotation(
      "ch-1",
      novelId,
      {
        source: "ai",
        anchorType: "paragraph",
        paragraphIndex: 0,
        quote: "段落一",
        comment: "建议更紧凑",
        suggestedReplacement: "改写后的段落一",
      },
      projectDir,
    )
    expect(ann.suggested_replacement).toBe("改写后的段落一")

    const updated = await updateChapterAnnotation(ann.id, { status: "applied" }, projectDir)
    expect(updated.status).toBe("applied")
  })

  test("按状态筛选批注", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const a1 = await createChapterAnnotation("ch-1", novelId, { source: "user", anchorType: "paragraph", paragraphIndex: 0, quote: "a", comment: "1" }, projectDir)
    await createChapterAnnotation("ch-1", novelId, { source: "ai", anchorType: "paragraph", paragraphIndex: 1, quote: "b", comment: "2" }, projectDir)
    await updateChapterAnnotation(a1.id, { status: "resolved" }, projectDir)

    const open = await listChapterAnnotations("ch-1", projectDir, { status: "open" })
    expect(open).toHaveLength(1)
    const resolved = await listChapterAnnotations("ch-1", projectDir, { status: "resolved" })
    expect(resolved).toHaveLength(1)
  })

  test("删除批注", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const ann = await createChapterAnnotation("ch-1", novelId, { source: "user", anchorType: "chapter", quote: "", comment: "全章" }, projectDir)
    await deleteChapterAnnotation(ann.id, projectDir)
    const list = await listChapterAnnotations("ch-1", projectDir)
    expect(list).toHaveLength(0)
  })
})

describe("outline canvas layout", () => {
  test("首次插入，再次 upsert 更新同一行", async () => {
    const novelId = await seedNovel()
    const created = await upsertOutlineCanvasLayout(novelId, { columns: [{ id: "vol-1", x: 0, width: 300 }] }, projectDir)
    expect(created.layout_json).toEqual({ columns: [{ id: "vol-1", x: 0, width: 300 }] })

    const updated = await upsertOutlineCanvasLayout(novelId, { columns: [{ id: "vol-1", x: 10, width: 320 }] }, projectDir)
    expect(updated.novel_id).toBe(novelId)

    const fetched = await getOutlineCanvasLayout(novelId, projectDir)
    expect(fetched?.layout_json.columns[0].x).toBe(10)
  })

  test("未设置时 getOutlineCanvasLayout 返回 undefined", async () => {
    const novelId = await seedNovel()
    expect(await getOutlineCanvasLayout(novelId, projectDir)).toBeUndefined()
  })
})

describe("listStructureForEditor", () => {
  test("聚合卷、章节、弧、节点、线索、伏笔并按章节排序", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const db = getDb(projectDir)
    await db.insert(CharacterTable).values({ id: "char-1", novel_id: novelId, name: "主角" }).run()
    await db
      .insert(PlotThreadTable)
      .values({ id: "thread-1", novel_id: novelId, title: "谜题", status: "open", priority: "high", description: "谁是内鬼" })
      .run()
    await db
      .insert(ForeshadowingTable)
      .values({ id: "fs-1", novel_id: novelId, planted_chapter_id: "ch-1", content: "神秘钥匙", state: "planted" })
      .run()

    const arc = await createStoryArc(novelId, { arcType: "narrative", title: "主线" }, projectDir)
    await createArcBeat(arc.id, { chapterId: "ch-1", chapterOrder: 1, label: "开场", kind: "setup" }, projectDir)
    await createArcBeat(arc.id, { chapterId: "ch-2", chapterOrder: 2, label: "升温", kind: "rising" }, projectDir)

    const structure = await listStructureForEditor(novelId, projectDir)
    expect(structure.volumes).toHaveLength(1)
    expect(structure.chapters).toHaveLength(2)
    expect(structure.chapters[0].order).toBe(1)
    expect(structure.arcs).toHaveLength(1)
    expect(structure.beats).toHaveLength(2)
    expect(structure.beats[0].chapter_order).toBe(1)
    expect(structure.threads).toHaveLength(1)
    expect(structure.foreshadowing).toHaveLength(1)
    expect(structure.characters).toHaveLength(1)
  })
})

describe("cascade delete", () => {
  test("删除小说级联弧、节点、复盘、批注、画布", async () => {
    const novelId = await seedNovel()
    await seedVolumeChapter(novelId)
    const arc = await createStoryArc(novelId, { arcType: "narrative", title: "主线" }, projectDir)
    await createArcBeat(arc.id, { chapterOrder: 1, label: "开场", kind: "setup" }, projectDir)
    await createVolumeReview("vol-1", { overall: "ok", score: 7 }, projectDir)
    await createEditorialReport(novelId, { scopeType: "book", summary: "ok", risks: [], recommendations: [] }, projectDir)
    await createChapterAnnotation("ch-1", novelId, { source: "user", anchorType: "chapter", quote: "", comment: "全章" }, projectDir)
    await upsertOutlineCanvasLayout(novelId, { columns: [] }, projectDir)

    const db = getDb(projectDir)
    await db.delete(NovelTable).where(eq(NovelTable.id, novelId)).run()

    expect(await db.select().from(StoryArcTable).where(eq(StoryArcTable.novel_id, novelId)).all()).toHaveLength(0)
    expect(await db.select().from(ArcBeatTable).all()).toHaveLength(0)
    expect(await listChapterAnnotations("ch-1", projectDir)).toHaveLength(0)
    expect(await getOutlineCanvasLayout(novelId, projectDir)).toBeUndefined()
  })
})