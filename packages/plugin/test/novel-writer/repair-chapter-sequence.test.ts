/**
 * repair_chapter_sequence 工具测试（chapter-sequence-guard · tasks 4.2 · design D6）
 *
 * 已连续唯一返回「无需修复」且零副作用；缺口/重号库重排为 1..N 并输出
 * 旧→新映射（文本表 + metadata 映射）；幂等重跑第二次返回无需修复。
 *
 * 仿 chapter-sequential-gate.test.ts 的临时目录 SQLite 真实布局 + 全工具装配模式。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

const testDir = join(tmpdir(), `novel-writer-repair-sequence-${Date.now()}`)
const projectDir = join(testDir, "novel-project")
const dbPath = join(projectDir, ".novel", "novel.db")
let prevOpenNovelDb: string | undefined
mkdirSync(join(projectDir, ".novel"), { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import { ChapterTable, TensionLogTable, closeDb, getDb } from "@opennovel-ai/novel-store"
import { and, asc, eq } from "drizzle-orm"

const novelWriterTools = createWritingTools()

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-repair-seq", messageID: "msg-repair-seq", agent: "director" })
}

function repair(novelId: string) {
  return novelWriterTools.repair_chapter_sequence.execute({ novel_id: novelId }, toolCtx())
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

describe("repair_chapter_sequence 工具（chapter-sequence-guard · D6）", () => {
  test("缺口库修复：重排 1..N、文本表与 metadata 双输出映射、张力按新号同步", async () => {
    const novelId = await createBook("缺口修复书", "玄幻", "序号修复工具测试用书籍。")
    for (const order of [1, 2, 3, 4]) {
      await generateChapterOutline(novelId, order, projectDir)
    }
    const db = getDb(projectDir)
    const ch3 = db
      .select({ id: ChapterTable.id })
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, 3)))
      .get()!
    // 制造缺口：绕过 deleteChapter 直接删第 3 章，留下 1、2、4 与指向 4 号的游离张力
    db.delete(ChapterTable).where(eq(ChapterTable.id, ch3.id)).run()
    db.insert(TensionLogTable)
      .values({ id: `tension-${novelId}`, novel_id: novelId, chapter_number: 4, level: 0.5 })
      .run()

    const result = (await repair(novelId)) as {
      output?: string
      metadata?: {
        repaired?: boolean
        mapping?: Array<{ chapter_id: string; old_order: number; new_order: number }>
      }
    }
    expect(result.metadata?.repaired).toBe(true)
    expect(ordersOf(novelId)).toEqual([1, 2, 3])
    expect(result.metadata?.mapping).toEqual([
      { chapter_id: expect.any(String), old_order: 4, new_order: 3 },
    ])
    expect(result.output).toContain("第4章 → 第3章")

    const tension = db
      .select({ chapter_number: TensionLogTable.chapter_number })
      .from(TensionLogTable)
      .where(eq(TensionLogTable.novel_id, novelId))
      .all()
    expect(tension.map((row) => row.chapter_number)).toEqual([3])
  })

  test("重号库修复：按阅读序重排并输出旧→新映射", async () => {
    const novelId = await createBook("重号修复书", "玄幻", "序号修复工具测试用书籍。")
    for (const order of [1, 2, 3]) {
      await generateChapterOutline(novelId, order, projectDir)
    }
    const db = getDb(projectDir)
    // 制造重号：第 2、3 章同为 2 号
    db.update(ChapterTable)
      .set({ order: 2 })
      .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, 3)))
      .run()

    const result = (await repair(novelId)) as {
      output?: string
      metadata?: { repaired?: boolean; mapping?: Array<{ chapter_id: string; old_order: number; new_order: number }> }
    }
    expect(result.metadata?.repaired).toBe(true)
    expect(ordersOf(novelId)).toEqual([1, 2, 3])
    expect(result.metadata?.mapping).toHaveLength(1)
    expect(result.metadata?.mapping?.[0]).toMatchObject({ old_order: 2, new_order: 3 })
    expect(result.output).toContain("第2章 → 第3章")
  })

  test("幂等重跑：已连续时返回无需修复且不作废批量", async () => {
    const novelId = await createBook("幂等重跑书", "玄幻", "序号修复工具测试用书籍。")
    for (const order of [1, 2]) {
      await generateChapterOutline(novelId, order, projectDir)
    }

    const first = (await repair(novelId)) as { output?: string; metadata?: { repaired?: boolean } }
    expect(first.metadata?.repaired).toBe(false)
    expect(first.output).toContain("无需修复")

    const second = (await repair(novelId)) as { output?: string; metadata?: { repaired?: boolean } }
    expect(second.metadata?.repaired).toBe(false)
    expect(second.output).toContain("无需修复")
    expect(ordersOf(novelId)).toEqual([1, 2])
  })
})
