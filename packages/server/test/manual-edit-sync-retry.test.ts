import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { closeDb, getDb, ManualEditSyncQueueTable, NovelTable } from "@opennovel-ai/novel-store"
import { syncRetryEndpoint, upgradeProgressEndpoint } from "../src/handlers/novel"

let projectDir: string
let novelId: string
const failedEntryId = "failed-entry"
const syncedEntryId = "synced-entry"

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "manual-edit-retry-"))
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "重试测试小说",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  db.insert(ManualEditSyncQueueTable).values([
    {
      id: failedEntryId,
      novel_id: novelId,
      entity: "chapter",
      entity_id: "chapter-1",
      field: "content",
      category: "creative_fact",
      status: "failed",
      source_fingerprint: "fp-1",
      failure_reason: "observer 重建失败",
      source: "upgrade",
      created_at: now,
      updated_at: now,
    },
    {
      id: syncedEntryId,
      novel_id: novelId,
      entity: "chapter",
      entity_id: "chapter-2",
      field: "content",
      category: "creative_fact",
      status: "synced",
      source_fingerprint: "fp-2",
      failure_reason: null,
      source: "upgrade",
      created_at: now,
      updated_at: now,
    },
  ]).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 文件句柄可能延迟释放
  }
})

describe("手动编辑同步重试", () => {
  test("只重置 failed 条目并返回计数", async () => {
    const result = await Effect.runPromise(
      syncRetryEndpoint(novelId, { entryIds: [failedEntryId, syncedEntryId, "missing-entry"] }, projectDir),
    )

    expect(result).toEqual({ retried: 1, unchanged: 2 })
    const db = getDb(projectDir)
    const retried = db.select().from(ManualEditSyncQueueTable).where(eq(ManualEditSyncQueueTable.id, failedEntryId)).get()
    const synced = db.select().from(ManualEditSyncQueueTable).where(eq(ManualEditSyncQueueTable.id, syncedEntryId)).get()
    expect(retried?.status).toBe("pending")
    expect(retried?.failure_reason).toBeNull()
    expect(synced?.status).toBe("synced")
  })

  test("升级进度失败项携带队列条目 ID", async () => {
    const result = await Effect.runPromise(upgradeProgressEndpoint(novelId, projectDir))

    expect(result.failed).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toEqual({
      entryId: failedEntryId,
      chapterId: "chapter-1",
      reason: "observer 重建失败",
    })
  })
})
