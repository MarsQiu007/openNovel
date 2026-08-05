import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  getDb,
  NovelTable,
  ChapterTable,
  CharacterTable,
  tagNovelSession,
  createChapterReview,
} from "@opennovel-ai/novel-store"
import {
  listNovels,
  createNovel,
  novelDetail,
  listChapters,
  getChapter,
  submitApproval,
  novelForSession,
  bindSession,
  listChapterVersions,
  updateChapterContent,
  rollbackChapter,
  listCharacters,
  getOutlineBundle,
  listChapterReviews,
} from "../src/handlers/novel"
import { NovelNotFoundError, NovelValidationError, ChapterNotFoundError } from "@opennovel-ai/protocol/groups/novel"

let tempDir: string
let novelId: string
let chapterId1: string
let chapterId2: string
let characterId: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "novel-server-test-"))
  const db = getDb(tempDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable)
    .values({
      id: novelId,
      title: "Test Novel",
      genre: "玄幻",
      synopsis: "A test novel",
      created_at: now,
      updated_at: now,
      status: "draft",
    })
    .run()
  chapterId1 = crypto.randomUUID()
  chapterId2 = crypto.randomUUID()
  db.insert(ChapterTable)
    .values([
      {
        id: chapterId1,
        novel_id: novelId,
        title: "Chapter 1",
        content: "Content of chapter 1",
        word_count: 20,
        status: "draft",
        order: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: chapterId2,
        novel_id: novelId,
        title: "Chapter 2",
        content: "Content of chapter 2",
        word_count: 20,
        status: "draft",
        order: 2,
        created_at: now,
        updated_at: now,
      },
    ])
    .run()
  characterId = crypto.randomUUID()
  db.insert(CharacterTable)
    .values({
      id: characterId,
      novel_id: novelId,
      name: "Hero",
      role: "protagonist",
      description: "The main character",
      created_at: now,
    })
    .run()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("novel handler - happy path", () => {
  test("create -> list -> detail -> chapters -> chapter -> approve -> final", async () => {
    const created = await Effect.runPromise(
      createNovel(tempDir, { title: "New Novel", genre: "都市", synopsis: "Urban story" }),
    )
    expect(created.title).toBe("New Novel")
    expect(created.genre).toBe("都市")
    expect(created.status).toBe("draft")

    const novels = await Effect.runPromise(listNovels(tempDir))
    expect(novels.length).toBe(2)
    expect(novels.some((n) => n.id === created.id)).toBe(true)

    const detail = await Effect.runPromise(novelDetail(novelId, tempDir))
    expect(detail.id).toBe(novelId)
    expect(detail.title).toBe("Test Novel")
    expect(detail.stats.chapterCount).toBe(2)
    expect(detail.stats.characterCount).toBe(1)
    expect(detail.stats.wordCount).toBe(40)
    expect(detail.styleGuide).toBeDefined()

    const chapters = await Effect.runPromise(listChapters(novelId, tempDir))
    expect(chapters.length).toBe(2)
    expect(chapters[0]!.order).toBe(1)
    expect(chapters[1]!.order).toBe(2)
    const chapterDto = chapters[0]!
    expect("content" in chapterDto).toBe(false)

    const chapterDetail = await Effect.runPromise(getChapter(novelId, chapterId1, tempDir))
    expect(chapterDetail.id).toBe(chapterId1)
    expect(chapterDetail.content).toBe("Content of chapter 1")

    const approved = await Effect.runPromise(submitApproval(novelId, chapterId1, { action: "approve" }, tempDir))
    expect(approved.status).toBe("final")
  })

  test("reject changes status to rejected", async () => {
    const rejected = await Effect.runPromise(submitApproval(novelId, chapterId2, { action: "reject" }, tempDir))
    expect(rejected.status).toBe("rejected")
  })
})

