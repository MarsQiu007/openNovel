import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "path"
import { mkdirSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"
import type { ToolContext } from "../../src/tool.js"

const projectDir = join(tmpdir(), `novel-book-bootstrap-${Date.now()}`)
let hooks: Awaited<ReturnType<typeof NovelWriterPlugin>>

beforeAll(async () => {
  mkdirSync(projectDir, { recursive: true })
  hooks = await NovelWriterPlugin(createPluginInput(projectDir))
})

describe("book bootstrap guard", () => {
  test("rejects a bare first chapter with no core settings", async () => {
    const { getDb, NovelTable, ChapterTable } = await import(
      "../../src/novel-writer/session-store.js"
    )
    const db = getDb(projectDir)
    const novelId = "novel-bootstrap-empty"
    const chapterId = "chapter-bootstrap-empty"

    db.insert(NovelTable)
      .values({ id: novelId, title: "空设定书", genre: "玄幻", synopsis: "测试零设定", status: "draft" })
      .run()
    db.insert(ChapterTable)
      .values({ id: chapterId, novel_id: novelId, title: "第一章", content: "", status: "draft", order: 1 })
      .run()

    const result = await hooks.tool?.write_chapter.execute(
      { chapter_id: chapterId, content: "这是一段完全没有设定支撑的正文。" },
      toolCtx(),
    )
    const metadata = "metadata" in (result ?? {}) ? result.metadata : undefined

    expect(metadata?.blocked).toBe(true)
    expect(metadata?.reason).toBe("uninitialized")
    expect(result?.output).toContain("初始化小说设定")
  })

  test("allows the first chapter when a core setting already exists", async () => {
    const { getDb, NovelTable, ChapterTable, WorldEntryTable } = await import(
      "../../src/novel-writer/session-store.js"
    )
    const db = getDb(projectDir)
    const novelId = "novel-bootstrap-world"
    const chapterId = "chapter-bootstrap-world"

    db.insert(NovelTable)
      .values({ id: novelId, title: "有世界观的书", genre: "仙侠", synopsis: "测试最小设定", status: "draft" })
      .run()
    db.insert(ChapterTable)
      .values({ id: chapterId, novel_id: novelId, title: "第一章", content: "", status: "draft", order: 1 })
      .run()
    db.insert(WorldEntryTable)
      .values({ id: "world-bootstrap", novel_id: novelId, category: "location", title: "青云城", content: "山城。", created_at: 1 })
      .run()

    const result = await hooks.tool?.write_chapter.execute(
      { chapter_id: chapterId, content: "短正文" },
      toolCtx(),
    )
    const metadata = "metadata" in (result ?? {}) ? result.metadata : undefined

    expect(metadata?.reason).toBe("too_short")
    expect(metadata?.reason).not.toBe("uninitialized")
  })

  test("allows existing first-chapter content and later chapters without core settings", async () => {
    const { getDb, NovelTable, ChapterTable } = await import("../../src/novel-writer/session-store.js")
    const db = getDb(projectDir)
    const novelId = "novel-bootstrap-legacy"
    const existingChapterId = "chapter-bootstrap-existing"
    const laterChapterId = "chapter-bootstrap-later"

    db.insert(NovelTable)
      .values({ id: novelId, title: "旧书", genre: "历史", synopsis: "测试旧内容", status: "draft" })
      .run()
    db.insert(ChapterTable)
      .values({ id: existingChapterId, novel_id: novelId, title: "第一章", content: "旧正文", status: "draft", order: 1 })
      .run()
    db.insert(ChapterTable)
      .values({ id: laterChapterId, novel_id: novelId, title: "第二章", content: "", status: "draft", order: 2 })
      .run()

    const existing = await hooks.tool?.write_chapter.execute(
      { chapter_id: existingChapterId, content: "短正文" },
      toolCtx(),
    )
    const later = await hooks.tool?.write_chapter.execute(
      { chapter_id: laterChapterId, content: "短正文" },
      toolCtx(),
    )

    expect("metadata" in (existing ?? {})).toBe(true)
    expect(existing?.metadata?.reason).toBe("too_short")
    expect(later?.metadata?.reason).toBe("too_short")
  })
})

function toolCtx(): ToolContext {
  return {
    sessionID: "ses-bootstrap",
    messageID: "msg-bootstrap",
    agent: "writer",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}
