/**
 * 原文驱动导入（source-driven-import）数据层测试。
 *
 * 覆盖：段落索引（CRLF/空行/Unicode）、结构化草稿校验（覆盖/重复/窗口/
 * 锚点/替换/关闭修复）、单章幂等事务（重放/冲突/回滚/carry/序号）、
 * 进度与报告查询、旧库迁移兼容与级联删除。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { eq, asc } from "drizzle-orm"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  getDb,
  closeDb,
  NovelTable,
  ChapterTable,
  withTransaction,
  createImportJobTx,
  indexSourceParagraphs,
  validateChapterDraft,
  buildChapterContent,
  readSourceChunk,
  commitImportChapterTx,
  getImportJobByNovel,
  getImportProgress,
  getImportReport,
  calibrationChapterCharMedian,
  type ChapterDraft,
} from "../src/index.js"

let projectDir: string

function createNovel(id = "novel-1") {
  getDb(projectDir)
    .insert(NovelTable)
    .values({ id, title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
}

const RAW = [
  "第一章 风起",
  "夜色深沉，群山如黛。",
  "「你来了。」",
  "「我来了。」他说。",
  "",
  "第二章 云涌",
  "晨光微亮。",
  "请记住本书最新网址 www.example.com",
  "晨光微亮。",
].join("\n")

function createJob(raw = RAW) {
  return withTransaction(getDb(projectDir), (tx) =>
    createImportJobTx(tx, {
      novelId: "novel-1",
      filename: "book.txt",
      encoding: "utf-8",
      sourceHash: "hash-1",
      rawText: raw,
      options: { targetChapterChars: 3000, repair: "standard" },
    }),
  )
}

beforeEach(() => {
  projectDir = join(tmpdir(), `import-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  createNovel()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

describe("indexSourceParagraphs", () => {
  test("每个非空行一个段落，空行不产生索引", () => {
    const ps = indexSourceParagraphs("a\n\nb\n\n\nc")
    expect(ps.map((p) => p.index)).toEqual([0, 1, 2])
    expect(ps[0]).toMatchObject({ startOffset: 0, endOffset: 1 })
    expect(ps[1]).toMatchObject({ startOffset: 3, endOffset: 4 })
    expect(ps[2]).toMatchObject({ startOffset: 7, endOffset: 8 })
  })

  test("CRLF 行尾与 Unicode 文本", () => {
    const text = "第一行\r\n第二行😀"
    const ps = indexSourceParagraphs(text)
    expect(ps).toHaveLength(2)
    expect(text.slice(ps[0].startOffset, ps[0].endOffset)).toBe("第一行")
    expect(text.slice(ps[1].startOffset, ps[1].endOffset)).toBe("第二行😀")
  })
})

describe("任务创建与迁移兼容", () => {
  test("创建任务与段落索引，既有书籍行不变", () => {
    const jobId = createJob()
    const job = getImportJobByNovel("novel-1", projectDir)!
    expect(job.id).toBe(jobId)
    expect(job.total_chars).toBe(RAW.length)
    expect(job.status).toBe("awaiting_queue")
    expect(getDb(projectDir).select().from(NovelTable).all()[0]).toMatchObject({ id: "novel-1", title: "测试书" })
  })

  test("删除书籍级联清理任务、段落、章节与账本", () => {
    createJob()
    const draft: ChapterDraft = { title: "第一章 风起", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 4, ops: [
      { kind: "keep", source: 0 },
      { kind: "keep", source: 1 },
      { kind: "merge", source: [2, 3], separator: "", reason: "对话合并" },
    ] }
    withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft, repairEnabled: true }))
    getDb(projectDir).delete(NovelTable).where(eq(NovelTable.id, "novel-1")).run()
    expect(getImportJobByNovel("novel-1", projectDir)).toBeUndefined()
  })
})

describe("validateChapterDraft / buildChapterContent", () => {
  const textOf = (raw: string) => (i: number) => raw.split("\n").filter((l) => l.trim().length > 0)[i]

  test("连续对话合并构造正文", () => {
    const lines = RAW.split("\n").filter((l) => l.trim().length > 0)
    const draft: ChapterDraft = { title: "第一章", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 4, ops: [
      { kind: "keep", source: 0 },
      { kind: "keep", source: 1 },
      { kind: "merge", source: [2, 3], separator: "\n", reason: "对话合并" },
    ] }
    expect(validateChapterDraft(draft, [0, 1, 2, 3], textOf(RAW), true).ok).toBe(true)
    expect(buildChapterContent(draft, textOf(RAW))).toBe("第一章 风起\n\n夜色深沉，群山如黛。\n\n「你来了。」\n「我来了。」他说。")
  })

  test("乱序由操作顺序表达并构造重排正文", () => {
    const lines = RAW.split("\n").filter((l) => l.trim().length > 0)
    const draft: ChapterDraft = { title: "第一章", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 2, ops: [
      { kind: "keep", source: 1 },
      { kind: "keep", source: 0 },
    ] }
    expect(buildChapterContent(draft, textOf(RAW))).toBe(lines[1] + "\n\n" + lines[0])
  })

  test("重复分配被拒绝", () => {
    const draft: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 2, ops: [
      { kind: "keep", source: 0 },
      { kind: "keep", source: 0 },
    ] }
    const v = validateChapterDraft(draft, [0, 1], textOf(RAW), true)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe("source-reused")
  })

  test("窗口遗漏被拒绝", () => {
    const draft: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 2, ops: [
      { kind: "keep", source: 0 },
    ] }
    const v = validateChapterDraft(draft, [0, 1], textOf(RAW), true)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe("source-uncovered")
  })

  test("跨窗口引用被拒绝", () => {
    const draft: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 2, ops: [
      { kind: "keep", source: 0 },
      { kind: "keep", source: 9 },
    ] }
    const v = validateChapterDraft(draft, [0, 1], textOf(RAW), true)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe("source-out-of-window")
  })

  test("无效 split 锚点与无效 replace 原文被拒绝", () => {
    const textOfLocal = () => "甲乙丙丁"
    const badSplit: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 1, ops: [{ kind: "split", source: 0, anchors: ["不存在"] }] }
    expect(validateChapterDraft(badSplit, [0], textOfLocal, true)).toMatchObject({ ok: false, code: "split-anchor-invalid" })
    const badReplace: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 1, ops: [{ kind: "replace", source: 0, original: "不存在", replacement: "x", category: "typo", reason: "r" }] }
    expect(validateChapterDraft(badReplace, [0], textOfLocal, true)).toMatchObject({ ok: false, code: "replace-original-invalid" })
  })

  test("关闭正文修复时仅允许 keep", () => {
    const textOfLocal = textOf(RAW)
    const draft: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 2, ops: [
      { kind: "merge", source: [0, 1], separator: "", reason: "r" },
    ] }
    expect(validateChapterDraft(draft, [0, 1], textOfLocal, false)).toMatchObject({ ok: false, code: "repair-disabled" })
  })

  test("空章（全部排除）被拒绝", () => {
    const draft: ChapterDraft = { title: "t", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 2, ops: [
      { kind: "exclude", source: 0, category: "noise", reason: "广告" },
      { kind: "exclude", source: 1, category: "noise", reason: "广告" },
    ] }
    expect(validateChapterDraft(draft, [0, 1], textOf(RAW), true)).toMatchObject({ ok: false, code: "empty-chapter" })
  })
})

describe("commitImportChapterTx", () => {
  const chapter1 = (): ChapterDraft => ({ title: "第一章 风起", volumeTitle: null, chapterOrder: 1, carry: [], windowSize: 4, ops: [
    { kind: "keep", source: 0 },
    { kind: "keep", source: 1 },
    { kind: "merge", source: [2, 3], separator: "\n", reason: "对话合并" },
  ] })

  test("提交推进游标并落账本", () => {
    createJob()
    const result = withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: chapter1(), repairEnabled: true }))
    expect(result.idempotentReplay).toBe(false)
    const chapter = getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.novel_id, "novel-1")).all()[0]
    expect(chapter.order).toBe(1)
    expect(chapter.content).toContain("「你来了。」\n「我来了。」他说。")
    const job = getImportJobByNovel("novel-1", projectDir)!
    expect(job.next_paragraph_index).toBe(4)
    expect(job.processed_chars).toBeGreaterThan(0)
    const progress = getImportProgress(job.id, projectDir)
    expect(progress.chapterCount).toBe(1)
  })

  test("相同提交重放幂等，不同提交冲突拒绝", () => {
    createJob()
    const first = withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: chapter1(), repairEnabled: true }))
    const replay = withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: chapter1(), repairEnabled: true }))
    expect(replay.idempotentReplay).toBe(true)
    expect(replay.chapterId).toBe(first.chapterId)
    expect(getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.novel_id, "novel-1")).all()).toHaveLength(1)
    const conflict: ChapterDraft = { ...chapter1(), ops: [{ kind: "keep", source: 0 }] }
    expect(() => withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: conflict, repairEnabled: true }))).toThrow("冲突")
  })

  test("carry 段落留给下一章且不计入已处置", () => {
    createJob()
    const withCarry: ChapterDraft = { title: "第一章", volumeTitle: null, chapterOrder: 1, carry: [3], windowSize: 4, ops: [
      { kind: "keep", source: 0 },
      { kind: "keep", source: 1 },
      { kind: "keep", source: 2 },
    ] }
    withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: withCarry, repairEnabled: true }))
    const job = getImportJobByNovel("novel-1", projectDir)!
    expect(job.next_paragraph_index).toBe(4)
    expect(JSON.parse(job.carry_json)).toEqual([3])
    const lines = RAW.split("\n").filter((l) => l.trim().length > 0)
    const expected = lines[0].length + lines[1].length + lines[2].length
    expect(job.processed_chars).toBe(expected)
  })

  test("校验失败回滚当前章且保留前序成果", () => {
    createJob()
    withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: chapter1(), repairEnabled: true }))
    const bad: ChapterDraft = { title: "第二章", volumeTitle: null, chapterOrder: 2, carry: [], windowSize: 99, ops: [{ kind: "keep", source: 0 }] }
    expect(() => withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: bad, repairEnabled: true }))).toThrow()
    const chapters = getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.novel_id, "novel-1")).all()
    expect(chapters).toHaveLength(1)
    expect(chapters[0].order).toBe(1)
  })

  test("序号连续且卷归属正确", () => {
    createJob()
    const d1: ChapterDraft = { title: "第一章", volumeTitle: "第一卷", chapterOrder: 1, carry: [], windowSize: 2, ops: [{ kind: "keep", source: 0 }, { kind: "keep", source: 1 }] }
    const d2: ChapterDraft = { title: "第二章", volumeTitle: "第一卷", chapterOrder: 2, carry: [], windowSize: 3, ops: [{ kind: "keep", source: 2 }, { kind: "exclude", source: 3, category: "noise", reason: "广告" }, { kind: "keep", source: 4 }] }
    withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: d1, repairEnabled: true }))
    withTransaction(getDb(projectDir), (tx) => commitImportChapterTx(tx, { novelId: "novel-1", draft: d2, repairEnabled: true }))
    const chapters = getDb(projectDir).select().from(ChapterTable).where(eq(ChapterTable.novel_id, "novel-1")).orderBy(asc(ChapterTable.order)).all()
    expect(chapters.map((c) => c.order)).toEqual([1, 2])
    expect(chapters[0].volume_id).not.toBeNull()
    const report = getImportReport(getImportJobByNovel("novel-1", projectDir)!.id, projectDir)
    expect(report.opCounts["exclude"]).toBe(1)
    expect(report.excluded).toHaveLength(1)
    expect(report.excluded[0].reason).toBe("广告")
    expect(calibrationChapterCharMedian(getImportJobByNovel("novel-1", projectDir)!.id, projectDir)).not.toBeNull()
  })
})
