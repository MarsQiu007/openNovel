/**
 * 人工审批门字数口径测试
 *
 * requestApproval 落库的章节 word_count 与审批详情返回的 wordCount
 * 必须同为网文口径 countWords(content)，不得按 content.length 计数。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { countWords } from "@opennovel-ai/schema/schema"
import { closeDb, getDb, NovelTable, ChapterTable, getEvaluateMetricsPath } from "../src/index.js"
import { requestApproval, handleApproval } from "../src/approval.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

describe("requestApproval 字数口径", () => {
  test("落库与审批详情返回值均为 countWords(content)", async () => {
    const db = getDb(projectDir)
    const now = Date.now()
    db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "审批测试", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now })
      .run()
    db
      .insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", content: "旧正文", word_count: 3, status: "draft", order: 1, created_at: now, updated_at: now })
      .run()

    const content = "新正文，含标点。第二段正文。"
    const detail = await requestApproval("ch-1", content, projectDir)

    const expected = countWords(content)
    expect(expected).not.toBe(content.length)
    expect(detail.wordCount).toBe(expected)
    expect(detail.status).toBe("pending_review")

    const row = db.select().from(ChapterTable).where(eq(ChapterTable.id, "ch-1")).get()
    expect(row?.word_count).toBe(expected)
  })
})

// ── 自评价埋点：审批漏斗（workflow-self-evaluation 1.3） ──

interface MetricEntry {
  domain: string
  key: string
  delta: number
}

function readMetricEntries(): MetricEntry[] {
  const path = getEvaluateMetricsPath(projectDir)
  let content: string
  try {
    content = readFileSync(path, "utf8")
  } catch {
    return []
  }
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function sumKey(entries: MetricEntry[], key: string): number {
  return entries.filter((e) => e.key === key).reduce((sum, e) => sum + e.delta, 0)
}

describe("审批门自评价埋点", () => {
  function seedChapter(chapterId: string) {
    const db = getDb(projectDir)
    const now = Date.now()
    db.insert(NovelTable)
      .values({ id: "novel-1", title: "审批测试", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now })
      .run()
    db.insert(ChapterTable)
      .values({ id: chapterId, novel_id: "novel-1", title: "第一章", content: "正文", word_count: 2, status: "draft", order: 1, created_at: now, updated_at: now })
      .run()
    return db
  }

  test("requestApproval 每次请求计一次 approval.requested", async () => {
    seedChapter("ch-1")
    await requestApproval("ch-1", "新正文一", projectDir)
    await requestApproval("ch-1", "新正文二", projectDir)

    const entries = readMetricEntries()
    expect(sumKey(entries, "approval.requested")).toBe(2)
    expect(entries[0]).toMatchObject({ domain: "c2-prompt-control", key: "approval.requested", delta: 1 })
  })

  test("handleApproval 三分支：APPROVE/REJECT/EDIT 各计对应键", async () => {
    const db = getDb(projectDir)
    const now = Date.now()
    db.insert(NovelTable)
      .values({ id: "novel-1", title: "审批测试", genre: "玄幻", synopsis: "", status: "draft", created_at: now, updated_at: now })
      .run()
    for (const id of ["ch-approve", "ch-reject", "ch-edit"]) {
      db.insert(ChapterTable)
        .values({ id, novel_id: "novel-1", title: "第一章", content: "正文", word_count: 2, status: "draft", order: 1, created_at: now, updated_at: now })
        .run()
    }

    await handleApproval("ch-approve", "APPROVE", projectDir)
    await handleApproval("ch-reject", "REJECT", projectDir)
    await handleApproval("ch-edit", "EDIT", projectDir)

    const entries = readMetricEntries()
    expect(sumKey(entries, "approval.approved")).toBe(1)
    expect(sumKey(entries, "approval.rejected")).toBe(1)
    expect(sumKey(entries, "approval.edited")).toBe(1)
  })
})
