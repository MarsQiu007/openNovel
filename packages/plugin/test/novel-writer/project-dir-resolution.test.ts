/**
 * 项目根解析不变式测试（projectdir-hardening）。
 *
 * projectDirFromCtx 恒等解析：项目根只由 directory 决定，与 OPENNOVEL_DB
 * db 路径重定向解耦；缺省回退 process.cwd()。
 *
 * 行为回归部分复用 chapter-sequential-gate 测试装配，故意把 OPENNOVEL_DB
 * 指到与 projectDir 不同层级（复现修复前的误设场景），断言模式配置仍从
 * 正确项目根读取（顺序门禁照常拦截）。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { projectDirFromCtx } from "../../src/novel-writer/tools/shared.js"

describe("project-dir-resolution 解析不变式", () => {
  test("恒等解析：任意 directory 返回自身", () => {
    expect(projectDirFromCtx("D:\\some\\novel-project")).toBe("D:\\some\\novel-project")
    expect(projectDirFromCtx("/tmp/novel-project")).toBe("/tmp/novel-project")
  })

  test("OPENNOVEL_DB 设为任意路径不影响解析结果", () => {
    const prev = process.env.OPENNOVEL_DB
    try {
      process.env.OPENNOVEL_DB = "D:\\elsewhere\\misplaced.db"
      expect(projectDirFromCtx("/tmp/novel-project")).toBe("/tmp/novel-project")
    } finally {
      if (prev === undefined) delete process.env.OPENNOVEL_DB
      else process.env.OPENNOVEL_DB = prev
    }
  })

  test("null/undefined 回退 process.cwd()（env 设置与否一致）", () => {
    const prev = process.env.OPENNOVEL_DB
    try {
      delete process.env.OPENNOVEL_DB
      expect(projectDirFromCtx(null)).toBe(process.cwd())
      expect(projectDirFromCtx()).toBe(process.cwd())
      process.env.OPENNOVEL_DB = "D:\\elsewhere\\misplaced.db"
      expect(projectDirFromCtx(null)).toBe(process.cwd())
    } finally {
      if (prev === undefined) delete process.env.OPENNOVEL_DB
      else process.env.OPENNOVEL_DB = prev
    }
  })
})

// ─── 行为回归：OPENNOVEL_DB 误设时模式配置仍从正确项目根读取 ───

const testDir = join(tmpdir(), `novel-writer-projectdir-hardening-${Date.now()}`)
const projectDir = join(testDir, "novel-project")
// 故意非标准布局：db 在 projectDir 之外（修复前该布局会让门禁静默失效、写入直接成功）
const misplacedDbPath = join(testDir, "misplaced.db")
let prevOpenNovelDb: string | undefined

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import { ChapterTable, closeDb, getDb, WorldEntryTable } from "@opennovel-ai/novel-store"
import { and, eq } from "drizzle-orm"

function setWritingMode(mode: "auto" | "review") {
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  writeFileSync(join(projectDir, ".novel", "config.json"), JSON.stringify({ writing_mode: mode }))
}

function getChapterId(novelId: string, order: number): string {
  const db = getDb(projectDir)
  const [row] = db
    .select({ id: ChapterTable.id })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, order)))
    .all()
  return row.id
}

const novelWriterTools = createWritingTools()

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-projectdir", messageID: "msg-projectdir", agent: "writer" })
}

beforeAll(() => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = misplacedDbPath
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  initNovelProject(projectDir)
})

afterAll(() => {
  closeDb(projectDir)
  if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = prevOpenNovelDb
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
})

describe("project-dir-resolution 行为回归（OPENNOVEL_DB 误设）", () => {
  test("db 重定向到 projectDir 之外时顺序门禁仍从正确项目根读配置", async () => {
    const novelId = await createBook("误设重定向书", "玄幻", "项目根解析回归用书籍。")
    setWritingMode("review")
    await generateChapterOutline(novelId, 1, projectDir)
    const db = getDb(projectDir)
    db.insert(WorldEntryTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        category: "location",
        title: "回归测试 山门",
        content: "测试世界观条目。",
        created_at: Date.now(),
      })
      .run()
    // 第 1 章置待审、第 2 章待写：review 模式顺序门禁应拦截第 2 章
    db.update(ChapterTable)
      .set({ status: "pending_review", updated_at: Date.now() })
      .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, 1)))
      .run()
    db.insert(ChapterTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        title: "第二章",
        content: "",
        word_count: 0,
        status: "outline",
        outline: "",
        order: 2,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()

    const result = await novelWriterTools.write_chapter.execute(
      { chapter_id: getChapterId(novelId, 2), content: "正文内容不足以通过篇幅门禁，但顺序门禁先拦。" },
      toolCtx(),
    )
    const typed = result as { metadata?: { blocked?: boolean; reason?: string } }
    expect(typed.metadata?.blocked).toBe(true)
    expect(typed.metadata?.reason).toBe("sequential_blocked")
  })
})
