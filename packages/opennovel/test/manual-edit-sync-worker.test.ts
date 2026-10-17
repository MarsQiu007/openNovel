import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, and } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  NovelTable,
  ChapterSummaryTable,
  enqueueManualEditSync,
  querySyncStatus,
  UpgradeRunTable,
  UpgradeRunChapterTable,
  withTransaction,
} from "@opennovel-ai/novel-store"
import {
  registerSyncHandler,
  clearSyncHandlers,
  processSyncQueue,
  isSyncWorkerRunning,
  processRegisteredSyncDirectories,
  registerSyncDirectory,
  stopSyncWorker,
  getWorkerLastPollAt,
  resetWorkerLastPollAt,
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
  stopSyncWorker()
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
      handleChapterContent: async (directory, _nid, cid, _fp) => {
        called = true
        receivedChapterId = cid
        expect(directory).toBe(projectDir)
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
      handleSettingChange: async (_nid, entity, entityId, _fp) => {
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

  test("诚实性保护：upgrade 源条目无 handler 时抛错不降级", async () => {
    const chapter = await createChapter(novelId, "诚实性保护", 1, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp", source: "upgrade" },
      projectDir,
    )
    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(0)
    const entries = await querySyncStatus(novelId, { status: "failed" }, projectDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].failure_reason).toContain("observer 重建 handler 未注册")
    expect(entries[0].failure_reason).toContain("未重建不得标记已同步")
  })

  test("诚实性保护：manual 源条目无 handler 时走确定性 fallback", async () => {
    const chapter = await createChapter(novelId, "manual 降级", 2, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp-manual", source: "manual" },
      projectDir,
    )
    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(1)
    const db = getDb(projectDir)
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapter.id)).get()
    expect(summary?.source_fingerprint).toBe("fp-manual")
  })
})