describe("novel handler - for-session", () => {
  test("tagNovelSession then for-session resolves the novel", async () => {
    const sessionID = crypto.randomUUID()
    await tagNovelSession(sessionID, novelId, tempDir)

    const novel = await Effect.runPromise(novelForSession(sessionID, tempDir))
    expect(novel.id).toBe(novelId)
  })

  test("bind endpoint tags session and returns novel", async () => {
    const sessionID = crypto.randomUUID()
    const novel = await Effect.runPromise(bindSession(novelId, { sessionID }, tempDir))
    expect(novel.id).toBe(novelId)

    const resolved = await Effect.runPromise(novelForSession(sessionID, tempDir))
    expect(resolved.id).toBe(novelId)
  })

  test("unbound session fails with NovelNotFoundError", async () => {
    await expect(Effect.runPromise(novelForSession("nonexistent-session", tempDir))).rejects.toBeInstanceOf(
      NovelNotFoundError,
    )
  })
})

describe("novel handler - 404 errors", () => {
  test("detail with unknown novelID throws NovelNotFoundError", async () => {
    await expect(Effect.runPromise(novelDetail("nonexistent-novel", tempDir))).rejects.toBeInstanceOf(
      NovelNotFoundError,
    )
  })

  test("listChapters with unknown novelID throws NovelNotFoundError", async () => {
    await expect(Effect.runPromise(listChapters("nonexistent-novel", tempDir))).rejects.toBeInstanceOf(
      NovelNotFoundError,
    )
  })

  test("getChapter with unknown chapterID throws ChapterNotFoundError", async () => {
    await expect(Effect.runPromise(getChapter(novelId, "nonexistent-chapter", tempDir))).rejects.toBeInstanceOf(
      ChapterNotFoundError,
    )
  })

  test("getChapter with mismatched novelID throws ChapterNotFoundError", async () => {
    await expect(Effect.runPromise(getChapter("wrong-novel", chapterId1, tempDir))).rejects.toBeInstanceOf(
      ChapterNotFoundError,
    )
  })
})

describe("novel handler - 400 validation", () => {
  test("create with invalid genre throws NovelValidationError", async () => {
    const input = { title: "Bad", genre: "武侠" as "玄幻", synopsis: "S" }
    await expect(Effect.runPromise(createNovel(tempDir, input))).rejects.toBeInstanceOf(NovelValidationError)
  })
})

describe("novel handler - chapter versions", () => {
  test("update-content archives and updates", async () => {
    const updated = await Effect.runPromise(
      updateChapterContent(novelId, chapterId1, { content: "New content here" }, tempDir),
    )
    expect(updated.wordCount).toBe("New content here".length)

    const versions = await Effect.runPromise(listChapterVersions(novelId, chapterId1, tempDir))
    expect(versions.length).toBe(1)
    expect(versions[0]!.content).toBe("Content of chapter 1")
    expect(versions[0]!.version).toBe(1)
  })

  test("rollback restores previous content", async () => {
    await Effect.runPromise(updateChapterContent(novelId, chapterId1, { content: "Version 2" }, tempDir))

    const rolled = await Effect.runPromise(rollbackChapter(novelId, chapterId1, tempDir))
    expect(rolled.wordCount).toBe(20)

    const detail = await Effect.runPromise(getChapter(novelId, chapterId1, tempDir))
    expect(detail.content).toBe("Content of chapter 1")
  })

  test("rollback with no version history throws ChapterNotFoundError", async () => {
    await expect(Effect.runPromise(rollbackChapter(novelId, chapterId1, tempDir))).rejects.toBeInstanceOf(
      ChapterNotFoundError,
    )
  })
})

