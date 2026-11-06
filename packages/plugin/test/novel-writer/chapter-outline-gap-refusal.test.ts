/**
 * 章纲跳号拒绝消息翻译测试（chapter-sequence-guard · tasks 2.3）
 *
 * generate_chapter_outline 越过前置缺口生成章纲时，store 层 ChapterSequenceGapError
 * 在工具边界被翻译为用户可读消息（报缺失章号 + 先补前置章指引），且不写入任何记录；
 * 顺序生成保持原有成功路径。
 *
 * 仿 chapter-sequential-gate.test.ts 的临时目录 SQLite + 全工具装配模式，走真实工具调用。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

const testDir = join(tmpdir(), `novel-writer-outline-gap-${Date.now()}`)
const projectDir = join(testDir, "novel-project")
// db 必须放在真实布局 <projectDir>/.novel/novel.db：projectDirFromCtx 从 db 路径反推项目根
const dbPath = join(projectDir, ".novel", "novel.db")
let prevOpenNovelDb: string | undefined
mkdirSync(join(projectDir, ".novel"), { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import { ChapterTable, closeDb, getDb } from "@opennovel-ai/novel-store"
import { and, asc, eq } from "drizzle-orm"

const novelWriterTools = createWritingTools()

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-outline-gap", messageID: "msg-outline-gap", agent: "director" })
}

function generateOutline(novelId: string, chapterNumber: number) {
  return novelWriterTools.generate_chapter_outline.execute(
    { novel_id: novelId, chapter_number: chapterNumber, title: "", content: "" },
    toolCtx(),
  )
}

function ordersOf(novelId: string): number[] {
  return getDb(projectDir)
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .orderBy(asc(ChapterTable.order))
    .all()
    .map((row) => row.order)
}

beforeAll(async () => {
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

describe("generate_chapter_outline 跳号拒绝翻译（chapter-sequence-guard）", () => {
  test("库中只有第 1 章时生成第 3 章：拒绝消息报缺失章号与补齐指引，且不落库", async () => {
    const novelId = await createBook("跳号拒绝书", "玄幻", "章纲跳号拒绝消息翻译测试用书籍。")
    await generateChapterOutline(novelId, 1, projectDir)

    const result = (await generateOutline(novelId, 3)) as {
      output?: string
      metadata?: { refused?: boolean; missing_order?: number; chapter_number?: number }
    }
    expect(result.metadata?.refused).toBe(true)
    expect(result.metadata?.missing_order).toBe(2)
    expect(result.metadata?.chapter_number).toBe(3)
    expect(result.output).toContain("生成被拒绝")
    expect(result.output).toContain("第 2 章")
    expect(result.output).toContain("缺失")
    expect(result.output).toContain("补齐第 2 章")

    // 拒绝路径不得写入任何章节记录
    const db = getDb(projectDir)
    const count = db
      .select({ id: ChapterTable.id })
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, 3)))
      .all()
    expect(count).toHaveLength(0)
    expect(ordersOf(novelId)).toEqual([1])
  })

  test("顺序补齐第 2、3 章保持成功路径，序号连续", async () => {
    const novelId = await createBook("顺序补齐书", "玄幻", "章纲顺序补齐成功路径测试用书籍。")
    await generateChapterOutline(novelId, 1, projectDir)

    const second = (await generateOutline(novelId, 2)) as { output?: string; metadata?: { refused?: boolean } }
    expect(second.output).toContain("已生成第2章大纲")
    expect(second.metadata?.refused).toBeFalsy()

    const third = (await generateOutline(novelId, 3)) as { output?: string; metadata?: { refused?: boolean } }
    expect(third.output).toContain("已生成第3章大纲")
    expect(third.metadata?.refused).toBeFalsy()

    expect(ordersOf(novelId)).toEqual([1, 2, 3])
  })
})
