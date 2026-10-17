import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Effect } from "effect"
import { eq, and } from "drizzle-orm"
import {
  closeDb,
  getDb,
  NovelTable,
  ChapterTable,
  ChapterSummaryTable,
  ManualEditSyncQueueTable,
  UpgradeRunTable,
  UpgradeRunChapterTable,
  createUpgradeRunTx,
  withTransaction,
  computeFingerprint,
} from "@opennovel-ai/novel-store"
import {
  upgradeStartEndpoint,
  upgradeProgressEndpoint,
  upgradePauseEndpoint,
  upgradeResumeEndpoint,
  syncRetryEndpoint,
  upgradeStatusEndpoint,
} from "../src/handlers/novel"

let projectDir: string
let novelId: string
let chapterId: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "upgrade-endpoints-"))
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  chapterId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "端点测试",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  db.insert(ChapterTable).values({
    id: chapterId,
    novel_id: novelId,
    title: "第1章",
    content: "测试内容",
    content_fingerprint: computeFingerprint("测试内容"),
    order: 1,
    status: "draft",
    word_count: 4,
    created_at: now,
    updated_at: now,
  }).run()
  db.insert(ChapterSummaryTable).values({
    id: crypto.randomUUID(),
    chapter_id: chapterId,
    summary: "旧摘要",
    key_events: "[]",
    char_changes: "[]",
    source_fingerprint: null,
  }).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 文件句柄可能延迟释放
  }
})

describe("upgradeStartEndpoint（task 4.1）", () => {
  test("start 后创建 run 且章节数与入队条目数一致", async () => {
    const result = await Effect.runPromise(upgradeStartEndpoint(novelId, projectDir))
    expect(result.queuedChapters).toBe(1)

    const db = getDb(projectDir)
    const run = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).get()
    expect(run).toBeDefined()
    expect(run!.status).toBe("active")

    const runChapters = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.run_id, run!.id))
      .all()
    expect(runChapters).toHaveLength(1)
    expect(runChapters[0].chapter_id).toBe(chapterId)
    expect(runChapters[0].status).toBe("pending")

    const entries = db
      .select()
      .from(ManualEditSyncQueueTable)
      .where(eq(ManualEditSyncQueueTable.novel_id, novelId))
      .all()
    expect(entries).toHaveLength(1)
    expect(entries[0].source).toBe("upgrade")
  })

  test("再次 start 并入既有活跃 run 而非创建第二个", async () => {
    await Effect.runPromise(upgradeStartEndpoint(novelId, projectDir))
    await Effect.runPromise(upgradeStartEndpoint(novelId, projectDir))

    const db = getDb(projectDir)
    const runs = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).all()
    expect(runs).toHaveLength(1)
  })
})

describe("upgradeProgressEndpoint（task 4.2）", () => {
  test("无活跃 run 时回退旧逻辑", async () => {
    const result = await Effect.runPromise(upgradeProgressEndpoint(novelId, projectDir))
    expect(result.total).toBe(0)
    expect(result.synced).toBe(0)
  })

  test("有活跃 run 时从 run_chapter 聚合", async () => {
    const db = getDb(projectDir)
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))

    const result = await Effect.runPromise(upgradeProgressEndpoint(novelId, projectDir))
    expect(result.total).toBe(1)
    expect(result.pending).toBe(1)
    expect(result.synced).toBe(0)
  })

  test("run 内有 waiting_retry 章节时负载携带 waitingRetryList", async () => {
    const db = getDb(projectDir)
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))
    const resumeAt = Date.now() + 60_000
    db.update(UpgradeRunChapterTable)
      .set({ status: "waiting_retry", resume_at: resumeAt, attempts: 1 })
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapterId)))
      .run()

    const result = await Effect.runPromise(upgradeProgressEndpoint(novelId, projectDir))
    expect("waitingRetry" in result && result.waitingRetry).toBe(1)
    expect("waitingRetryList" in result && result.waitingRetryList).toHaveLength(1)
    if ("waitingRetryList" in result && result.waitingRetryList) {
      expect(result.waitingRetryList[0].chapterId).toBe(chapterId)
      expect(result.waitingRetryList[0].resumeAt).toBe(resumeAt)
    }
  })
})

describe("syncRetryEndpoint chapterIds（task 4.3）", () => {
  test("按 chapterIds 重置 terminal 章节为 pending", async () => {
    const db = getDb(projectDir)
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))
    db.update(UpgradeRunChapterTable)
      .set({
        status: "terminal",
        attempts: 3,
        failure_class: "terminal_model",
        failure_message: "模型不可用",
      })
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapterId)))
      .run()

    const result = await Effect.runPromise(
      syncRetryEndpoint(novelId, { entryIds: [], chapterIds: [chapterId] }, projectDir),
    )
    expect(result.retried).toBe(1)

    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapterId)))
      .get()
    expect(runChapter!.status).toBe("pending")
    expect(runChapter!.attempts).toBe(0)
    expect(runChapter!.failure_class).toBeNull()
  })

  test("synced 章节重试时跳过（幂等）", async () => {
    const db = getDb(projectDir)
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))
    db.update(UpgradeRunChapterTable)
      .set({ status: "synced", completed_at: Date.now() })
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapterId)))
      .run()

    const result = await Effect.runPromise(
      syncRetryEndpoint(novelId, { entryIds: [], chapterIds: [chapterId] }, projectDir),
    )
    expect(result.unchanged).toBe(1)
  })
})

