import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb, getDb, NovelTable, ChapterTable, WorldEntryTable } from "@opennovel-ai/novel-store"
import { NovelNotFoundError } from "@opennovel-ai/protocol/groups/novel"
import { createAnnotationEndpoint } from "../src/handlers/novel"
import { resolveAnnotationTarget } from "../src/annotation-targets"

let tempDir: string
let novelId: string
let chapterId: string
let entryId: string

// 三段章节正文（reader 按 \n\n+ 分段）
const CHAPTER_CONTENT = "第一段文字内容。\n\n第二段文字内容。\n\n第三段文字内容。"
// 三行设定正文（reader 按 \n+ 分段并 trim）
const ENTRY_CONTENT = "青云门位于山巅。\n门规森严。\n弟子众多。"

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "annotation-anchor-test-"))
  const db = getDb(tempDir)
  novelId = crypto.randomUUID()
  chapterId = crypto.randomUUID()
  entryId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: novelId, title: "Test Novel", genre: "玄幻", synopsis: "", created_at: now, updated_at: now, status: "draft" })
    .run()
  db.insert(ChapterTable)
    .values({
      id: chapterId,
      novel_id: novelId,
      title: "Chapter 1",
      content: CHAPTER_CONTENT,
      word_count: 21,
      status: "draft",
      order: 1,
      created_at: now,
      updated_at: now,
    })
    .run()
  db.insert(WorldEntryTable)
    .values({ id: entryId, novel_id: novelId, category: "势力", title: "青云门", content: ENTRY_CONTENT, created_at: now })
    .run()
})

afterEach(() => {
  closeDb(tempDir)
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

async function expectAnchorError(effect: Effect.Effect<unknown, NovelNotFoundError>, message: string) {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(NovelNotFoundError)
  expect(error.data.message).toBe(message)
}

describe("批注目标注册表", () => {
  test("注册表包含正文与设定目标", () => {
    expect(resolveAnnotationTarget("chapter", "content")).toBeDefined()
    expect(resolveAnnotationTarget("world_entry", "content")).toBeDefined()
  })
})

describe("章节批注锚点校验", () => {
  test("接受合法的单段批注并持久化", async () => {
    const ann = await Effect.runPromise(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter",
        targetId: chapterId,
        field: "content",
        anchorType: "range",
        paragraphIndex: 0,
        startOffset: 0,
        endOffset: 4,
        quote: "第一段文",
        comment: "单段批注",
      }, tempDir),
    )
    expect(ann.endParagraphIndex).toBeUndefined()
    expect(ann.quote).toBe("第一段文")
    expect(ann.targetType).toBe("chapter")
    expect(ann.targetId).toBe(chapterId)
    expect(ann.field).toBe("content")
  })

  test("接受合法的跨段批注并持久化 endParagraphIndex", async () => {
    const ann = await Effect.runPromise(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter",
        targetId: chapterId,
        field: "content",
        anchorType: "range",
        paragraphIndex: 0,
        startOffset: 3,
        endOffset: 3,
        endParagraphIndex: 2,
        quote: "文字内容。\n第二段文字内容。\n第三段",
        comment: "跨段批注",
      }, tempDir),
    )
    expect(ann.endParagraphIndex).toBe(2)
    expect(ann.endOffset).toBe(3)
  })

  test("整章批注无需锚点字段", async () => {
    const ann = await Effect.runPromise(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter",
        targetId: chapterId,
        field: "content",
        anchorType: "chapter",
        comment: "整体评价",
      }, tempDir),
    )
    expect(ann.anchorType).toBe("chapter")
  })

  test("拒绝引用文本为空的段落批注", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "content",
        anchorType: "range", paragraphIndex: 0, startOffset: 0, endOffset: 2, quote: "", comment: "评论",
      }, tempDir),
      "批注引用文本不能为空",
    )
  })

  test("拒绝段落索引越界", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "content",
        anchorType: "range", paragraphIndex: 9, startOffset: 0, endOffset: 2, quote: "不存在", comment: "评论",
      }, tempDir),
      "段落索引超出章节内容范围",
    )
  })

  test("拒绝单段引用与原文不一致", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "content",
        anchorType: "range", paragraphIndex: 0, startOffset: 0, endOffset: 4, quote: "不一样的文", comment: "评论",
      }, tempDir),
      "批注引用与章节内容不一致",
    )
  })

  test("拒绝结束段落索引小于起始段落索引", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "content",
        anchorType: "range", paragraphIndex: 2, startOffset: 0, endOffset: 2, endParagraphIndex: 0, quote: "第三段", comment: "评论",
      }, tempDir),
      "结束段落索引不得小于起始段落索引",
    )
  })

  test("拒绝结束段落索引越界", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "content",
        anchorType: "range", paragraphIndex: 0, startOffset: 0, endOffset: 2, endParagraphIndex: 9, quote: "第一段文", comment: "评论",
      }, tempDir),
      "结束段落索引超出章节内容范围",
    )
  })

  test("拒绝结束偏移量超出结束段落长度", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "content",
        anchorType: "range", paragraphIndex: 0, startOffset: 0, endOffset: 99, endParagraphIndex: 1, quote: "第一段文字内容。第二段", comment: "评论",
      }, tempDir),
      "批注结束偏移量超出段落范围",
    )
  })

  test("章节不存在时返回 not found", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: "no-such-chapter", field: "content",
        anchorType: "range", paragraphIndex: 0, startOffset: 0, endOffset: 2, quote: "第一段文", comment: "评论",
      }, tempDir),
      "Novel not found: no-such-chapter",
    )
  })
})