describe("novel handler - chapter reviews", () => {
  test("lists persisted reviews newest first with parsed dimensions", async () => {
    await createChapterReview(
      chapterId1,
      {
        source: "deterministic",
        overall: "FAIL",
        dimensions: [
          { dimension: "姓名一致性", status: "PASS", detail: "一致" },
          { dimension: "因果链", status: "FAIL", detail: "动机缺失", evidence: "第3段" },
        ],
        summary: "37维确定性检查：FAIL",
        sessionId: "sess-1",
      },
      tempDir,
    )
    await createChapterReview(
      chapterId1,
      {
        source: "auditor",
        overall: "WARN",
        dimensions: [{ dimension: "性格一致", status: "WARN", detail: "轻微波动" }],
        summary: "auditor 深审",
      },
      tempDir,
    )

    const reviews = await Effect.runPromise(listChapterReviews(novelId, chapterId1, tempDir))
    expect(reviews.length).toBe(2)
    expect(reviews[0]!.source).toBe("auditor")
    expect(reviews[0]!.round).toBe(1)
    expect(reviews[1]!.source).toBe("deterministic")
    expect(reviews[1]!.passCount).toBe(1)
    expect(reviews[1]!.failCount).toBe(1)
    expect(reviews[1]!.dimensions).toHaveLength(2)
    expect(reviews[1]!.dimensions[1]!.evidence).toBe("第3段")
    expect(reviews[1]!.sessionId).toBe("sess-1")
  })

  test("content change between reviews opens a new round", async () => {
    await createChapterReview(
      chapterId1,
      {
        source: "deterministic",
        overall: "FAIL",
        dimensions: [],
      },
      tempDir,
    )
    await Effect.runPromise(updateChapterContent(novelId, chapterId1, { content: "Revised content" }, tempDir))
    await createChapterReview(
      chapterId1,
      {
        source: "deterministic",
        overall: "PASS",
        dimensions: [],
      },
      tempDir,
    )

    const reviews = await Effect.runPromise(listChapterReviews(novelId, chapterId1, tempDir))
    expect(reviews.length).toBe(2)
    expect(reviews[0]!.round).toBe(2)
    expect(reviews[1]!.round).toBe(1)
  })

  test("unknown chapter throws ChapterNotFoundError", async () => {
    await expect(Effect.runPromise(listChapterReviews(novelId, "no-such-chapter", tempDir))).rejects.toBeInstanceOf(
      ChapterNotFoundError,
    )
  })

  test("approval with comment persists a human review annotation", async () => {
    await Effect.runPromise(submitApproval(novelId, chapterId1, { action: "reject", comment: "战斗节奏太拖" }, tempDir))
    const reviews = await Effect.runPromise(listChapterReviews(novelId, chapterId1, tempDir))
    expect(reviews.length).toBe(1)
    expect(reviews[0]!.source).toBe("human")
    expect(reviews[0]!.overall).toBe("FAIL")
    expect(reviews[0]!.summary).toBe("战斗节奏太拖")
  })

  test("approval without comment persists an empty-summary human row", async () => {
    await Effect.runPromise(submitApproval(novelId, chapterId1, { action: "approve" }, tempDir))
    const reviews = await Effect.runPromise(listChapterReviews(novelId, chapterId1, tempDir))
    expect(reviews.length).toBe(1)
    expect(reviews[0]!.source).toBe("human")
    expect(reviews[0]!.overall).toBe("PASS")
    expect(reviews[0]!.summary).toBe("")
  })
})

describe("novel handler - characters", () => {
  test("list characters", async () => {
    const chars = await Effect.runPromise(listCharacters(novelId, tempDir))
    expect(chars.length).toBe(1)
    expect(chars[0]!.name).toBe("Hero")
    expect(chars[0]!.role).toBe("protagonist")
  })
})

describe("novel handler - outline", () => {
  test("outline returns empty bundle when dir missing", async () => {
    const bundle = await Effect.runPromise(getOutlineBundle(novelId, tempDir))
    expect(bundle.master).toBe("")
    expect(bundle.volumes.length).toBe(0)
    expect(bundle.chapters.length).toBe(0)
  })

  test("outline reads markdown files", async () => {
    const outlinesDir = join(tempDir, ".novel", "outlines")
    mkdirSync(outlinesDir, { recursive: true })
    writeFileSync(join(outlinesDir, "master.md"), "# Master Outline")
    writeFileSync(join(outlinesDir, "volume-1.md"), "# Volume 1")
    writeFileSync(join(outlinesDir, "chapter-1.md"), "# Chapter 1")

    const bundle = await Effect.runPromise(getOutlineBundle(novelId, tempDir))
    expect(bundle.master).toBe("# Master Outline")
    expect(bundle.volumes.length).toBe(1)
    expect(bundle.volumes[0]!.volumeId).toBe("1")
    expect(bundle.volumes[0]!.markdown).toBe("# Volume 1")
    expect(bundle.chapters.length).toBe(1)
    expect(bundle.chapters[0]!.chapterId).toBe("1")
  })
})