describe("upgradePauseEndpoint / upgradeResumeEndpoint（task 4.5）", () => {
  test("暂停后 run.status = paused，恢复后 = active", async () => {
    const db = getDb(projectDir)
    withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))

    const pauseResult = await Effect.runPromise(upgradePauseEndpoint(novelId, projectDir))
    expect(pauseResult.gate).toBe("paused")

    let run = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).get()
    expect(run!.status).toBe("paused")
    expect(run!.paused_at).not.toBeNull()

    const resumeResult = await Effect.runPromise(upgradeResumeEndpoint(novelId, projectDir))
    expect(resumeResult.gate).toBe("open")

    run = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).get()
    expect(run!.status).toBe("active")
    expect(run!.activated_at).not.toBeNull()
  })

  test("无活跃 run 时 pause/resume 为 no-op", async () => {
    const pauseResult = await Effect.runPromise(upgradePauseEndpoint(novelId, projectDir))
    expect(pauseResult.gate).toBe("paused")
    const resumeResult = await Effect.runPromise(upgradeResumeEndpoint(novelId, projectDir))
    expect(resumeResult.gate).toBe("open")
  })
})

describe("upgradeStatusEndpoint 对账（task 4.4）", () => {
  test("孤儿 skipped 条目且指纹一致时收编为 synced", async () => {
    const db = getDb(projectDir)
    const now = Date.now()
    // 预置 skipped 条目（upgrade 源）
    db.insert(ManualEditSyncQueueTable).values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      entity: "chapter",
      entity_id: chapterId,
      field: "content",
      category: "creative_fact",
      status: "skipped",
      source_fingerprint: "old-fp",
      failure_reason: null,
      source: "upgrade",
      created_at: now,
      updated_at: now,
    }).run()
    // 摘要指纹与当前内容一致（已实际完成重建）
    const currentFp = computeFingerprint("测试内容")
    db.update(ChapterSummaryTable)
      .set({ source_fingerprint: currentFp })
      .where(eq(ChapterSummaryTable.chapter_id, chapterId))
      .run()

    await Effect.runPromise(upgradeStatusEndpoint(novelId, projectDir))

    const runs = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).all()
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe("terminal")
    const runChapters = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.run_id, runs[0].id))
      .all()
    expect(runChapters).toHaveLength(1)
    expect(runChapters[0].status).toBe("synced")
  })

  test("孤儿 failed 条目且指纹不一致时纳入新建 run（pending）", async () => {
    const db = getDb(projectDir)
    const now = Date.now()
    db.insert(ManualEditSyncQueueTable).values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      entity: "chapter",
      entity_id: chapterId,
      field: "content",
      category: "creative_fact",
      status: "failed",
      source_fingerprint: "stale-fp",
      failure_reason: "模型超时",
      source: "manual",
      created_at: now,
      updated_at: now,
    }).run()

    await Effect.runPromise(upgradeStatusEndpoint(novelId, projectDir))

    const runs = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).all()
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe("active")
    const runChapters = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.run_id, runs[0].id))
      .all()
    expect(runChapters).toHaveLength(1)
    expect(runChapters[0].status).toBe("pending")
  })

  test("无孤儿条目时不创建 run", async () => {
    await Effect.runPromise(upgradeStatusEndpoint(novelId, projectDir))
    const db = getDb(projectDir)
    const runs = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.novel_id, novelId)).all()
    expect(runs).toHaveLength(0)
  })

  test("活跃 run 内 run_chapter 已实际完成（指纹匹配）时对账自愈为 synced", async () => {
    const db = getDb(projectDir)
    // 创建活跃 run + run_chapter pending（模拟时序竞争遗留）
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))
    // 摘要指纹已与当前内容一致（工作已完成，只是 run_chapter 未更新）
    const currentFp = computeFingerprint("测试内容")
    db.update(ChapterSummaryTable)
      .set({ source_fingerprint: currentFp })
      .where(eq(ChapterSummaryTable.chapter_id, chapterId))
      .run()

    await Effect.runPromise(upgradeStatusEndpoint(novelId, projectDir))

    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapterId)))
      .get()
    expect(runChapter!.status).toBe("synced")
    expect(runChapter!.completed_at).not.toBeNull()
    // 全部章节已 synced → run 标记 terminal
    const run = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.id, runId)).get()
    expect(run!.status).toBe("terminal")
  })

  test("活跃 run 内 run_chapter 指纹不匹配时保持 pending", async () => {
    const db = getDb(projectDir)
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [chapterId]))
    // 摘要指纹与当前内容不一致（工作未完成）
    db.update(ChapterSummaryTable)
      .set({ source_fingerprint: "stale-fp" })
      .where(eq(ChapterSummaryTable.chapter_id, chapterId))
      .run()

    await Effect.runPromise(upgradeStatusEndpoint(novelId, projectDir))

    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapterId)))
      .get()
    expect(runChapter!.status).toBe("pending")
    const run = db.select().from(UpgradeRunTable).where(eq(UpgradeRunTable.id, runId)).get()
    expect(run!.status).toBe("active")
  })
})
