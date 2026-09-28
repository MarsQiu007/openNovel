import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq, sql } from "drizzle-orm"
import {
  ChapterSummaryTable,
  ChapterTable,
  CharacterTable,
  EntityRefTable,
  NovelTable,
  SegmentSummaryTable,
  StorySpineEntryTable,
  StyleGuideTable,
  closeDb,
  getDb,
} from "@opennovel-ai/novel-store"
import { parseRebuiltChapterDerivedData, rebuildChapterDerivedData } from "../../src/novel-writer/chapter-rebuild.js"

const NOVEL = "novel-rebuild"
const CHAPTER = "chapter-rebuild"
const FINGERPRINT = "fingerprint-rebuild"
const validOutput = JSON.stringify({
  summary: "陆沉在黑市获得残缺功法",
  key_events: ["黑市拍卖"],
  char_changes: ["陆沉决心变强"],
  spine: [
    { content: "陆沉获得残缺功法", kind: "chapter" },
    { content: "黑市暗流涌动", kind: "plot" },
  ],
})

let projectDir: string
let db: ReturnType<typeof getDb>

beforeEach(() => {
  projectDir = join(tmpdir(), `chapter-rebuild-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  db = getDb(projectDir)
  db.insert(NovelTable).values({ id: NOVEL, title: "重建测试", genre: "玄幻" }).run()
  db.insert(ChapterTable).values({
    id: CHAPTER,
    novel_id: NOVEL,
    title: "第二十一章",
    content: "陆沉走进黑市，拍下了残缺功法。",
    order: 21,
  }).run()
  db.insert(ChapterTable).values({
    id: "chapter-20",
    novel_id: NOVEL,
    title: "第二十章",
    content: "前一章。",
    order: 20,
  }).run()
  db.insert(StyleGuideTable).values({
    id: "style-rebuild",
    novel_id: NOVEL,
    rules: { chapter_length: "3000" },
    tone: "冷峻",
    pov: "第三人称",
    tense: "过去时",
  }).run()
  db.insert(CharacterTable).values({
    id: "char-lu",
    novel_id: NOVEL,
    name: "陆沉",
    role: "主角",
    description: "",
    status: "active",
  }).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 文件句柄可能短暂未释放
  }
})

function seedExistingDerivedData() {
  db.insert(ChapterSummaryTable).values({
    id: "summary-old",
    chapter_id: CHAPTER,
    summary: "旧摘要",
    key_events: [],
    char_changes: [],
    source_fingerprint: "old-fingerprint",
  }).run()
  db.insert(StorySpineEntryTable).values({
    id: "spine-old",
    novel_id: NOVEL,
    chapter_id: CHAPTER,
    chapter_order: 21,
    content: "旧主轴",
    kind: "chapter",
    source_fingerprint: "old-fingerprint",
    status: "pending",
  }).run()
  db.insert(StorySpineEntryTable).values({
    id: "spine-legacy",
    novel_id: NOVEL,
    content: "全局旧主轴",
    kind: "chapter",
    status: "legacy",
  }).run()
}

describe("parseRebuiltChapterDerivedData", () => {
  test("合法输出解析为结构化对象", () => {
    const parsed = parseRebuiltChapterDerivedData(validOutput)
    expect(parsed.summary).toBe("陆沉在黑市获得残缺功法")
    expect(parsed.key_events).toEqual(["黑市拍卖"])
    expect(parsed.spine).toHaveLength(2)
  })

  test("缺少字段时抛出可读错误", () => {
    expect(() => parseRebuiltChapterDerivedData(JSON.stringify({ summary: "摘要" }))).toThrow(
      "章节重建输出缺少或形状不符：key_events",
    )
  })

  test("非 JSON 输出抛出可读错误", () => {
    expect(() => parseRebuiltChapterDerivedData("不是 JSON")).toThrow("章节重建输出不是合法 JSON")
  })
})

describe("rebuildChapterDerivedData", () => {
  test("读取书籍上下文并幂等刷新摘要、主轴、引用、段摘要与 FTS", async () => {
    seedExistingDerivedData()
    let receivedPrompt = ""
    const llm = async (prompt: string) => {
      receivedPrompt = prompt
      return validOutput
    }

    await rebuildChapterDerivedData(db, NOVEL, CHAPTER, FINGERPRINT, llm)
    await rebuildChapterDerivedData(db, NOVEL, CHAPTER, FINGERPRINT, llm)

    expect(receivedPrompt).toContain("玄幻")
    expect(receivedPrompt).toContain("冷峻")
    expect(receivedPrompt).toContain("chapter_length")
    expect(receivedPrompt).toContain("陆沉走进黑市")

    const summaries = db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, CHAPTER)).all()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].source_fingerprint).toBe(FINGERPRINT)
    expect(summaries[0].summary).toBe("陆沉在黑市获得残缺功法")

    const spine = db
      .select()
      .from(StorySpineEntryTable)
      .where(eq(StorySpineEntryTable.chapter_id, CHAPTER))
      .all()
    expect(spine.map((entry) => entry.content)).toEqual(["陆沉获得残缺功法", "黑市暗流涌动"])
    expect(spine.every((entry) => entry.source_fingerprint === FINGERPRINT && entry.status === "synced")).toBe(true)
    expect(db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.id, "spine-legacy")).get()?.content).toBe("全局旧主轴")

    expect(db.select().from(EntityRefTable).where(eq(EntityRefTable.target_id, "char-lu")).all()).toHaveLength(1)
    expect(db.select().from(SegmentSummaryTable).where(eq(SegmentSummaryTable.novel_id, NOVEL)).all()).toHaveLength(1)
    const ftsRows = db.all(
      sql`SELECT body FROM chapter_summary_fts WHERE novel_id = ${NOVEL} AND chapter_id = ${CHAPTER}`,
    ) as Array<{ body: string }>
    expect(ftsRows).toHaveLength(1)
    expect(ftsRows[0].body).toContain("陆沉在黑市获得残缺功法 黑市拍卖")
  })

  test("输出解析失败时不删空既有主轴条目", async () => {
    seedExistingDerivedData()
    await expect(rebuildChapterDerivedData(db, NOVEL, CHAPTER, FINGERPRINT, async () => "{}")).rejects.toThrow(
      "章节重建输出缺少或形状不符：summary",
    )
    expect(db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.chapter_id, CHAPTER)).all()).toHaveLength(1)
  })

  test("落库中途失败时回滚既有摘要与主轴条目", async () => {
    seedExistingDerivedData()
    db.run(sql`DROP TABLE chapter_summary_fts`)

    await expect(rebuildChapterDerivedData(db, NOVEL, CHAPTER, FINGERPRINT, async () => validOutput)).rejects.toThrow(
      "chapter_summary_fts",
    )
    expect(db.select().from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, CHAPTER)).get()?.summary).toBe("旧摘要")
    expect(db.select().from(StorySpineEntryTable).where(eq(StorySpineEntryTable.chapter_id, CHAPTER)).all()).toHaveLength(1)
  })
})
