import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import {
  ChapterSummaryTable,
  ChapterTable,
  ManualEditSyncQueueTable,
  NovelTable,
  closeDb,
  getDb,
} from "@opennovel-ai/novel-store"
import { upgradeStartEndpoint } from "../src/handlers/novel"

let projectDir: string
let oldNovelId: string
let newNovelId: string
let oldChapterId: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "upgrade-scope-"))
  const db = getDb(projectDir)
  oldNovelId = crypto.randomUUID()
  newNovelId = crypto.randomUUID()
  oldChapterId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values([
    {
      id: oldNovelId,
      title: "旧书",
      genre: "玄幻",
      synopsis: "",
      status: "draft",
      created_at: now,
      updated_at: now,
    },
    {
      id: newNovelId,
      title: "新书",
      genre: "玄幻",
      synopsis: "",
      status: "draft",
      created_at: now,
      updated_at: now,
    },
  ]).run()
  db.insert(ChapterTable).values({
    id: oldChapterId,
    novel_id: oldNovelId,
    title: "旧书章节",
    content: "旧书内容",
    content_fingerprint: "old-fingerprint",
    order: 1,
    status: "draft",
    word_count: 4,
    created_at: now,
    updated_at: now,
  }).run()
  db.insert(ChapterSummaryTable).values({
    id: crypto.randomUUID(),
    chapter_id: oldChapterId,
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

describe("升级章节摘要作用域", () => {
  test("新书升级不消费其他书的缺指纹摘要", async () => {
    const result = await Effect.runPromise(upgradeStartEndpoint(newNovelId, projectDir))

    expect(result.queuedChapters).toBe(0)
    const db = getDb(projectDir)
    const newNovelEntries = db
      .select()
      .from(ManualEditSyncQueueTable)
      .where(eq(ManualEditSyncQueueTable.novel_id, newNovelId))
      .all()
    expect(newNovelEntries).toHaveLength(0)
  })

  test("原书升级仍会入队本书缺指纹摘要", async () => {
    const result = await Effect.runPromise(upgradeStartEndpoint(oldNovelId, projectDir))

    expect(result.queuedChapters).toBe(1)
    const db = getDb(projectDir)
    const entries = db
      .select()
      .from(ManualEditSyncQueueTable)
      .where(eq(ManualEditSyncQueueTable.novel_id, oldNovelId))
      .all()
    expect(entries).toHaveLength(1)
    expect(entries[0].entity_id).toBe(oldChapterId)
    expect(entries[0].source).toBe("upgrade")
  })
})
