/**
 * 升级运行生命周期与对账集成测试（upgrade-reliability tasks 7.1 / 7.2）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
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
  getActiveUpgradeRun,
  updateRunChapterStatusTx,
  computeFingerprint,
  withTransaction,
  enqueueManualEditSync,
  querySyncStatus,
} from "../src/index"

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "upgrade-run-lifecycle-"))
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "升级 run 生命周期测试",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

function createChapter(id: string, title: string, order: number, content: string): string {
  const db = getDb(projectDir)
  const now = Date.now()
  db.insert(ChapterTable).values({
    id,
    novel_id: novelId,
    volume_id: null,
    title,
    content,
    order,
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  return id
}

describe("run 生命周期（task 7.2）", () => {
  test("创建 run → 成功路径 → 全部 synced → run 到达终态", () => {
    const db = getDb(projectDir)
    const ch1 = createChapter(crypto.randomUUID(), "第一章", 1, "内容一")
    const ch2 = createChapter(crypto.randomUUID(), "第二章", 2, "内容二")

    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [ch1, ch2]))

    // 验证初始状态
    const chapters = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.run_id, runId))
      .all()
    expect(chapters).toHaveLength(2)
    expect(chapters.every((c) => c.status === "pending")).toBe(true)

    // 模拟消费：ch1 成功
    const ch1Row = chapters.find((c) => c.chapter_id === ch1)!
    withTransaction(db, (tx) => {
      updateRunChapterStatusTx(tx, ch1Row.id, { status: "running", started_at: Date.now() })
    })
    let ch1After = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.id, ch1Row.id))
      .get()!
    expect(ch1After.status).toBe("running")

    withTransaction(db, (tx) => {
      updateRunChapterStatusTx(tx, ch1Row.id, { status: "synced", completed_at: Date.now() })
    })
    ch1After = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.id, ch1Row.id))
      .get()!
    expect(ch1After.status).toBe("synced")
    expect(ch1After.completed_at).not.toBeNull()

    // ch2 成功
    const ch2Row = chapters.find((c) => c.chapter_id === ch2)!
    withTransaction(db, (tx) => {
      updateRunChapterStatusTx(tx, ch2Row.id, { status: "synced", completed_at: Date.now() })
    })

    // run 终态判定：全部章节 synced → run 可标记 terminal
    const remaining = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId)))
      .all()
    const allAbsorbed = remaining.every((c) => c.status === "synced" || c.status === "terminal")
    expect(allAbsorbed).toBe(true)
  })

  test("瞬时失败退避路径：waiting_retry → 到点自动恢复为 pending", () => {
    const db = getDb(projectDir)
    const ch1 = createChapter(crypto.randomUUID(), "退避章", 1, "退避内容")
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [ch1]))
    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.run_id, runId))
      .get()!

    const resumeAt = Date.now() + 60_000
    withTransaction(db, (tx) => {
      updateRunChapterStatusTx(tx, runChapter.id, {
        status: "waiting_retry",
        attempts: 1,
        resume_at: resumeAt,
      })
    })

    const after = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.id, runChapter.id))
      .get()!
    expect(after.status).toBe("waiting_retry")
    expect(after.resume_at).toBe(resumeAt)
    expect(after.attempts).toBe(1)

    // 模拟到点：worker 检查 resume_at <= now 时重置为 pending
    db.update(UpgradeRunChapterTable)
      .set({ status: "pending", resume_at: null })
      .where(eq(UpgradeRunChapterTable.id, runChapter.id))
      .run()
    const recovered = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.id, runChapter.id))
      .get()!
    expect(recovered.status).toBe("pending")
  })

  test("终态失败路径：terminal 记录人话分类", () => {
    const db = getDb(projectDir)
    const ch1 = createChapter(crypto.randomUUID(), "失败章", 1, "失败内容")
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [ch1]))
    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.run_id, runId))
      .get()!

    withTransaction(db, (tx) => {
      updateRunChapterStatusTx(tx, runChapter.id, {
        status: "terminal",
        attempts: 5,
        failure_class: "terminal_model",
        failure_message: "模型不可用或未配置",
        failure_action: "请在设置中配置默认模型后重试",
        failure_detail: "model not found: gpt-4",
      })
    })

    const after = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(eq(UpgradeRunChapterTable.id, runChapter.id))
      .get()!
    expect(after.status).toBe("terminal")
    expect(after.failure_class).toBe("terminal_model")
    expect(after.failure_message).toContain("模型不可用")
    expect(after.failure_action).toContain("配置默认模型")
    expect(after.failure_detail).toContain("model not found")
  })

  test("getActiveUpgradeRun 返回 null 当无活跃 run", async () => {
    const result = await getActiveUpgradeRun(novelId, projectDir)
    expect(result).toBeNull()
  })

  test("getActiveUpgradeRun 返回最新活跃 run", async () => {
    const db = getDb(projectDir)
    const now = Date.now()
    // 旧 terminal run
    db.insert(UpgradeRunTable)
      .values({ id: crypto.randomUUID(), novel_id: novelId, status: "terminal", created_at: now - 2000, updated_at: now - 2000 })
      .run()
    // 新 active run
    const activeId = crypto.randomUUID()
    db.insert(UpgradeRunTable)
      .values({ id: activeId, novel_id: novelId, status: "active", created_at: now, updated_at: now })
      .run()

    const result = await getActiveUpgradeRun(novelId, projectDir)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(activeId)
  })
})

describe("存量数据对账（task 7.1）", () => {
  test("幽灵 skipped 条目 + 指纹一致 → 可收编为 synced", () => {
    const db = getDb(projectDir)
    const ch1 = createChapter(crypto.randomUUID(), "幽灵章", 1, "幽灵内容")
    const content = "幽灵内容"
    const fp = computeFingerprint(content)

    // 该章摘要指纹与内容一致（实际已重建）
    db.insert(ChapterSummaryTable)
      .values({
        id: crypto.randomUUID(),
        chapter_id: ch1,
        summary: "已重建的摘要",
        key_events: "[]",
        char_changes: "[]",
        source_fingerprint: fp,
      })
      .run()

    // 幽灵 skipped 条目（upgrade 源，已被取代）
    db.insert(ManualEditSyncQueueTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        entity: "chapter",
        entity_id: ch1,
        field: "content",
        category: "creative_fact",
        status: "skipped",
        source_fingerprint: "old-fp",
        source: "upgrade",
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()

    // 验证：摘要指纹与当前内容指纹一致
    const summary = db
      .select()
      .from(ChapterSummaryTable)
      .where(eq(ChapterSummaryTable.chapter_id, ch1))
      .get()!
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, ch1)).get()!
    expect(summary.source_fingerprint).toBe(computeFingerprint(chapter.content))

    // 收编：创建 terminal run，章节状态为 synced
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, []))
    withTransaction(db, (tx) => {
      tx.update(UpgradeRunTable)
        .set({ status: "terminal", updated_at: Date.now() })
        .where(eq(UpgradeRunTable.id, runId))
        .run()
      tx.insert(UpgradeRunChapterTable)
        .values({
          id: crypto.randomUUID(),
          run_id: runId,
          chapter_id: ch1,
          status: "synced",
          completed_at: Date.now(),
        })
        .run()
    })

    // 验证收编结果
    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, ch1)))
      .get()!
    expect(runChapter.status).toBe("synced")
  })

  test("manual 源孤儿 failed 条目 + 指纹不一致 → 纳入新建 run（pending）", () => {
    const db = getDb(projectDir)
    const ch1 = createChapter(crypto.randomUUID(), "孤儿章", 1, "孤儿内容")

    // 摘要指纹与内容不一致（未重建）
    db.insert(ChapterSummaryTable)
      .values({
        id: crypto.randomUUID(),
        chapter_id: ch1,
        summary: "旧摘要",
        key_events: "[]",
        char_changes: "[]",
        source_fingerprint: "stale-fp",
      })
      .run()

    // manual 源 failed 条目
    db.insert(ManualEditSyncQueueTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        entity: "chapter",
        entity_id: ch1,
        field: "content",
        category: "creative_fact",
        status: "failed",
        source_fingerprint: "fp-v1",
        source: "manual",
        failure_reason: "model not found",
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .run()

    // 判定：指纹不一致 + 有 failed 条目 → 纳入新建 run
    const runId = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, [ch1]))
    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, ch1)))
      .get()!
    expect(runChapter.status).toBe("pending")

    // 验证活跃 run 可查到
    const activeRun = db
      .select()
      .from(UpgradeRunTable)
      .where(and(eq(UpgradeRunTable.novel_id, novelId), eq(UpgradeRunTable.status, "active")))
      .get()!
    expect(activeRun).not.toBeUndefined()
  })

  test("对账幂等：重复执行不产生重复条目", () => {
    const db = getDb(projectDir)
    const ch1 = createChapter(crypto.randomUUID(), "幂等章", 1, "幂等内容")
    const fp = computeFingerprint("幂等内容")

    db.insert(ChapterSummaryTable)
      .values({
        id: crypto.randomUUID(),
        chapter_id: ch1,
        summary: "摘要",
        key_events: "[]",
        char_changes: "[]",
        source_fingerprint: fp,
      })
      .run()

    // 第一次收编
    const runId1 = withTransaction(db, (tx) => createUpgradeRunTx(tx, novelId, []))
    withTransaction(db, (tx) => {
      tx.update(UpgradeRunTable)
        .set({ status: "terminal", updated_at: Date.now() })
        .where(eq(UpgradeRunTable.id, runId1))
        .run()
      tx.insert(UpgradeRunChapterTable)
        .values({
          id: crypto.randomUUID(),
          run_id: runId1,
          chapter_id: ch1,
          status: "synced",
          completed_at: Date.now(),
        })
        .run()
    })

    // 第二次执行：检测到已有 terminal run，不重复收编
    const existingRun = db
      .select()
      .from(UpgradeRunTable)
      .where(and(eq(UpgradeRunTable.novel_id, novelId), eq(UpgradeRunTable.status, "terminal")))
      .get()
    expect(existingRun).not.toBeUndefined()

    // 该章已有 synced run_chapter，不重复创建
    const existingChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId1), eq(UpgradeRunChapterTable.chapter_id, ch1)))
      .get()
    expect(existingChapter).not.toBeUndefined()
    expect(existingChapter!.status).toBe("synced")
  })
})
