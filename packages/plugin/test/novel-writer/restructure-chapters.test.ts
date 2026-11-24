/**
 * 固定分章识别与 restructure_chapters 工具测试（fixed-split-restructure · tasks 2.1/2.2）
 *
 * 覆盖：detectFixedSplit 四类判定；list_chapters 固定分章标记；
 * 工具 dry-run 零写入与删除警示、确认应用、参数与校验错误路径。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { asc, eq } from "drizzle-orm"
import {
  ChapterTable,
  ChapterVersionTable,
  closeDb,
  createChapter,
  getDb,
  NovelTable,
} from "../../src/novel-writer/session-store.js"
import { detectFixedSplit } from "../../src/novel-writer/detect-fixed-split.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

describe("detectFixedSplit 纯函数", () => {
  test("全标题匹配且长度均匀命中", () => {
    expect(
      detectFixedSplit([
        { title: "第1部分", wordCount: 3000 },
        { title: "第2部分", wordCount: 3000 },
        { title: "第3部分", wordCount: 3000 },
        { title: "第4部分", wordCount: 800 },
      ]),
    ).toBe(true)
  })

  test("正常章题书籍不命中", () => {
    expect(
      detectFixedSplit([
        { title: "第一章 起风", wordCount: 3000 },
        { title: "第二章 落雨", wordCount: 3100 },
      ]),
    ).toBe(false)
  })

  test("手拟第N部分但长度悬殊不命中", () => {
    expect(
      detectFixedSplit([
        { title: "第1部分", wordCount: 8000 },
        { title: "第2部分", wordCount: 2000 },
        { title: "第3部分", wordCount: 9000 },
      ]),
    ).toBe(false)
  })

  test("末章短余量不影响均匀度，空书不命中", () => {
    expect(
      detectFixedSplit([
        { title: "第1部分", wordCount: 3000 },
        { title: "第2部分", wordCount: 120 },
      ]),
    ).toBe(true)
    expect(detectFixedSplit([])).toBe(false)
  })
})

describe("list_chapters 固定分章标记与 restructure_chapters 工具", () => {
  let projectDir: string
  const tools = createWritingTools()

  beforeEach(async () => {
    projectDir = join(tmpdir(), `restructure-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

  test("list_chapters 命中固定分章标记", async () => {
    const result = await tools.list_chapters.execute({ novel_id: "novel-1" }, createToolContext(projectDir))
    expect(result.output).toContain("fixed_split=true")
    expect(result.metadata?.fixed_split).toBe(true)
  })

  test("list_chapters 正常书籍不携带标记", async () => {
    const rows = listChapters()
    getDb(projectDir).update(ChapterTable).set({ title: "第一章 起风" }).where(eq(ChapterTable.id, rows[0].id)).run()
    const result = await tools.list_chapters.execute({ novel_id: "novel-1" }, createToolContext(projectDir))
    expect(result.output).not.toContain("fixed_split=true")
    expect(result.metadata?.fixed_split).toBe(false)
  })

  test("dry-run 返回预览与删除警示且零写入", async () => {
    const before = listChapters()
    const result = await tools.restructure_chapters.execute(
      {
        novel_id: "novel-1",
        operations: [{ op: "merge", chapterId: before[0].id, nextChapterId: before[1].id }],
      },
      createToolContext(projectDir),
    )
    expect(result.metadata?.applied).toBe(false)
    expect(result.output).toContain("预览")
    expect(result.output).toContain("合并将删除")
    const after = listChapters()
    expect(after.length).toBe(3)
    expect(after.map((c) => c.content)).toEqual(before.map((c) => c.content))
  })

  test("确认应用后结构变更且版本快照落库", async () => {
    const before = listChapters()
    const result = await tools.restructure_chapters.execute(
      {
        novel_id: "novel-1",
        operations: [
          { op: "split", chapterId: before[0].id, anchor: "甲乙丙", newTitle: "第二章 转折" },
          { op: "retitle", chapterId: before[2].id, title: "第三章 归途" },
        ],
        confirm: true,
      },
      createToolContext(projectDir),
    )
    expect(result.metadata?.applied).toBe(true)
    const after = listChapters()
    expect(after.map((c) => c.order)).toEqual([1, 2, 3, 4])
    expect(after.map((c) => c.title)).toEqual(["第1部分", "第二章 转折", "第2部分", "第三章 归途"])
    const versions = getDb(projectDir)
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, before[0].id))
      .all()
    expect(versions.length).toBe(1)
    expect(versions[0].created_by).toBe("restructure")
  })

  test("空方案与缺参返回 param_error", async () => {
    await expect(
      tools.restructure_chapters.execute({ novel_id: "novel-1", operations: [] }, createToolContext(projectDir)),
    ).rejects.toThrow("重切方案为空")
    await expect(
      tools.restructure_chapters.execute(
        { novel_id: "novel-1", operations: [{ op: "split", chapterId: "x" }] },
        createToolContext(projectDir),
      ),
    ).rejects.toThrow("缺少 anchor")
  })

  test("锚点校验失败返回带操作序号的错误", async () => {
    const before = listChapters()
    await expect(
      tools.restructure_chapters.execute(
        { novel_id: "novel-1", operations: [{ op: "split", chapterId: before[0].id, anchor: "不存在" }] },
        createToolContext(projectDir),
      ),
    ).rejects.toThrow("重切方案校验失败")
  })
})
