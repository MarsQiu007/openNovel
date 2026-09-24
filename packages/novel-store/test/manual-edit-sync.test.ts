import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  NovelTable,
  ChapterTable,
  ManualEditSyncQueueTable,
  StorySpineEntryTable,
  ChapterSummaryTable,
} from "../src/index.js"
import {
  computeFingerprint,
  enqueueManualEditSync,
  querySyncStatus,
  updateSyncStatus,
  saveBookMeta,
  markDerivedStale,
} from "../src/manual-edit-sync.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `manual-edit-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

async function seedNovelWithChapter() {
  const db = getDb(projectDir)
  const novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "测试小说",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()!
  const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
  return { novel, chapter }
}

describe("manual_edit_sync_queue 表", () => {
  test("旧数据库打开后新表存在", () => {
    const db = getDb(projectDir)
    const result = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='manual_edit_sync_queue'")
    expect(result).toHaveLength(1)
  })

  test("插入同步条目并读取", async () => {
    const { novel } = await seedNovelWithChapter()
    const { queued } = await enqueueManualEditSync(
      { novelId: novel.id, entity: "chapter", entityId: "ch1", field: "content", sourceFingerprint: "abc" },
      projectDir,
    )
    expect(queued).toBe(true)
    const entries = await querySyncStatus(novel.id, { includeSynced: true }, projectDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].entity).toBe("chapter")
    expect(entries[0].status).toBe("pending")
  })
})

describe("指纹去重与合并", () => {
  test("相同指纹不重复入队", async () => {
    const { novel } = await seedNovelWithChapter()
    const fp = computeFingerprint("同一段内容")
    const r1 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp }, projectDir)
    const r2 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp }, projectDir)
    expect(r1.queued).toBe(true)
    expect(r2.queued).toBe(false)
    expect(r2.deduped).toBe(true)
  })

  test("新指纹作废旧 pending 任务并重新入队", async () => {
    const { novel } = await seedNovelWithChapter()
    const fp1 = computeFingerprint("版本1")
    const fp2 = computeFingerprint("版本2")
    await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp1 }, projectDir)
    const r2 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp2 }, projectDir)
    expect(r2.queued).toBe(true)

    const entries = await querySyncStatus(novel.id, { includeSynced: true }, projectDir)
    // 旧任务被标记为 skipped，新任务 pending
    const skipped = entries.filter((e) => e.status === "skipped")
    const pending = entries.filter((e) => e.status === "pending")
    expect(skipped).toHaveLength(1)
    expect(pending).toHaveLength(1)
    expect(pending[0].source_fingerprint).toBe(fp2)
  })

  test("失败重试：failed 任务重新入队", async () => {
    const { novel } = await seedNovelWithChapter()
    const fp = computeFingerprint("内容A")
    const r1 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp }, projectDir)
    expect(r1.queued).toBe(true)

    // 模拟失败
    const entries1 = await querySyncStatus(novel.id, { status: "pending" }, projectDir)
    await updateSyncStatus(entries1[0].id, "failed", "网络超时", projectDir)

    // 同指纹重试
    const r2 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp }, projectDir)
    // 相同指纹的 failed 任务应该重新入队
    expect(r2.queued).toBe(true)
  })

  test("已跳过任务不会阻塞新任务", async () => {
    const { novel } = await seedNovelWithChapter()
    const fp1 = computeFingerprint("版本A")
    const r1 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp1 }, projectDir)
    const entries1 = await querySyncStatus(novel.id, { status: "pending" }, projectDir)
    await updateSyncStatus(entries1[0].id, "skipped", null, projectDir)

    // 不同指纹新任务应该正常入队
    const fp2 = computeFingerprint("版本B")
    const r2 = await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: fp2 }, projectDir)
    expect(r2.queued).toBe(true)
  })
})

