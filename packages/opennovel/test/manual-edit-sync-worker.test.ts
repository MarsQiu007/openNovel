import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  NovelTable,
  ChapterSummaryTable,
  enqueueManualEditSync,
  querySyncStatus,
} from "@opennovel-ai/novel-store"
import {
  registerSyncHandler,
  clearSyncHandlers,
  processSyncQueue,
  isSyncWorkerRunning,
} from "../src/novel/manual-edit-sync-worker"

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `sync-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "同步 worker 测试",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  clearSyncHandlers()
})

afterEach(() => {
  clearSyncHandlers()
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

describe("processSyncQueue", () => {
  test("无 handler 时确定性更新章节摘要指纹", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    const fp = "fp-abc-123"
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: fp },
      projectDir,
    )

    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(1)

    // 摘要指纹已被确定性更新
    const db = getDb(projectDir)
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapter.id)).get()
    expect(summary?.source_fingerprint).toBe(fp)

    // 同步条目状态变为 synced
    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    const entry = entries.find((e) => e.entity_id === chapter.id)
    expect(entry?.status).toBe("synced")
  })

  test("注册 handler 后调用自定义处理", async () => {
    const chapter = await createChapter(novelId, "第二章", 2, null, projectDir)
    let called = false
    let receivedChapterId = ""
    registerSyncHandler({
      handleChapterContent: async (nid, cid, fp) => {
        called = true
        receivedChapterId = cid
      },
    })

    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp" },
      projectDir,
    )
    await processSyncQueue(projectDir)

    expect(called).toBe(true)
    expect(receivedChapterId).toBe(chapter.id)
  })

  test("设定变更调用 handleSettingChange", async () => {
    let calledEntity = ""
    let calledEntityId = ""
    registerSyncHandler({
      handleSettingChange: async (nid, entity, entityId, fp) => {
        calledEntity = entity
        calledEntityId = entityId
      },
    })

    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-1", field: "name", sourceFingerprint: "fp" },
      projectDir,
    )
    await processSyncQueue(projectDir)

    expect(calledEntity).toBe("character")
    expect(calledEntityId).toBe("char-1")
  })

  test("handler 抛出错误时状态变为 failed 并保留原因", async () => {
    registerSyncHandler({
      handleSettingChange: async () => {
        throw new Error("引用扫描失败")
      },
    })

    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-1", field: "name", sourceFingerprint: "fp" },
      projectDir,
    )
    await processSyncQueue(projectDir)

    const entries = await querySyncStatus(novelId, { status: "failed" }, projectDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].failure_reason).toContain("引用扫描失败")
  })

  test("空队列返回 0", async () => {
    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(0)
  })

  test("批量限制", async () => {
    for (let i = 0; i < 15; i++) {
      await enqueueManualEditSync(
        { novelId, entity: "character", entityId: `char-${i}`, field: "name", sourceFingerprint: `fp-${i}` },
        projectDir,
      )
    }
    const processed = await processSyncQueue(projectDir, 5)
    expect(processed).toBe(5)
  })
})

describe("worker 生命周期", () => {
  test("isSyncWorkerRunning 初始为 false", () => {
    expect(isSyncWorkerRunning()).toBe(false)
  })
})

describe("设定影响面和主轴重建", () => {
  test("设定变更后确定性生成去重影响任务", async () => {
    const { EntityRefTable, PendingUpdateTable } = await import("@opennovel-ai/novel-store")
    const db = getDb(projectDir)

    // 插入一条实体引用（角色 char-1 被章节 ch-1 引用）
    const refId = crypto.randomUUID()
    db.insert(EntityRefTable).values({
      id: refId,
      novel_id: novelId,
      source_type: "chapter",
      source_id: "ch-ref-1",
      target_type: "character",
      target_id: "char-1",
      ref_field: "name",
      ref_text: "引用文本",
    }).run()

    // 同步队列处理设定变更
    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-1", field: "name", sourceFingerprint: "fp" },
      projectDir,
    )
    await processSyncQueue(projectDir)

    // 验证影响任务被创建
    const tasks = db.select().from(PendingUpdateTable).where(eq(PendingUpdateTable.novel_id, novelId)).all()
    expect(tasks.length).toBeGreaterThanOrEqual(1)
    expect(tasks[0]?.trigger_id).toBe("char-1")

    // 再次同步相同设定 → 去重，不生成重复任务
    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-1", field: "name", sourceFingerprint: "fp2" },
      projectDir,
    )
    await processSyncQueue(projectDir)
    const tasksAfter = db.select().from(PendingUpdateTable).where(eq(PendingUpdateTable.novel_id, novelId)).all()
    expect(tasksAfter.length).toBe(tasks.length)
  })

  test("章节同步后结构化主轴条目指纹刷新", async () => {
    const { StorySpineEntryTable } = await import("@opennovel-ai/novel-store")
    const db = getDb(projectDir)
    const chapter = await createChapter(novelId, "主轴测试", 1, null, projectDir)

    // 插入一条待同步主轴条目
    const spineId = crypto.randomUUID()
    db.insert(StorySpineEntryTable).values({
      id: spineId,
      novel_id: novelId,
      chapter_id: chapter.id,
      chapter_order: 1,
      content: "主轴内容",
      kind: "chapter",
      source_fingerprint: null,
      status: "pending",
    }).run()

    // 同步章节正文
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "new-fp" },
      projectDir,
    )
    await processSyncQueue(projectDir)

    // 主轴条目指纹已刷新
    const spine = db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.id, spineId)).get()
    expect(spine?.source_fingerprint).toBe("new-fp")
    expect(spine?.status).toBe("synced")
  })
})