describe("设定批注锚点校验（跨段扩展）", () => {
  test("接受合法的跨段批注并持久化 endParagraphIndex", async () => {
    const ann = await Effect.runPromise(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry",
        targetId: entryId,
        field: "content",
        anchorType: "paragraph",
        paragraphIndex: 0,
        startOffset: 3,
        endOffset: 2,
        endParagraphIndex: 1,
        quote: "位于山巅。\n门规",
        comment: "跨段设定批注",
      }, tempDir),
    )
    expect(ann.endParagraphIndex).toBe(1)
    expect(ann.endOffset).toBe(2)
  })

  test("跨段 quote 允许段间分隔符差异（去空白宽松比较）", async () => {
    const ann = await Effect.runPromise(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry",
        targetId: entryId,
        field: "content",
        anchorType: "paragraph",
        paragraphIndex: 0,
        startOffset: 3,
        endOffset: 2,
        endParagraphIndex: 2,
        quote: "位于山巅。门规森严。弟子",
        comment: "无换行分隔的跨段引用",
      }, tempDir),
    )
    expect(ann.endParagraphIndex).toBe(2)
  })

  test("拒绝结束段落索引小于起始段落索引", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "paragraph", paragraphIndex: 1, startOffset: 0, endOffset: 2, endParagraphIndex: 0, quote: "门规", comment: "评论",
      }, tempDir),
      "结束段落索引不得小于起始段落索引",
    )
  })

  test("拒绝结束段落索引越界", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "paragraph", paragraphIndex: 0, startOffset: 0, endOffset: 2, endParagraphIndex: 9, quote: "青云", comment: "评论",
      }, tempDir),
      "结束段落索引超出设定内容范围",
    )
  })

  test("拒绝结束偏移量超出结束段落长度", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "paragraph", paragraphIndex: 0, startOffset: 0, endOffset: 99, endParagraphIndex: 1, quote: "青云门位于山巅。门规森严", comment: "评论",
      }, tempDir),
      "批注结束偏移量超出段落范围",
    )
  })

  test("拒绝跨段引用与原文不一致", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "paragraph", paragraphIndex: 0, startOffset: 3, endOffset: 2, endParagraphIndex: 1, quote: "完全无关的文字", comment: "评论",
      }, tempDir),
      "批注引用与设定内容不一致",
    )
  })

  test("单段批注保持严格校验", async () => {
    const ann = await Effect.runPromise(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "paragraph", paragraphIndex: 0, startOffset: 0, endOffset: 3, quote: "青云门", comment: "单段批注",
      }, tempDir),
    )
    expect(ann.endParagraphIndex).toBeUndefined()
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "paragraph", paragraphIndex: 0, startOffset: 0, endOffset: 3, quote: "青云 门", comment: "含空白的引用",
      }, tempDir),
      "批注引用与设定内容不一致",
    )
  })

  test("设定目标拒绝整章批注", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "world_entry", targetId: entryId, field: "content",
        anchorType: "chapter", comment: "整体评价",
      }, tempDir),
      "整章批注仅支持章节目标",
    )
  })
})

describe("统一批注目标模型", () => {
  test("拒绝未注册的目标字段组合", async () => {
    await expectAnchorError(
      createAnnotationEndpoint(novelId, {
        targetType: "chapter", targetId: chapterId, field: "title",
        paragraphIndex: 0, startOffset: 0, endOffset: 2, quote: "第一段文", comment: "评论",
      }, tempDir),
      "不支持的批注目标: chapter.title",
    )
  })
})
