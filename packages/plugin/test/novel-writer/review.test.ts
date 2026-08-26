/**
 * 章节评审持久化测试（审批详情）
 *
 * 覆盖 createChapterReview 的 round 自动推导、计数计算、
 * listChapterReviews 排序，以及 checkContinuity 返回 chapterId。
 * 使用临时 SQLite 数据库，测试结束后自动清理。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { closeDb } from "@opennovel-ai/novel-store"
import { tmpdir } from "os"

// DB 路径必须在模块导入前设置，因为各模块的 getDb() 在首次调用时读取该环境变量
const testDir = join(tmpdir(), `novel-review-test-${Date.now()}`)
const originalOpenNovelDb = process.env.OPENNOVEL_DB
process.env.OPENNOVEL_DB = join(testDir, "test.db")
mkdirSync(testDir, { recursive: true })

import { eq } from "drizzle-orm"
import {
  getDb,
  NovelTable,
  ChapterTable,
  createChapterReview,
  listChapterReviews,
} from "../../src/novel-writer/session-store.js"
import { checkContinuity } from "../../src/novel-writer/continuity-check.js"

const novelId = crypto.randomUUID()
const chapterId = crypto.randomUUID()

beforeAll(async () => {
  const db = getDb()
  await db
    .insert(NovelTable)
    .values({
      id: novelId,
      title: "评审测试小说",
      genre: "玄幻",
      synopsis: "测试",
      created_at: Date.now(),
      updated_at: Date.now(),
      status: "draft",
    })
    .run()
  await db
    .insert(ChapterTable)
    .values({
      id: chapterId,
      novel_id: novelId,
      volume_id: null,
      title: "第1章",
      content: "测试内容",
      word_count: 4,
      status: "drafting",
      order: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()
})

afterAll(() => {
  closeDb()
  // 恢复原值，避免污染同进程内按 directory 隔离的其他测试文件
  if (originalOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = originalOpenNovelDb
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

describe("createChapterReview", () => {
  test("首次评审 round=1，计数按 dimensions 状态统计", async () => {
    const review = await createChapterReview(chapterId, {
      source: "deterministic",
      overall: "FAIL",
      dimensions: [
        { dimension: "姓名一致性", status: "PASS", detail: "一致" },
        { dimension: "性格一致", status: "WARN", detail: "轻微波动" },
        { dimension: "因果链", status: "FAIL", detail: "动机缺失", evidence: "第3段" },
      ],
      summary: "测试评审",
      sessionId: "session-1",
    })
    expect(review.round).toBe(1)
    expect(review.source).toBe("deterministic")
    expect(review.pass_count).toBe(1)
    expect(review.warn_count).toBe(1)
    expect(review.fail_count).toBe(1)
    expect(JSON.parse(review.dimensions)).toHaveLength(3)
    expect(review.session_id).toBe("session-1")
  })

  test("内容未变更时再次评审并入同一 round", async () => {
    const review = await createChapterReview(chapterId, {
      source: "auditor",
      overall: "WARN",
      dimensions: [{ dimension: "性格一致", status: "WARN", detail: "轻微波动" }],
      summary: "auditor 复审",
    })
    expect(review.round).toBe(1)
    expect(review.source).toBe("auditor")
  })

  test("章节内容变更后评审开启新 round", async () => {
    const db = getDb()
    await db
      .update(ChapterTable)
      .set({ content: "修订后的新内容", updated_at: Date.now() + 1000 })
      .where(eq(ChapterTable.id, chapterId))
      .run()
    const review = await createChapterReview(chapterId, {
      source: "deterministic",
      overall: "PASS",
      dimensions: [],
      summary: "修订后复检",
    })
    expect(review.round).toBe(2)
  })

  test("章节不存在时抛错", async () => {
    await expect(createChapterReview("nonexistent-chapter", { source: "human", overall: "PASS" })).rejects.toThrow(
      "未找到章节",
    )
  })

  test("human 评审无 dimensions 时计数为 0", async () => {
    const review = await createChapterReview(chapterId, {
      source: "human",
      overall: "FAIL",
      summary: "驳回：战斗节奏太拖",
    })
    expect(review.pass_count).toBe(0)
    expect(review.warn_count).toBe(0)
    expect(review.fail_count).toBe(0)
    expect(review.summary).toBe("驳回：战斗节奏太拖")
  })
})

describe("listChapterReviews", () => {
  test("返回全部评审，最新在前", async () => {
    const reviews = await listChapterReviews(chapterId)
    expect(reviews.length).toBe(4)
    expect(reviews[0].summary).toBe("驳回：战斗节奏太拖")
    expect(reviews[reviews.length - 1].round).toBe(1)
  })
})

describe("checkContinuity", () => {
  test("返回 chapterId 供评审持久化使用", async () => {
    const result = await checkContinuity(novelId, 1)
    expect(result).toBeTruthy()
    expect(result!.chapterId).toBe(chapterId)
    expect(result!.dimensions.length).toBe(37)
  })
})
