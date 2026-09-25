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
  ManualEditSyncQueueTable,
  enqueueManualEditSync,
  querySyncStatus,
  setUpgradeGate,
} from "@opennovel-ai/novel-store"
import {
  registerSyncHandler,
  clearSyncHandlers,
  processSyncQueue,
} from "../src/novel/manual-edit-sync-worker"

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `upgrade-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "升级调度测试",
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

async function seedChapterAndQueue(source: "manual" | "upgrade", title = "第一章", order = 1) {
  const chapter = await createChapter(novelId, title, order, null, projectDir)
  await enqueueManualEditSync(
    {
      novelId,
      entity: "chapter",
      entityId: chapter.id,
      field: "content",
      sourceFingerprint: `fp-${chapter.id}`,
      source,
    },
    projectDir,
  )
  return chapter
}

describe("升级消费闸门", () => {
  test("闸门 paused 时跳过 upgrade 任务，manual 任务继续消费", async () => {
    const up = await seedChapterAndQueue("upgrade", "升级章", 1)
    const manual = await seedChapterAndQueue("manual", "手动章", 2)
    await setUpgradeGate(getDb(projectDir), novelId, "paused")

    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(1)

    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    const upEntry = entries.find((e) => e.entity_id === up.id)
    const manualEntry = entries.find((e) => e.entity_id === manual.id)
    expect(upEntry?.status).toBe("pending")
    expect(manualEntry?.status).toBe("synced")
  })

  test("续跑后 upgrade 任务恢复消费，已完成项按指纹跳过", async () => {
    const up = await seedChapterAndQueue("upgrade")
    await setUpgradeGate(getDb(projectDir), novelId, "paused")
    await processSyncQueue(projectDir)
    await setUpgradeGate(getDb(projectDir), novelId, "open")

    // 重复入队相同指纹：去重，不新增任务
    await enqueueManualEditSync(
      {
        novelId,
        entity: "chapter",
        entityId: up.id,
        field: "content",
        sourceFingerprint: `fp-${up.id}`,
        source: "upgrade",
      },
      projectDir,
    )
    const db = getDb(projectDir)
    const pendingCount = db
      .select({ id: ManualEditSyncQueueTable.id })
      .from(ManualEditSyncQueueTable)
      .where(eq(ManualEditSyncQueueTable.novel_id, novelId))
      .all().length
    expect(pendingCount).toBe(1)

    registerSyncHandler({ handleChapterContent: async () => {} })
    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(1)
    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    expect(entries.find((e) => e.entity_id === up.id)?.status).toBe("synced")
  })
})

describe("升级任务诚实性", () => {
  test("upgrade 任务无 handler 时标记 failed 且不写摘要指纹", async () => {
    const up = await seedChapterAndQueue("upgrade")
    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(0)

    const db = getDb(projectDir)
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, up.id)).get()
    expect(summary).toBeUndefined()

    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    const entry = entries.find((e) => e.entity_id === up.id)
    expect(entry?.status).toBe("failed")
    expect(entry?.failure_reason).toContain("未重建不得标记已同步")
  })

  test("upgrade 任务调用 handler 重建成功并标记 synced", async () => {
    const up = await seedChapterAndQueue("upgrade")
    let called = false
    registerSyncHandler({
      handleChapterContent: async (nid, cid, fp) => {
        called = true
        // 模拟 observer 重建：写入摘要与指纹
        const db = getDb(projectDir)
        db.insert(ChapterSummaryTable)
          .values({
            id: crypto.randomUUID(),
            chapter_id: cid,
            summary: "重建摘要",
            key_events: "[]",
            char_changes: "[]",
            source_fingerprint: fp,
          })
          .run()
      },
    })

    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(1)
    expect(called).toBe(true)

    const db = getDb(projectDir)
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, up.id)).get()
    expect(summary?.source_fingerprint).toBe(`fp-${up.id}`)
    expect(summary?.summary).toBe("重建摘要")

    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    expect(entries.find((e) => e.entity_id === up.id)?.status).toBe("synced")
  })

  test("单章失败不阻塞其余章节", async () => {
    const fail = await seedChapterAndQueue("upgrade", "失败章", 1)
    const ok = await seedChapterAndQueue("upgrade", "成功章", 2)
    registerSyncHandler({
      handleChapterContent: async (nid, cid, fp) => {
        if (cid === fail.id) throw new Error("observer 调用失败")
      },
    })

    const processed = await processSyncQueue(projectDir)
    expect(processed).toBe(1)

    const entries = await querySyncStatus(novelId, { includeSynced: true }, projectDir)
    expect(entries.find((e) => e.entity_id === fail.id)?.status).toBe("failed")
    expect(entries.find((e) => e.entity_id === ok.id)?.status).toBe("synced")
  })
})
