import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  NovelTable,
  ChapterTable,
  ManualEditSyncQueueTable,
  StorySpineEntryTable,
  scanHistoricalIntermediateStates,
} from "@opennovel-ai/novel-store"
import { getChapter, exportNovel, syncStatusEndpoint } from "../src/handlers/novel"
import { saveChapterContent } from "../src/manual-edit-transaction"

let projectDir: string
const novelId = "legacy-novel"
const chapterId = "legacy-chapter-1"
const legacyContent = "旧版正文：少年睁开眼，发现自己躺在陌生的山洞里。"
const legacySpine = "旧版故事主轴文本缓存"

/**
 * 构造上一版本的数据库 fixture：
 * 无 manual_edit_sync_queue / story_spine_entries 表，
 * 派生表（chapter_summaries / segment_summaries / entity_refs）无 source_fingerprint 列。
 */
function createLegacyDb(dir: string) {
  mkdirSync(join(dir, ".novel"), { recursive: true })
  const legacy = new Database(join(dir, ".novel", "novel.db"))
  legacy.exec(`
    CREATE TABLE novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, master_outline text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL, story_spine text);
    INSERT INTO novels (id, title, genre, synopsis, master_outline, created_at, updated_at, status, story_spine) VALUES ('${novelId}', '旧版小说', '玄幻', '旧版简介', '', 1, 1, 'draft', '${legacySpine}');
    CREATE TABLE chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, outline text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
    INSERT INTO chapters (id, novel_id, volume_id, title, content, word_count, status, outline, "order", created_at, updated_at) VALUES ('${chapterId}', '${novelId}', NULL, '第一章 山洞', '${legacyContent}', 20, 'published', '', 1, 1, 1);
    CREATE TABLE chapter_summaries (id text PRIMARY KEY, chapter_id text NOT NULL, summary text DEFAULT '' NOT NULL, key_events text DEFAULT '[]' NOT NULL, char_changes text DEFAULT '[]' NOT NULL);
    INSERT INTO chapter_summaries (id, chapter_id, summary, key_events, char_changes) VALUES ('legacy-sum-1', '${chapterId}', '旧版章节摘要', '[]', '[]');
    CREATE TABLE segment_summaries (id text PRIMARY KEY, novel_id text NOT NULL, start_chapter integer NOT NULL, end_chapter integer NOT NULL, summary text DEFAULT '' NOT NULL, created_at integer NOT NULL);
    INSERT INTO segment_summaries (id, novel_id, start_chapter, end_chapter, summary, created_at) VALUES ('legacy-seg-1', '${novelId}', 1, 1, '旧版段摘要', 1);
    CREATE TABLE entity_refs (id text PRIMARY KEY, novel_id text NOT NULL, source_type text NOT NULL, source_id text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, ref_field text NOT NULL, ref_text text DEFAULT '' NOT NULL, created_at integer NOT NULL);
    INSERT INTO entity_refs (id, novel_id, source_type, source_id, target_type, target_id, ref_field, ref_text, created_at) VALUES ('legacy-ref-1', '${novelId}', 'chapter', '${chapterId}', 'character', 'char-1', 'mention', '少年', 1);
  `)
  legacy.close()
}

beforeEach(() => {
  projectDir = join(tmpdir(), `manual-edit-legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  createLegacyDb(projectDir)
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 上偶发文件句柄延迟释放，清理失败不影响测试结果
  }
})

describe("旧数据库 fixture 集成验收", () => {
  test("打开旧库后自动迁移：新表与指纹列就位，旧数据保留", () => {
    const db = getDb(projectDir)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()
    expect(novel?.title).toBe("旧版小说")
    expect(novel?.story_spine).toBe(legacySpine)
    const tables = db
      .all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('manual_edit_sync_queue', 'story_spine_entries')")
      .map((row) => (row as { name: string }).name)
    expect(tables).toContain("manual_edit_sync_queue")
    expect(tables).toContain("story_spine_entries")
    const summaryCols = db.all("PRAGMA table_info(chapter_summaries)") as { name: string }[]
    expect(summaryCols.some((col) => col.name === "source_fingerprint")).toBe(true)
  })

  test("阅读：旧章节正文可正常读取", async () => {
    const chapter = await Effect.runPromise(getChapter(novelId, chapterId, projectDir))
    expect(chapter.content).toBe(legacyContent)
    expect(chapter.title).toBe("第一章 山洞")
  })

  test("导出：旧库可正常导出 markdown", async () => {
    const result = await Effect.runPromise(exportNovel(novelId, projectDir, "markdown"))
    expect(result.filename).toContain("旧版小说")
    expect(result.content).toContain(legacyContent)
  })

  test("基础编辑：旧章节保存成功并进入同步队列", async () => {
    const newContent = "新版正文：少年走出山洞，看见漫天星光。"
    const db = getDb(projectDir)
    const result = await Effect.runPromise(
      saveChapterContent({ novelId, directory: projectDir }, chapterId, newContent, () =>
        db.update(ChapterTable).set({ content: newContent, updated_at: Date.now() }).where(eq(ChapterTable.id, chapterId)).run(),
      ),
    )
    expect(result.syncQueued).toBe(true)
    const chapter = await Effect.runPromise(getChapter(novelId, chapterId, projectDir))
    expect(chapter.content).toBe(newContent)
    const queueRows = db.select().from(ManualEditSyncQueueTable).all()
    expect(queueRows.length).toBeGreaterThan(0)
  })

  test("同步状态共存：缺指纹历史数据标记待校验，状态查询不报错", async () => {
    const scan = await scanHistoricalIntermediateStates(novelId, projectDir)
    expect(scan.summaries).toBeGreaterThanOrEqual(1)
    expect(scan.segments).toBeGreaterThanOrEqual(1)
    expect(scan.refs).toBeGreaterThanOrEqual(1)
    const status = await Effect.runPromise(syncStatusEndpoint(novelId, projectDir))
    expect(Array.isArray(status.entries)).toBe(true)
    const spineRows = getDb(projectDir).select().from(StorySpineEntryTable).all()
    expect(spineRows).toHaveLength(0)
  })
})
