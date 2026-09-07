import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"
import { getDb, NovelTable, ChapterTable, resolveChapterOutline, closeDb } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"

let projectDir: string
let hooks: Awaited<ReturnType<typeof NovelWriterPlugin>>
let novelId: string

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
})

async function seedProject() {
  projectDir = join(tmpdir(), `outline-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel", "outlines"), { recursive: true })
  hooks = await NovelWriterPlugin(createPluginInput(projectDir))
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: novelId, title: "测试书", genre: "科幻", synopsis: "星舰与记忆", status: "draft", created_at: now, updated_at: now })
    .run()
}

function toolCtx(): ToolContext {
  return {
    sessionID: "ses-outline-persistence",
    messageID: "msg-outline-persistence",
    agent: "pipeline",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

describe("chapter outline persistence plugin tools", () => {
  test("generate saves outline to database and syncs markdown", async () => {
    await seedProject()
    const outline = "# 第一章大纲\n\n本章完成星舰起航与记忆异常。"
    await hooks.tool!.generate_chapter_outline.execute(
      { novel_id: novelId, chapter_number: 1, title: "起航", content: outline },
      toolCtx(),
    )

    const chapter = getDb(projectDir)
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novelId))
      .all()
      .find((row) => row.order === 1)
    expect(chapter?.outline).toBe(outline)
    const filePath = join(projectDir, ".novel", "outlines", "chapter-1.md")
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(outline)
  })

  test("read tools stay usable from database when markdown is missing", async () => {
    await seedProject()
    const outline = "# 数据库章纲\n\n数据库有内容，文件缺失。"
    await hooks.tool!.generate_chapter_outline.execute(
      { novel_id: novelId, chapter_number: 2, title: "信号", content: outline },
      toolCtx(),
    )
    const filePath = join(projectDir, ".novel", "outlines", "chapter-2.md")
    rmSync(filePath)

    const chapterResult = await hooks.tool!.read_chapter_outline.execute(
      { novel_id: novelId, chapter_number: 2 },
      toolCtx(),
    )
    expect(chapterResult?.output).toContain(outline)
    expect(chapterResult?.metadata?.outline_available).toBe(true)
    expect(chapterResult?.metadata?.outline_source).toBe("database")

    const outlineResult = await hooks.tool!.read_outline.execute(
      { type: "chapter", number: 2, novel_id: novelId },
      toolCtx(),
    )
    expect(outlineResult?.output).toBe(outline)
    expect(outlineResult?.metadata?.source).toBe("database")
  })

  test("writer snapshot resolves database outline without markdown file", async () => {
    await seedProject()
    const outline = "# 写作快照章纲\n\n包含主角冲突、地点和关键悬念。"
    await hooks.tool!.generate_chapter_outline.execute(
      { novel_id: novelId, chapter_number: 3, title: "异常", content: outline },
      toolCtx(),
    )
    rmSync(join(projectDir, ".novel", "outlines", "chapter-3.md"))

    const resolved = await resolveChapterOutline(novelId, 3, projectDir)
    expect(resolved.source).toBe("database")
    expect(resolved.available).toBe(true)

    const snapshotResult = await hooks.tool!.assemble_context_snapshot.execute(
      { novel_id: novelId, chapter_number: 3 },
      toolCtx(),
    )
    expect(snapshotResult?.output).toContain("本章大纲")
    expect(snapshotResult?.output).toContain(outline)
  })
})