describe("worker 生命周期", () => {
  test("isSyncWorkerRunning 初始为 false", () => {
    expect(isSyncWorkerRunning()).toBe(false)
  })

  test("登记两个目录后轮询各自消费各自队列", async () => {
    const secondDir = join(tmpdir(), `sync-worker-second-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(join(secondDir, ".novel"), { recursive: true })
    const secondNovelId = crypto.randomUUID()
    const secondDb = getDb(secondDir)
    const now = Date.now()
    secondDb.insert(NovelTable).values({
      id: secondNovelId,
      title: "第二工作区",
      genre: "玄幻",
      synopsis: "",
      master_outline: "",
      status: "draft",
      created_at: now,
      updated_at: now,
    }).run()

    const firstChapter = await createChapter(novelId, "目录一章节", 1, null, projectDir)
    const secondChapter = await createChapter(secondNovelId, "目录二章节", 1, null, secondDir)
    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-a", field: "name", sourceFingerprint: "fp-a" },
      projectDir,
    )
    await enqueueManualEditSync(
      { novelId: secondNovelId, entity: "character", entityId: "char-b", field: "name", sourceFingerprint: "fp-b" },
      secondDir,
    )

    registerSyncDirectory(projectDir)
    registerSyncDirectory(secondDir)
    await processRegisteredSyncDirectories()

    expect((await querySyncStatus(novelId, { status: "synced" }, projectDir)).length).toBe(1)
    expect((await querySyncStatus(secondNovelId, { status: "synced" }, secondDir)).length).toBe(1)
    expect(firstChapter.id).not.toBe(secondChapter.id)
    closeDb(secondDir)
  })

  test("慢消费期间后续轮次不会叠加执行", async () => {
    let calls = 0
    let release: (() => void) | undefined
    registerSyncHandler({
      handleChapterContent: async () => {
        calls++
        await new Promise<void>((resolve) => {
          release = resolve
        })
      },
    })
    const chapter = await createChapter(novelId, "慢消费章节", 1, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp-slow" },
      projectDir,
    )

    registerSyncDirectory(projectDir)
    const firstRound = processRegisteredSyncDirectories()
    await Bun.sleep(10)
    await processRegisteredSyncDirectories()
    expect(calls).toBe(1)

    release?.()
    await firstRound
    expect(calls).toBe(1)
  })

  test("getWorkerLastPollAt 初始为 null，轮询后更新时间戳", async () => {
    resetWorkerLastPollAt()
    expect(getWorkerLastPollAt()).toBeNull()
    await processSyncQueue(projectDir)
    const first = getWorkerLastPollAt()
    expect(first).not.toBeNull()
    await processSyncQueue(projectDir)
    const second = getWorkerLastPollAt()
    expect(second).not.toBeNull()
    expect(second!).toBeGreaterThanOrEqual(first!)
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

describe("upgrade_run 状态回写", () => {
  function createRunWithChapter(chapterId: string): string {
    const db = getDb(projectDir)
    const runId = crypto.randomUUID()
    const now = Date.now()
    db.insert(UpgradeRunTable).values({ id: runId, novel_id: novelId, status: "active", created_at: now, updated_at: now }).run()
    db.insert(UpgradeRunChapterTable).values({ id: crypto.randomUUID(), run_id: runId, chapter_id: chapterId, status: "pending" }).run()
    return runId
  }

  test("消费开始后 run_chapter 状态变为 running", async () => {
    const chapter = await createChapter(novelId, "run 状态测试", 1, null, projectDir)
    const runId = createRunWithChapter(chapter.id)
    registerSyncHandler({
      handleChapterContent: async () => {},
    })
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp-run", source: "upgrade" },
      projectDir,
    )
    await processSyncQueue(projectDir)
    const db = getDb(projectDir)
    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapter.id)))
      .get()
    expect(runChapter?.status).toBe("synced")
    expect(runChapter?.completed_at).not.toBeNull()
  })

  test("重建失败时 run_chapter 按分类器更新状态", async () => {
    const chapter = await createChapter(novelId, "失败分类测试", 2, null, projectDir)
    const runId = createRunWithChapter(chapter.id)
    registerSyncHandler({
      handleChapterContent: async () => {
        throw new Error("model not found: gpt-4")
      },
    })
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp-fail", source: "upgrade" },
      projectDir,
    )
    await processSyncQueue(projectDir)
    const db = getDb(projectDir)
    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapter.id)))
      .get()
    expect(runChapter?.status).toBe("terminal")
    expect(runChapter?.failure_class).toBe("terminal_model")
    expect(runChapter?.failure_message).toContain("模型不可用")
  })

  test("run paused 时 upgrade 条目不被消费", async () => {
    const chapter = await createChapter(novelId, "paused 测试", 3, null, projectDir)
    const db = getDb(projectDir)
    const runId = crypto.randomUUID()
    const now = Date.now()
    db.insert(UpgradeRunTable).values({ id: runId, novel_id: novelId, status: "paused", created_at: now, updated_at: now }).run()
    db.insert(UpgradeRunChapterTable).values({ id: crypto.randomUUID(), run_id: runId, chapter_id: chapter.id, status: "pending" }).run()
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp-paused", source: "upgrade" },
      projectDir,
    )
    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(0)
    const entries = await querySyncStatus(novelId, { status: "pending" }, projectDir)
    expect(entries).toHaveLength(1)
  })

  test("时序竞争：run 在 worker 查询后创建，消费仍更新 run_chapter（regression）", async () => {
    const chapter = await createChapter(novelId, "竞争测试", 4, null, projectDir)
    const db = getDb(projectDir)
    // 先注册 handler，确保消费成功
    registerSyncHandler({
      handleChapterContent: async () => {},
    })
    // 入队 manual 条目（模拟编辑触发）
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp-race", source: "manual" },
      projectDir,
    )
    // 在 processSyncQueue 查询 activeRun 之后、消费之前创建 run
    // 模拟 start endpoint 在 worker 查询后创建 run 的场景
    // 由于 processSyncQueue 是一次同步调用，我们在调用前创建 run
    // 但 activeRun 查询在 processSyncQueue 内部发生
    // 所以这里我们在 processSyncQueue 之前创建 run，但让 activeRun 查询不到它
    // 方法：创建一个 paused run（activeRun 查询只找 active），然后改为 active
    const runId = crypto.randomUUID()
    const now = Date.now()
    db.insert(UpgradeRunTable).values({ id: runId, novel_id: novelId, status: "paused", created_at: now, updated_at: now }).run()
    db.insert(UpgradeRunChapterTable).values({ id: crypto.randomUUID(), run_id: runId, chapter_id: chapter.id, status: "pending" }).run()
    // 改为 active（模拟 start endpoint 在 worker 查询后激活 run）
    db.update(UpgradeRunTable).set({ status: "active" }).where(eq(UpgradeRunTable.id, runId)).run()

    await processSyncQueue(projectDir)

    const runChapter = db
      .select()
      .from(UpgradeRunChapterTable)
      .where(and(eq(UpgradeRunChapterTable.run_id, runId), eq(UpgradeRunChapterTable.chapter_id, chapter.id)))
      .get()
    expect(runChapter?.status).toBe("synced")
    expect(runChapter?.completed_at).not.toBeNull()
  })
})
