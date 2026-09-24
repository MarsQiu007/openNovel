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
  enqueueManualEditSync,
} from "@opennovel-ai/novel-store"
import {
  checkContentSyncGate,
  checkSettingImpactGate,
  skipSyncEntries,
} from "../src/novel-writer/edit-sync-gate"

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `sync-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "门禁测试小说",
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

describe("checkContentSyncGate", () => {
  test("无 pending 同步时放行", () => {
    const result = checkContentSyncGate(novelId, undefined, projectDir)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.blockingSyncIds).toHaveLength(0)
  })

  test("有 pending 正文同步时阻塞", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp" },
      projectDir,
    )
    const result = checkContentSyncGate(novelId, undefined, projectDir)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("同步未完成")
    expect(result.blockingSyncIds).toHaveLength(1)
    expect(result.skippable).toBe(true)
  })

  test("failed 同步返回失败原因", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp" },
      projectDir,
    )
    const entries = getDb(projectDir).select().from((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable).all()
    await skipSyncEntries([], projectDir) // no-op
    // 手动标记失败
    const db = getDb(projectDir)
    await db.update((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable)
      .set({ status: "failed", failure_reason: "LLM 超时" })
      .where(eq((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable.id, entries[0]!.id))
      .run()

    const result = checkContentSyncGate(novelId, undefined, projectDir)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("LLM 超时")
  })

  test("已跳过条目不再阻塞", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp" },
      projectDir,
    )
    const entries = getDb(projectDir).select().from((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable).all()
    await skipSyncEntries(entries.map((e) => e.id), projectDir)

    const result = checkContentSyncGate(novelId, undefined, projectDir)
    expect(result.allowed).toBe(true)
  })
})

describe("checkSettingImpactGate", () => {
  test("无设定联动任务时放行", () => {
    const result = checkSettingImpactGate(novelId, projectDir)
    expect(result.allowed).toBe(true)
  })

  test("有未处理设定任务时阻塞并包含目标对象", async () => {
    await enqueueManualEditSync(
      { novelId, entity: "character", entityId: "char-1", field: "name", sourceFingerprint: "fp" },
      projectDir,
    )
    await enqueueManualEditSync(
      { novelId, entity: "world_entry", entityId: "world-1", field: "title", sourceFingerprint: "fp" },
      projectDir,
    )
    const result = checkSettingImpactGate(novelId, projectDir)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("character")
    expect(result.reason).toContain("world_entry")
  })
})

describe("skipSyncEntries", () => {
  test("跳过后状态为 skipped 可追溯", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    await enqueueManualEditSync(
      { novelId, entity: "chapter", entityId: chapter.id, field: "content", sourceFingerprint: "fp" },
      projectDir,
    )
    const entries = getDb(projectDir).select().from((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable).all()
    await skipSyncEntries(entries.map((e) => e.id), projectDir)

    const db = getDb(projectDir)
    const entry = db.select().from((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable)
      .where(eq((await import("@opennovel-ai/novel-store")).ManualEditSyncQueueTable.id, entries[0]!.id))
      .get()
    expect(entry?.status).toBe("skipped")
  })
})
