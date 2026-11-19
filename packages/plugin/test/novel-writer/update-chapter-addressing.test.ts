/**
 * update_chapter 寻址与归属测试（tool-failure-semantics 3.3）
 *
 * - chapter_id / chapter_number 二选一寻址（对齐 read_chapter_content）
 * - 可选 novel_id：传参走 resolveNovelId 参数匹配；未传单书兜底；多书未传 param_error
 * - 归属过滤：跨小说的章节标识视为不存在（not_found）
 * - 工具与参数描述声明章节标识来源约束
 *
 * 仿 chapter-sequential-gate.test.ts 的临时目录 SQLite + 全工具装配模式，走真实工具调用。
 * 单书用例依赖库内恰一本书：文件内测试按声明顺序执行，单书用例必须排在建第二本书之前。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

const testDir = join(tmpdir(), `novel-writer-update-chapter-addressing-${Date.now()}`)
const projectDir = join(testDir, "novel-project")
const dbPath = join(projectDir, ".novel", "novel.db")
let prevOpenNovelDb: string | undefined
mkdirSync(join(projectDir, ".novel"), { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import { ChapterTable, closeDb, getDb } from "@opennovel-ai/novel-store"
import { and, eq } from "drizzle-orm"

function insertChapter(novelId: string, order: number, title: string, status: string) {
  const db = getDb(projectDir)
  db.insert(ChapterTable)
    .values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      title,
      content: "",
      word_count: 0,
      status,
      outline: "",
      order,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()
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

function getChapterRow(novelId: string, order: number) {
  const db = getDb(projectDir)
  const [row] = db
    .select()
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, order)))
    .all()
  return row
}

const novelWriterTools = createWritingTools()

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-update-chapter-addressing", messageID: "msg-update-chapter-addressing", agent: "director" })
}

/** 失败用例统一捕获：返回 Error（含 name=稳定类别），无异常时返回 null */
function expectFailure(run: Promise<unknown>): Promise<Error | null> {
  return run.then(
    () => null,
    (e: Error) => e,
  )
}

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

describe("update-chapter-addressing 寻址与归属", () => {
  test("单书不传 novel_id：chapter_number 与 chapter_id 双寻址命中", async () => {
    const novelId = await createBook("寻址序号书", "玄幻", "update_chapter 寻址测试。")
    insertChapter(novelId, 1, "第一章旧标题", "outline")
    insertChapter(novelId, 2, "旧标题", "outline")
    const result = await novelWriterTools.update_chapter.execute({ chapter_number: 2, title: "新标题", status: "draft" }, toolCtx())
    const typed = result as { output?: string; metadata?: { chapter_id?: string; status?: string } }
    expect(typed.output).toContain("已更新第2章")
    expect(typed.metadata?.status).toBe("draft")
    const row = getChapterRow(novelId, 2)
    expect(row.title).toBe("新标题")
    expect(row.status).toBe("draft")
    expect(typed.metadata?.chapter_id).toBe(row.id)

    const chapterId = getChapterId(novelId, 1)
    const byId = (await novelWriterTools.update_chapter.execute({ chapter_id: chapterId, status: "audited" }, toolCtx())) as {
      metadata?: { chapter_id?: string; status?: string }
    }
    expect(byId.metadata?.chapter_id).toBe(chapterId)
    expect(byId.metadata?.status).toBe("audited")
    expect(getChapterRow(novelId, 1).status).toBe("audited")
  })

  test("缺定位参数：chapter_id 与 chapter_number 均未传 param_error", async () => {
    const novelId = await createBook("缺定位书", "玄幻", "update_chapter 缺定位测试。")
    const err = await expectFailure(novelWriterTools.update_chapter.execute({ novel_id: novelId, title: "x" }, toolCtx()))
    expect(err?.name).toBe("param_error")
    expect(err?.message).toContain("chapter_id 或 chapter_number")
  })

  test("多书未传 novel_id：无法唯一解析归属 param_error 并指引", async () => {
    // 前面用例已建 3 本书，库内必然多本
    const err = await expectFailure(novelWriterTools.update_chapter.execute({ chapter_number: 1, title: "x" }, toolCtx()))
    expect(err?.name).toBe("param_error")
    expect(err?.message).toContain("novel_id")
    expect(err?.message).toContain("list_novels")
  })

  test("跨小说章节标识不命中：他书 UUID 按归属过滤 not_found", async () => {
    const novelA = await createBook("归属过滤书A", "玄幻", "update_chapter 归属过滤测试 A。")
    const novelB = await createBook("归属过滤书B", "玄幻", "update_chapter 归属过滤测试 B。")
    insertChapter(novelB, 1, "B书第一章", "outline")
    const chapterIdOfB = getChapterId(novelB, 1)
    const err = await expectFailure(
      novelWriterTools.update_chapter.execute({ novel_id: novelA, chapter_id: chapterIdOfB, title: "x" }, toolCtx()),
    )
    expect(err?.name).toBe("not_found")
    expect(err?.message).toContain("章节不存在")
    expect(err?.message).toContain("list_chapters")
    expect(getChapterRow(novelB, 1).title).toBe("B书第一章")
  })

  test("传 novel_id 按序号更新：多书环境下显式归属命中", async () => {
    const novelId = await createBook("显式归属书", "玄幻", "update_chapter 显式归属测试。")
    insertChapter(novelId, 3, "第三章旧标题", "outline")
    const result = await novelWriterTools.update_chapter.execute(
      { novel_id: novelId, chapter_number: 3, title: "第三章新标题" },
      toolCtx(),
    )
    const typed = result as { output?: string }
    expect(typed.output).toContain("已更新第3章")
    expect(getChapterRow(novelId, 3).title).toBe("第三章新标题")
  })
})

describe("update-chapter-addressing 描述声明", () => {
  test("工具描述声明章节标识来源约束与双寻址", () => {
    const desc = novelWriterTools.update_chapter.description
    expect(desc).toContain("章节标识来源")
    expect(desc).toContain("禁止自行构造")
    expect(desc).toContain("list_chapters")
    expect(desc).toContain("chapter_number")
  })

  test("参数描述声明章节标识来源与 novel_id 归属语义", () => {
    const fields = novelWriterTools.update_chapter.args.fields as Record<string, { ast?: { types?: Array<{ annotations?: { description?: string } }> } }>
    const annOf = (key: string) => {
      const field = fields[key]
      const ast = field?.ast
      const inner = ast?.types?.[0] ?? ast
      return (inner as { annotations?: { description?: string } } | undefined)?.annotations?.description ?? ""
    }
    expect(fields.chapter_id).toBeDefined()
    expect(fields.chapter_number).toBeDefined()
    expect(fields.novel_id).toBeDefined()
    expect(annOf("chapter_id")).toContain("禁止自行构造")
    expect(annOf("chapter_id")).toContain("list_chapters")
    expect(annOf("novel_id")).toContain("库内多本小说时必须提供")
  })
})
