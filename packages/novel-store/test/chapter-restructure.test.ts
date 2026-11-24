/**
 * 章节结构重切测试（fixed-split-restructure · tasks 1.1/1.3）
 *
 * 覆盖：
 * - simulateRestructure 纯函数：拆分锚点（缺失/多次/首尾空段）、相邻合并、链式 key 引用、
 *   改题、占位重复、章节缺失各校验分支与预览产出
 * - applyRestructure 真实库：拆分版本快照与序号连续、合并级联删除与字数、改题零快照、
 *   漂移拒绝零写入、调用方事务内失败整体回滚、二次应用幂等报错
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { asc, eq } from "drizzle-orm"
import {
  applyRestructure,
  applyRestructureTx,
  ChapterTable,
  ChapterVersionTable,
  closeDb,
  createChapter,
  getDb,
  NovelTable,
  simulateRestructure,
  withTransaction,
  type RestructureChapter,
  type RestructureOp,
} from "../src/index.js"

const chapter = (id: string, order: number, content: string, title = `第${order}部分`): RestructureChapter => ({
  id,
  title,
  content,
  order,
  volumeId: null,
})

describe("simulateRestructure 纯函数校验", () => {
  const chapters = [
    chapter("a", 1, "甲开头。甲乙丙。甲结尾。"),
    chapter("b", 2, "乙开头。乙结尾。"),
    chapter("c", 3, "丙开头。丙结尾。"),
  ]

  test("拆分产出预览与最终模型", () => {
    const result = simulateRestructure(chapters, [{ op: "split", chapterId: "a", anchor: "甲乙丙", newTitle: "新章" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.finalChapters.map((c) => c.title)).toEqual(["第1部分", "新章", "第2部分", "第3部分"])
    expect(result.plan.finalChapters[0].content).toBe("甲开头。")
    expect(result.plan.finalChapters[1].content).toBe("甲乙丙。甲结尾。")
    expect(result.plan.modifiedChapterIds).toEqual(["a"])
    expect(result.plan.deletedChapterIds).toEqual([])
    expect(result.plan.steps[0].anchorOffset).toBe(4)
  })

  test("锚点未出现被拒绝并带操作序号", () => {
    const result = simulateRestructure(chapters, [
      { op: "retitle", chapterId: "a", title: "改名" },
      { op: "split", chapterId: "a", anchor: "不存在" },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.opIndex).toBe(1)
    expect(result.error.message).toContain("第 2 个操作")
    expect(result.error.message).toContain("未出现")
  })

  test("锚点多次出现被拒绝", () => {
    const result = simulateRestructure([chapter("a", 1, "重复。重复。")], [{ op: "split", chapterId: "a", anchor: "重复" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("多次")
  })

  test("锚点位于章首或切出空白尾段被拒绝", () => {
    const head = simulateRestructure(chapters, [{ op: "split", chapterId: "a", anchor: "甲开头" }])
    expect(head.ok).toBe(false)
    const blankTail = simulateRestructure([chapter("a", 1, "甲开头。正文。\n\n")], [
      { op: "split", chapterId: "a", anchor: "\n\n" },
    ])
    expect(blankTail.ok).toBe(false)
  })

  test("合并要求应用时点相邻", () => {
    const result = simulateRestructure(chapters, [{ op: "merge", chapterId: "a", nextChapterId: "c" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("相邻")
  })

  test("合并产出删除清单与追加正文", () => {
    const result = simulateRestructure(chapters, [{ op: "merge", chapterId: "a", nextChapterId: "b" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.deletedChapterIds).toEqual(["b"])
    expect(result.plan.finalChapters.map((c) => c.sourceId)).toEqual(["a", "c"])
    expect(result.plan.finalChapters[0].content).toBe("甲开头。甲乙丙。甲结尾。\n\n乙开头。乙结尾。")
  })

  test("链式：拆分新章可被后续合并引用", () => {
    const result = simulateRestructure(chapters, [
      { op: "split", chapterId: "a", anchor: "甲乙丙", key: "tail" },
      { op: "merge", chapterId: "new:tail", nextChapterId: "b" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.deletedChapterIds).toEqual(["b"])
    expect(result.plan.finalChapters.map((c) => c.sourceId)).toEqual(["a", null, "c"])
    expect(result.plan.finalChapters[1].content).toBe("甲乙丙。甲结尾。\n\n乙开头。乙结尾。")
  })

  test("拆分占位标识重复被拒绝", () => {
    const result = simulateRestructure(chapters, [
      { op: "split", chapterId: "a", anchor: "甲乙丙", key: "x" },
      { op: "split", chapterId: "b", anchor: "乙结尾", key: "x" },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("重复")
  })

  test("改题与空标题校验", () => {
    const ok = simulateRestructure(chapters, [{ op: "retitle", chapterId: "a", title: "第一章 起风" }])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.plan.retitledChapterIds).toEqual(["a"])
    const empty = simulateRestructure(chapters, [{ op: "retitle", chapterId: "a", title: "  " }])
    expect(empty.ok).toBe(false)
  })

  test("引用不存在章节被拒绝", () => {
    const result = simulateRestructure(chapters, [{ op: "split", chapterId: "missing", anchor: "x" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("不存在")
  })
})

describe("applyRestructure 真实库应用", () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = join(tmpdir(), `chapter-restructure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(join(projectDir, ".novel"), { recursive: true })
    const db = getDb(projectDir)
    db.insert(NovelTable)
      .values({ id: "novel-1", title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
      .run()
    await createChapter("novel-1", "第1部分", 1, null, projectDir)
    await createChapter("novel-1", "第2部分", 2, null, projectDir)
    await createChapter("novel-1", "第3部分", 3, null, projectDir)
    const rows = listChapters()
    setContent(rows[0].id, "甲开头。甲乙丙。甲结尾。")
    setContent(rows[1].id, "乙开头。乙结尾。")
    setContent(rows[2].id, "丙开头。丙结尾。")
  })

  afterEach(() => {
    closeDb(projectDir)
    try {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
    }
  })

  function listChapters() {
    return getDb(projectDir)
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, "novel-1"))
      .orderBy(asc(ChapterTable.order))
      .all()
  }

  function setContent(id: string, content: string) {
    getDb(projectDir).update(ChapterTable).set({ content }).where(eq(ChapterTable.id, id)).run()
  }

  function versionsOf(chapterId: string) {
    return getDb(projectDir)
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, chapterId))
      .all()
  }

  test("拆分：版本快照保存原文，新章落位且序号连续", () => {
    const before = listChapters()
    const result = applyRestructure(
      "novel-1",
      [{ op: "split", chapterId: before[0].id, anchor: "甲乙丙", newTitle: "第二章 转折" }],
      projectDir,
    )
    expect(result.createdChapterIds.length).toBe(1)
    expect(result.modifiedChapterIds).toEqual([before[0].id])
    const after = listChapters()
    expect(after.map((c) => c.order)).toEqual([1, 2, 3, 4])
    expect(after.map((c) => c.title)).toEqual(["第1部分", "第二章 转折", "第2部分", "第3部分"])
    expect(after[0].content).toBe("甲开头。")
    expect(after[1].content).toBe("甲乙丙。甲结尾。")
    expect(after[1].word_count).toBeGreaterThan(0)
    const versions = versionsOf(before[0].id)
    expect(versions.length).toBe(1)
    expect(versions[0].created_by).toBe("restructure")
    expect(versions[0].content).toBe("甲开头。甲乙丙。甲结尾。")
    expect(versions[0].version).toBe(1)
  })

  test("合并：目标章追加并快照，被并章级联删除", () => {
    const before = listChapters()
    const result = applyRestructure(
      "novel-1",
      [{ op: "merge", chapterId: before[0].id, nextChapterId: before[1].id }],
      projectDir,
    )
    expect(result.deletedChapterIds).toEqual([before[1].id])
    const after = listChapters()
    expect(after.length).toBe(2)
    expect(after.map((c) => c.order)).toEqual([1, 2])
    expect(after[0].content).toBe("甲开头。甲乙丙。甲结尾。\n\n乙开头。乙结尾。")
    expect(versionsOf(before[0].id).length).toBe(1)
    expect(versionsOf(before[1].id).length).toBe(0)
  })

  test("改题：只更新标题，不落版本快照", () => {
    const before = listChapters()
    applyRestructure("novel-1", [{ op: "retitle", chapterId: before[2].id, title: "第三章 归途" }], projectDir)
    const after = listChapters()
    expect(after[2].title).toBe("第三章 归途")
    expect(versionsOf(before[2].id).length).toBe(0)
  })

  test("既有版本章节快照版本号接续", () => {
    const before = listChapters()
    getDb(projectDir)
      .insert(ChapterVersionTable)
      .values({
        id: "v1",
        chapter_id: before[0].id,
        version: 1,
        content: "旧版本",
        word_count: 3,
        created_at: 1,
        created_by: "write",
      })
      .run()
    applyRestructure("novel-1", [{ op: "split", chapterId: before[0].id, anchor: "甲乙丙" }], projectDir)
    const versions = versionsOf(before[0].id)
    expect(versions.map((v) => v.version).sort((a, b) => a - b)).toEqual([1, 2])
    expect(versions.find((v) => v.version === 2)!.created_by).toBe("restructure")
  })

  test("链式应用：拆分新章并入下一章", () => {
    const before = listChapters()
    const result = applyRestructure(
      "novel-1",
      [
        { op: "split", chapterId: before[0].id, anchor: "甲乙丙", key: "tail" },
        { op: "merge", chapterId: "new:tail", nextChapterId: before[1].id },
      ],
      projectDir,
    )
    const after = listChapters()
    expect(after.length).toBe(3)
    expect(after.map((c) => c.order)).toEqual([1, 2, 3])
    expect(after[0].content).toBe("甲开头。")
    expect(after[1].content).toBe("甲乙丙。甲结尾。\n\n乙开头。乙结尾。")
    expect(result.deletedChapterIds).toEqual([before[1].id])
  })

  test("校验失败零写入", () => {
    const before = listChapters()
    expect(() =>
      applyRestructure("novel-1", [{ op: "split", chapterId: before[0].id, anchor: "不存在" }], projectDir),
    ).toThrow("重切方案校验失败")
    const after = listChapters()
    expect(after.map((c) => c.content)).toEqual(before.map((c) => c.content))
    expect(after.map((c) => c.order)).toEqual([1, 2, 3])
  })

  test("调用方事务内失败整体回滚", () => {
    const before = listChapters()
    expect(() =>
      withTransaction(getDb(projectDir), (tx) => {
        applyRestructureTx(tx, "novel-1", [{ op: "split", chapterId: before[0].id, anchor: "甲乙丙" }])
        throw new Error("模拟应用后失败")
      }),
    ).toThrow("模拟应用后失败")
    const after = listChapters()
    expect(after.length).toBe(3)
    expect(after.map((c) => c.content)).toEqual(before.map((c) => c.content))
    expect(versionsOf(before[0].id).length).toBe(0)
  })

  test("二次应用同一方案报错且不产生新写入", () => {
    const before = listChapters()
    const ops: RestructureOp[] = [{ op: "split", chapterId: before[0].id, anchor: "甲乙丙" }]
    applyRestructure("novel-1", ops, projectDir)
    const settled = listChapters()
    expect(() => applyRestructure("novel-1", ops, projectDir)).toThrow("重切方案校验失败")
    const after = listChapters()
    expect(after.map((c) => c.id)).toEqual(settled.map((c) => c.id))
    expect(after.map((c) => c.content)).toEqual(settled.map((c) => c.content))
  })
})
