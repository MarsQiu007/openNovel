/**
 * state-commit 章节重跑幂等测试（agent-background-job-recovery design D5）
 *
 * 断点续跑要求同章可重跑而不污染状态。修复前三处重复源：
 * - novel_state_log：append-only，重跑一章重复追加 → 章级 reset 后再写
 * - story_spine：无条件追加同章条目 → 同章锚点内替换
 * - .novel/state-log.md：纯 append → 同章段落锚点替换
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join, dirname } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { closeDb } from "@opennovel-ai/novel-store"

const testDir = join(tmpdir(), `state-commit-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const dbPath = join(testDir, "novel.db")

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
})

afterAll(() => {
  closeDb()
  delete process.env.OPENNOVEL_DB
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败，进程退出后系统会回收临时文件
  }
})

const entries = [
  {
    fact_type: "character",
    action: "create",
    entity_id: "char-idem-1",
    data: { name: "角色甲", role: "protagonist", description: "幂等测试角色" },
  },
  {
    fact_type: "chapter_summary",
    action: "create",
    entity_id: "ch-idem-1",
    data: { chapter_id: "ch-idem-1", summary: "主角踏上旅途，遇见神秘老者。" },
  },
]

describe("同章两次 commit 无重复行", () => {
  test("novel_state_log / story_spine / state-log.md 三处幂等", async () => {
    // 导入必须在 OPENNOVEL_DB 设置后
    const { getDb, NovelTable, ChapterTable, NovelStateLogTable } = await import(
      "../../src/novel-writer/session-store.js"
    )
    const { commitState } = await import("../../src/novel-writer/state-commit.js")
    const { eq } = await import("drizzle-orm")

    const db = getDb()
    db.insert(NovelTable).values({ id: "novel-idem", title: "幂等书", genre: "test", synopsis: "", status: "draft" }).run()
    db.insert(ChapterTable)
      .values({ id: "ch-idem-1", novel_id: "novel-idem", title: "第1章", content: "", word_count: 0, status: "draft", order: 1 })
      .run()

    await commitState("novel-idem", "ch-idem-1", entries)
    await commitState("novel-idem", "ch-idem-1", entries)

    // 1. novel_state_log：本章行数 == 单次提交条数（不翻倍）
    const logRows = db.select().from(NovelStateLogTable).where(eq(NovelStateLogTable.chapter_id, "ch-idem-1")).all()
    expect(logRows).toHaveLength(entries.length)

    // 2. story_spine：同章条目恰一份
    const [novel] = db.select({ story_spine: NovelTable.story_spine }).from(NovelTable).where(eq(NovelTable.id, "novel-idem")).all()
    const spineOccurrences = (novel?.story_spine.match(/第1章：/g) ?? []).length
    expect(spineOccurrences).toBe(1)

    // 3. state-log.md：本章段落恰一份
    const logPath = join(dirname(dbPath), "state-log.md")
    expect(existsSync(logPath)).toBe(true)
    const mdOccurrences = (readFileSync(logPath, "utf-8").match(/> 章节：ch-idem-1/g) ?? []).length
    expect(mdOccurrences).toBe(1)
  })
})