describe("同步状态查询", () => {
  test("默认只返回非 synced 条目", async () => {
    const { novel } = await seedNovelWithChapter()
    await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: "fp1" }, projectDir)
    await enqueueManualEditSync({ novelId: novel.id, entity: "character", entityId: "char1", sourceFingerprint: "fp2" }, projectDir)

    // 标记第一个为 synced
    const entries = await querySyncStatus(novel.id, { includeSynced: true }, projectDir)
    await updateSyncStatus(entries[0].id, "synced", null, projectDir)

    // 默认查询只返回 pending
    const active = await querySyncStatus(novel.id, undefined, projectDir)
    expect(active).toHaveLength(1)
    expect(active[0].entity).toBe("character")
  })

  test("按状态过滤", async () => {
    const { novel } = await seedNovelWithChapter()
    await enqueueManualEditSync({ novelId: novel.id, entity: "chapter", entityId: "ch1", sourceFingerprint: "fp1" }, projectDir)
    const pending = await querySyncStatus(novel.id, { status: "pending" }, projectDir)
    expect(pending).toHaveLength(1)

    const failed = await querySyncStatus(novel.id, { status: "failed" }, projectDir)
    expect(failed).toHaveLength(0)
  })
})

describe("联合保存 saveBookMeta", () => {
  test("同时保存元数据和风格指南", async () => {
    const { novel } = await seedNovelWithChapter()
    const result = await saveBookMeta(novel.id, {
      title: "新标题",
      synopsis: "新简介",
      styleGuide: { tone: "幽默", pov: "第三人称" },
    }, projectDir)

    expect(result.novel.title).toBe("新标题")
    expect(result.novel.synopsis).toBe("新简介")
    expect(result.styleGuide).not.toBeNull()
    expect(result.styleGuide!.tone).toBe("幽默")
    expect(result.styleGuide!.pov).toBe("第三人称")
  })

  test("目标不存在时抛出错误", async () => {
    await seedNovelWithChapter()
    await expect(saveBookMeta("nonexistent-id", { title: "x" }, projectDir)).rejects.toThrow("Novel not found")
  })
})

describe("markDerivedStale", () => {
  test("正文修改后派生数据被标记", async () => {
    const { novel, chapter } = await seedNovelWithChapter()

    // 先插入一条已有摘要
    const db = getDb(projectDir)
    db.insert(ChapterSummaryTable).values({
      id: crypto.randomUUID(),
      chapter_id: chapter.id,
      summary: "旧摘要",
    }).run()

    const newFp = computeFingerprint("新的正文内容")
    await markDerivedStale(novel.id, chapter.id, newFp, projectDir)

    // 摘要指纹被清空（待校验）
    const summary = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapter.id)).get() as typeof ChapterSummaryTable.$inferSelect
    expect(summary.source_fingerprint).toBeNull()

    // 同步队列入队了新任务
    const entries = await querySyncStatus(novel.id, { status: "pending" }, projectDir)
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })
})

describe("story_spine_entries 表", () => {
  test("旧数据库打开后新表存在", () => {
    const db = getDb(projectDir)
    const result = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='story_spine_entries'")
    expect(result).toHaveLength(1)
  })

  test("插入结构化主轴条目", async () => {
    const { novel, chapter } = await seedNovelWithChapter()
    const db = getDb(projectDir)
    const id = crypto.randomUUID()
    db.insert(StorySpineEntryTable).values({
      id,
      novel_id: novel.id,
      chapter_id: chapter.id,
      chapter_order: 1,
      content: "主轴条目内容",
      kind: "chapter",
      source_fingerprint: computeFingerprint("主轴内容"),
      status: "synced",
    }).run()

    const entry = db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.id, id)).get()
    expect(entry).toBeDefined()
    expect(entry!.content).toBe("主轴条目内容")
    expect(entry!.kind).toBe("chapter")
  })
})

describe("历史数据兼容", () => {
  test("旧数据库（无同步表）打开后正常工作", () => {
    // 创建一个旧 schema 的 DB
    const legacyDbPath = join(projectDir, ".novel", "novel.db")
    const legacy = new Database(legacyDbPath)
    legacy.exec(`
      CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
      INSERT INTO novels (id, title, genre, synopsis, created_at, updated_at, status) VALUES ('old-novel', '旧小说', '玄幻', '', 1, 1, 'draft');
    `)
    legacy.close()

    // 用 novel-store 打开（会自动迁移）
    const db = getDb(projectDir)
    // 验证旧数据仍然可读
    const rows = db.all("SELECT * FROM novels WHERE id='old-novel'")
    expect(rows).toHaveLength(1)
    // 验证新表已创建
    const syncTable = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='manual_edit_sync_queue'")
    expect(syncTable).toHaveLength(1)
  })
})

