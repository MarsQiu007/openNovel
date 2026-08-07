import { Location } from "@opennovel-ai/core/location"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { NovelNotFoundError, ChapterNotFoundError, NovelValidationError } from "@opennovel-ai/protocol/groups/novel"
import {
  getDb,
  getDbPath,
  tagNovelSession,
  getNovelForSession,
  handleApproval,
  NovelTable,
  VolumeTable,
  ChapterTable,
  ChapterVersionTable,
  ChapterReviewTable,
  CharacterTable,
  CharacterStateTable,
  RelationshipTable,
  PlotThreadTable,
  ForeshadowingTable,
  WorldEntryTable,
  StyleGuideTable,
  TensionLogTable,
  createChapter as storeCreateChapter,
  updateNovel as storeUpdateNovel,
  deleteNovel as storeDeleteNovel,
  createCharacter as storeCreateCharacter,
  updateCharacter as storeUpdateCharacter,
  deleteCharacter as storeDeleteCharacter,
  createTensionPoint as storeCreateTensionPoint,
  updateTensionPoint as storeUpdateTensionPoint,
  deleteTensionPoint as storeDeleteTensionPoint,
  createPlotThread as storeCreatePlotThread,
  updatePlotThread as storeUpdatePlotThread,
  deletePlotThread as storeDeletePlotThread,
  createForeshadowing as storeCreateForeshadowing,
  updateForeshadowing as storeUpdateForeshadowing,
  deleteForeshadowing as storeDeleteForeshadowing,
  createWorldEntry as storeCreateWorldEntry,
  updateWorldEntry as storeUpdateWorldEntry,
  deleteWorldEntry as storeDeleteWorldEntry,
  deleteChapter as storeDeleteChapter,
  createVolume as storeCreateVolume,
  updateVolume as storeUpdateVolume,
  deleteVolume as storeDeleteVolume,
  updateChapter as storeUpdateChapter,
  moveChapter as storeMoveChapter,
  createRelationship as storeCreateRelationship,
  updateRelationship as storeUpdateRelationship,
  deleteRelationship as storeDeleteRelationship,
  createCharacterState as storeCreateCharacterState,
  updateCharacterState as storeUpdateCharacterState,
  deleteCharacterState as storeDeleteCharacterState,
  upsertStyleGuide as storeUpsertStyleGuide,
  listChapterReviews as storeListChapterReviews,
  createChapterReview as storeCreateChapterReview,
} from "@opennovel-ai/novel-store"
import { eq, asc, desc, like, or, inArray } from "drizzle-orm"
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"

const VALID_GENRES = new Set(["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"])

type Genre = "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"

// ─── DB-to-DTO mappers ───

type NovelRow = typeof NovelTable.$inferSelect
type VolumeRow = typeof VolumeTable.$inferSelect
type ChapterRow = typeof ChapterTable.$inferSelect
type ChapterVersionRow = typeof ChapterVersionTable.$inferSelect
type ChapterReviewRow = typeof ChapterReviewTable.$inferSelect
type CharacterRow = typeof CharacterTable.$inferSelect
type PlotThreadRow = typeof PlotThreadTable.$inferSelect
type ForeshadowingRow = typeof ForeshadowingTable.$inferSelect
type WorldEntryRow = typeof WorldEntryTable.$inferSelect
type StyleGuideRow = typeof StyleGuideTable.$inferSelect
type TensionRow = typeof TensionLogTable.$inferSelect
type RelationshipRow = typeof RelationshipTable.$inferSelect
type CharacterStateRow = typeof CharacterStateTable.$inferSelect

function toNovel(row: NovelRow) {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre as Genre,
    synopsis: row.synopsis,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toVolume(row: VolumeRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    summary: row.summary,
    order: row.order,
    createdAt: row.created_at,
  }
}

function toChapter(row: ChapterRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    volumeId: row.volume_id ?? undefined,
    title: row.title,
    order: row.order,
    status: row.status,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toChapterDetail(row: ChapterRow) {
  return {
    ...toChapter(row),
    content: row.content,
  }
}

function toChapterVersion(row: ChapterVersionRow) {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    version: row.version,
    content: row.content,
    wordCount: row.word_count,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

function toChapterReview(row: ChapterReviewRow) {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    round: row.round,
    source: row.source as "deterministic" | "auditor" | "human",
    overall: row.overall as "PASS" | "WARN" | "FAIL",
    passCount: row.pass_count,
    warnCount: row.warn_count,
    failCount: row.fail_count,
    dimensions: JSON.parse(row.dimensions) as {
      dimension: string
      status: "PASS" | "WARN" | "FAIL"
      detail: string
      evidence?: string
    }[],
    summary: row.summary,
    sessionId: row.session_id ?? undefined,
    createdAt: row.created_at,
  }
}

function toCharacter(row: CharacterRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    name: row.name,
    role: row.role,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
  }
}

function toPlotThread(row: PlotThreadRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    description: row.description,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? undefined,
  }
}

function toForeshadowing(row: ForeshadowingRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    plantedChapterId: row.planted_chapter_id ?? undefined,
    resolvedChapterId: row.resolved_chapter_id ?? undefined,
    content: row.content,
    state: row.state,
    createdAt: row.created_at,
  }
}

function toWorldEntry(row: WorldEntryRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    category: row.category,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
  }
}

function toStyleGuide(row: StyleGuideRow) {
  const rules = typeof row.rules === "string" ? safeParseRecord(row.rules) : normalizeRules(row.rules)
  return {
    id: row.id,
    novelId: row.novel_id,
    rules,
    tone: row.tone,
    pov: row.pov,
    tense: row.tense,
  }
}

function toRelationship(row: RelationshipRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    charAId: row.char_a_id,
    charBId: row.char_b_id,
    type: row.type,
    description: row.description,
  }
}

function toCharacterState(row: CharacterStateRow) {
  return {
    id: row.id,
    characterId: row.character_id,
    chapterId: row.chapter_id ?? undefined,
    active: row.active,
    location: row.location || undefined,
    mood: row.mood || undefined,
    summary: row.summary || undefined,
  }
}

function toTensionPoint(row: TensionRow) {
  return {
    id: row.id,
    novelId: row.novel_id,
    chapterNumber: row.chapter_number,
    level: row.level,
    createdAt: row.created_at,
  }
}

// 旧版流水线曾把 rules 存成 "角色：规则" 字符串数组，归一化为按角色名键控的 Record
function normalizeRules(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const record: Record<string, string> = {}
    for (const entry of value) {
      if (typeof entry !== "string") continue
      const idx = entry.search(/[:：]/)
      if (idx > 0) record[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim()
      else record[entry] = ""
    }
    return record
  }
  if (value && typeof value === "object") {
    // 流水线写入的 rules 可能含数字/布尔值（如 chapter_length: 2500），统一转成字符串
    const record: Record<string, string> = {}
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string") record[key] = v
      else if (typeof v === "number" || typeof v === "boolean") record[key] = String(v)
    }
    return record
  }
  return {}
}

function safeParseRecord(raw: string): Record<string, string> {
  try {
    return normalizeRules(JSON.parse(raw))
  } catch {
    return {}
  }
}

// ─── Error helpers ───

function novelNotFound(novelId: string): NovelNotFoundError {
  return new NovelNotFoundError({
    name: "NovelNotFoundError",
    data: { message: `Novel not found: ${novelId}`, novelId },
  })
}

function chapterNotFound(chapterId: string, novelId?: string): ChapterNotFoundError {
  return new ChapterNotFoundError({
    name: "ChapterNotFoundError",
    data: { message: `Chapter not found: ${chapterId}`, novelId, chapterId },
  })
}

function invalidGenre(genre: string): NovelValidationError {
  return new NovelValidationError({
    name: "NovelValidationError",
    data: {
      message: `Invalid genre: ${genre}. Must be one of: ${[...VALID_GENRES].join(", ")}`,
      field: "genre",
    },
  })
}

// ─── Per-endpoint Effect logic (directory-scoped, testable) ───

type CreateNovelInput = { title: string; genre: string; synopsis: string }
type UpdateChapterContentInput = { content: string }
type ApprovalInput = { action: "approve" | "reject"; comment?: string }
type BindSessionInput = { sessionID: string }
type CreateChapterInput = { title: string; volumeId?: string; order?: number }
type UpdateNovelInput = { title?: string; synopsis?: string; genre?: string }
type CreateCharacterInput = { name: string; role?: string; description?: string }
type UpdateCharacterInput = { name?: string; role?: string; description?: string; status?: string }
type CreateTensionPointInput = { chapterNumber: number; level: number }
type UpdateTensionPointInput = { level?: number }
type CreatePlotThreadInput = { title: string; priority?: string; description?: string }
type UpdatePlotThreadInput = { title?: string; status?: string; priority?: string; description?: string }
type CreateForeshadowingInput = { content: string; plantedChapterId?: string }
type UpdateForeshadowingInput = { content?: string; state?: string; resolvedChapterId?: string }
type CreateWorldEntryInput = { category: string; title: string; content?: string }
type UpdateWorldEntryInput = { category?: string; title?: string; content?: string }
type CreateVolumeInput = { title: string; summary?: string }
type UpdateVolumeInput = { title?: string; summary?: string }
type RestoreVersionInput = { version: number }
type MoveChapterInput = { action: "up" | "down" | "to-volume"; volumeId?: string }
type UpdateChapterInput = { title?: string; status?: string }
type CreateRelationshipInput = { charAId: string; charBId: string; type: string; description?: string }
type UpdateRelationshipInput = { type?: string; description?: string }
type CreateCharacterStateInput = { chapterId?: string; place?: string; mood?: string; summary?: string }
type UpdateCharacterStateInput = { active?: number; place?: string; mood?: string; summary?: string }
type UpdateStyleGuideInput = { tone?: string; pov?: string; tense?: string; rules?: Record<string, string> }

export function listNovels(directory: string) {
  return Effect.sync(() => {
    const db = getDb(directory)
    return db.select().from(NovelTable).all().map(toNovel)
  })
}

export function createNovel(directory: string, input: CreateNovelInput) {
  return Effect.gen(function* () {
    if (!VALID_GENRES.has(input.genre)) {
      yield* Effect.fail(invalidGenre(input.genre))
    }
    const db = getDb(directory)
    const id = crypto.randomUUID()
    const now = Date.now()
    yield* Effect.sync(() => {
      db.insert(NovelTable)
        .values({
          id,
          title: input.title,
          genre: input.genre,
          synopsis: input.synopsis,
          created_at: now,
          updated_at: now,
          status: "draft",
        })
        .run()
    })
    return {
      id,
      title: input.title,
      genre: input.genre as Genre,
      synopsis: input.synopsis,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    }
  })
}

export function novelForSession(sessionID: string, directory: string) {
  return Effect.gen(function* () {
    const novelId = yield* Effect.promise(() => getNovelForSession(sessionID, directory))
    if (!novelId) {
      yield* Effect.fail(
        new NovelNotFoundError({
          name: "NovelNotFoundError",
          data: { message: `No novel bound to session: ${sessionID}` },
        }),
      )
    }
    const db = getDb(directory)
    const row = db.select().from(NovelTable).where(eq(NovelTable.id, novelId!)).get()
    if (!row) yield* Effect.fail(novelNotFound(novelId!))
    return toNovel(row!)
  })
}

export function novelDetail(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const styleRow = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelID)).get()
    const chapters = db.select().from(ChapterTable).where(eq(ChapterTable.novel_id, novelID)).all()
    const volumes = db.select().from(VolumeTable).where(eq(VolumeTable.novel_id, novelID)).all()
    const characters = db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelID)).all()
    const wordCount = chapters.reduce((sum, c) => sum + c.word_count, 0)
    const styleGuide = styleRow
      ? toStyleGuide(styleRow)
      : { id: "", novelId: novelID, rules: {}, tone: "", pov: "", tense: "" }
    return {
      ...toNovel(novel!),
      styleGuide,
      stats: {
        chapterCount: chapters.length,
        volumeCount: volumes.length,
        characterCount: characters.length,
        wordCount,
      },
    }
  })
}

export function listVolumes(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db
      .select()
      .from(VolumeTable)
      .where(eq(VolumeTable.novel_id, novelID))
      .orderBy(asc(VolumeTable.order))
      .all()
      .map(toVolume)
  })
}

export function listChapters(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novelID))
      .orderBy(asc(ChapterTable.order))
      .all()
      .map(toChapter)
  })
}

export function exportNovel(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const volumes = db
      .select()
      .from(VolumeTable)
      .where(eq(VolumeTable.novel_id, novelID))
      .orderBy(asc(VolumeTable.order))
      .all()
    const chapters = db
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novelID))
      .orderBy(asc(ChapterTable.order))
      .all()
    const withContent = chapters.filter((c) => c.content.trim().length > 0)
    const orphan = withContent.filter((c) => !c.volume_id || !volumes.some((v) => v.id === c.volume_id))
    const chapterMd = (c: (typeof chapters)[number]) => `### ${c.title}\n\n${c.content.trim()}`
    const sections = [
      `# ${novel!.title}`,
      novel!.synopsis.trim() ? novel!.synopsis.trim() : "",
      ...volumes.map((v) => {
        const own = withContent.filter((c) => c.volume_id === v.id)
        return [`## ${v.title}`, ...own.map(chapterMd)].join("\n\n")
      }),
      ...(orphan.length > 0 ? orphan.map(chapterMd) : []),
    ]
    const content = sections.filter((s) => s.length > 0).join("\n\n") + "\n"
    return { filename: `${novel!.title}.md`, content }
  })
}

export function getChapter(novelID: string, chapterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const row = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!row || row.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    return toChapterDetail(row!)
  })
}

export function listChapterVersions(novelID: string, chapterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const row = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!row || row.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    return db
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, chapterID))
      .orderBy(desc(ChapterVersionTable.version))
      .all()
      .map(toChapterVersion)
  })
}

export function listChapterReviews(novelID: string, chapterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const row = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!row || row.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const reviews = yield* Effect.promise(() => storeListChapterReviews(chapterID, directory))
    return reviews.map(toChapterReview)
  })
}

export function rollbackChapter(novelID: string, chapterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const versions = db
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, chapterID))
      .orderBy(desc(ChapterVersionTable.version))
      .all()
    if (versions.length === 0) {
      yield* Effect.fail(
        new ChapterNotFoundError({
          name: "ChapterNotFoundError",
          data: {
            message: `No version history for chapter: ${chapterID}`,
            chapterId: chapterID,
            novelId: novelID,
          },
        }),
      )
    }
    const current = chapter!
    const latest = versions[0]!
    yield* Effect.sync(() => {
      db.insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: chapterID,
          version: latest.version + 1,
          content: current.content,
          word_count: current.word_count,
          created_at: Date.now(),
          created_by: "rollback",
        })
        .run()
    })
    const previous = versions[1] ?? latest
    yield* Effect.sync(() => {
      db.update(ChapterTable)
        .set({ content: previous.content, word_count: previous.word_count, updated_at: Date.now() })
        .where(eq(ChapterTable.id, chapterID))
        .run()
    })
    const updated = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    return toChapter(updated!)
  })
}

export function updateChapterContent(
  novelID: string,
  chapterID: string,
  input: UpdateChapterContentInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const versions = db
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, chapterID))
      .orderBy(desc(ChapterVersionTable.version))
      .all()
    const nextVersion = versions.length === 0 ? 1 : versions[0]!.version + 1
    const current = chapter!
    yield* Effect.sync(() => {
      db.insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: chapterID,
          version: nextVersion,
          content: current.content,
          word_count: current.word_count,
          created_at: Date.now(),
          created_by: "update-content",
        })
        .run()
    })
    yield* Effect.sync(() => {
      db.update(ChapterTable)
        .set({ content: input.content, word_count: input.content.length, updated_at: Date.now() })
        .where(eq(ChapterTable.id, chapterID))
        .run()
    })
    const updated = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    return toChapter(updated!)
  })
}

export function submitApproval(novelID: string, chapterID: string, input: ApprovalInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    yield* Effect.promise(() => handleApproval(chapterID, input.action === "approve" ? "APPROVE" : "REJECT", directory))
    yield* Effect.promise(() =>
      storeCreateChapterReview(
        chapterID,
        {
          source: "human",
          overall: input.action === "approve" ? "PASS" : "FAIL",
          summary: input.comment ?? "",
        },
        directory,
      ),
    )
    const updated = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    return toChapter(updated!)
  })
}

export function listCharacters(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelID)).all().map(toCharacter)
  })
}

export function listPlotThreads(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelID)).all().map(toPlotThread)
  })
}

export function listForeshadowing(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db
      .select()
      .from(ForeshadowingTable)
      .where(eq(ForeshadowingTable.novel_id, novelID))
      .all()
      .map(toForeshadowing)
  })
}

export function listWorldEntries(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db.select().from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, novelID)).all().map(toWorldEntry)
  })
}

export function listTensionPoints(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db
      .select()
      .from(TensionLogTable)
      .where(eq(TensionLogTable.novel_id, novelID))
      .orderBy(asc(TensionLogTable.chapter_number))
      .all()
      .map(toTensionPoint)
  })
}

export function getOutlineBundle(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const outlinesDir = join(dirname(getDbPath(directory)), "outlines")
    if (!existsSync(outlinesDir)) {
      return { master: "", volumes: [], chapters: [] }
    }
    const masterPath = join(outlinesDir, "master.md")
    const master = existsSync(masterPath) ? readFileSync(masterPath, "utf-8") : ""
    const files = readdirSync(outlinesDir)
    const volumes = files
      .filter((f) => f.startsWith("volume-") && f.endsWith(".md"))
      .map((f) => {
        const volumeId = f.slice("volume-".length, -".md".length)
        return { volumeId, markdown: readFileSync(join(outlinesDir, f), "utf-8") }
      })
    const chapters = files
      .filter((f) => f.startsWith("chapter-") && f.endsWith(".md"))
      .map((f) => {
        const chapterId = f.slice("chapter-".length, -".md".length)
        return { chapterId, markdown: readFileSync(join(outlinesDir, f), "utf-8") }
      })
    return { master, volumes, chapters }
  })
}

export function updateOutline(
  novelID: string,
  input: { section: string; id?: string; markdown: string },
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const outlinesDir = join(dirname(getDbPath(directory)), "outlines")
    if (!existsSync(outlinesDir)) mkdirSync(outlinesDir, { recursive: true })
    const filename = input.section === "master" ? "master.md" : `${input.section}-${input.id}.md`
    writeFileSync(join(outlinesDir, filename), input.markdown, "utf-8")
    return yield* getOutlineBundle(novelID, directory)
  })
}

export function bindSession(novelID: string, input: BindSessionInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => tagNovelSession(input.sessionID, novelID, directory))
    const refreshed = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    return toNovel(refreshed!)
  })
}

export function createChapterEndpoint(novelID: string, input: CreateChapterInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateChapter(novelID, input.title, input.order, input.volumeId, directory),
    )
    return toChapter(row)
  })
}

export function deleteChapterEndpoint(novelID: string, chapterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    yield* Effect.promise(() => storeDeleteChapter(chapterID, directory))
    return { deleted: true }
  })
}

export function createVolumeEndpoint(novelID: string, input: CreateVolumeInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeCreateVolume(novelID, input.title, input.summary, directory))
    return toVolume(row)
  })
}

export function updateVolumeEndpoint(novelID: string, volumeID: string, input: UpdateVolumeInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const volume = db.select().from(VolumeTable).where(eq(VolumeTable.id, volumeID)).get()
    if (!volume || volume.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpdateVolume(volumeID, input, directory))
    return toVolume(row)
  })
}

export function deleteVolumeEndpoint(novelID: string, volumeID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const volume = db.select().from(VolumeTable).where(eq(VolumeTable.id, volumeID)).get()
    if (!volume || volume.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteVolume(volumeID, directory))
    return { deleted: true }
  })
}

export function restoreChapterVersion(
  novelID: string,
  chapterID: string,
  input: RestoreVersionInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const versions = db
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, chapterID))
      .orderBy(desc(ChapterVersionTable.version))
      .all()
    const target = versions.find((v) => v.version === input.version)
    if (!target) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const current = chapter!
    const latest = versions[0]
    yield* Effect.sync(() => {
      db.insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: chapterID,
          version: (latest?.version ?? 0) + 1,
          content: current.content,
          word_count: current.word_count,
          created_at: Date.now(),
          created_by: "restore",
        })
        .run()
      db.update(ChapterTable)
        .set({ content: target!.content, word_count: target!.word_count, updated_at: Date.now() })
        .where(eq(ChapterTable.id, chapterID))
        .run()
    })
    const updated = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    return toChapter(updated!)
  })
}

export function moveChapterEndpoint(novelID: string, chapterID: string, input: MoveChapterInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const row = yield* Effect.promise(() => storeMoveChapter(chapterID, input.action, input.volumeId, directory))
    return toChapter(row)
  })
}

export function updateChapterEndpoint(
  novelID: string,
  chapterID: string,
  input: UpdateChapterInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const chapter = db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterID)).get()
    if (!chapter || chapter.novel_id !== novelID) yield* Effect.fail(chapterNotFound(chapterID, novelID))
    const row = yield* Effect.promise(() => storeUpdateChapter(chapterID, input, directory))
    return toChapter(row)
  })
}

export function listRelationships(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    return db.select().from(RelationshipTable).where(eq(RelationshipTable.novel_id, novelID)).all().map(toRelationship)
  })
}

export function createRelationshipEndpoint(novelID: string, input: CreateRelationshipInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateRelationship(novelID, input.charAId, input.charBId, input.type, input.description, directory),
    )
    return toRelationship(row)
  })
}

export function updateRelationshipEndpoint(
  novelID: string,
  relationshipID: string,
  input: UpdateRelationshipInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const row = db.select().from(RelationshipTable).where(eq(RelationshipTable.id, relationshipID)).get()
    if (!row || row.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    const updated = yield* Effect.promise(() => storeUpdateRelationship(relationshipID, input, directory))
    return toRelationship(updated)
  })
}

export function deleteRelationshipEndpoint(novelID: string, relationshipID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const row = db.select().from(RelationshipTable).where(eq(RelationshipTable.id, relationshipID)).get()
    if (!row || row.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteRelationship(relationshipID, directory))
    return { deleted: true }
  })
}

export function listCharacterStates(novelID: string, characterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const character = db.select().from(CharacterTable).where(eq(CharacterTable.id, characterID)).get()
    if (!character || character.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    return db
      .select()
      .from(CharacterStateTable)
      .where(eq(CharacterStateTable.character_id, characterID))
      .all()
      .map(toCharacterState)
  })
}

export function listAllCharacterStates(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const characterIds = db
      .select({ id: CharacterTable.id })
      .from(CharacterTable)
      .where(eq(CharacterTable.novel_id, novelID))
      .all()
      .map((row) => row.id)
    if (characterIds.length === 0) return []
    return db
      .select()
      .from(CharacterStateTable)
      .where(inArray(CharacterStateTable.character_id, characterIds))
      .all()
      .map(toCharacterState)
  })
}

export function createCharacterStateEndpoint(
  novelID: string,
  characterID: string,
  input: CreateCharacterStateInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const character = db.select().from(CharacterTable).where(eq(CharacterTable.id, characterID)).get()
    if (!character || character.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateCharacterState(
        characterID,
        { chapterId: input.chapterId, location: input.place, mood: input.mood, summary: input.summary },
        directory,
      ),
    )
    return toCharacterState(row)
  })
}

export function updateCharacterStateEndpoint(
  novelID: string,
  stateID: string,
  input: UpdateCharacterStateInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const state = db.select().from(CharacterStateTable).where(eq(CharacterStateTable.id, stateID)).get()
    if (!state) yield* Effect.fail(novelNotFound(novelID))
    const character = db.select().from(CharacterTable).where(eq(CharacterTable.id, state!.character_id)).get()
    if (!character || character.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    const updated = yield* Effect.promise(() =>
      storeUpdateCharacterState(
        stateID,
        { active: input.active, location: input.place, mood: input.mood, summary: input.summary },
        directory,
      ),
    )
    return toCharacterState(updated)
  })
}

export function deleteCharacterStateEndpoint(novelID: string, stateID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const state = db.select().from(CharacterStateTable).where(eq(CharacterStateTable.id, stateID)).get()
    if (!state) yield* Effect.fail(novelNotFound(novelID))
    const character = db.select().from(CharacterTable).where(eq(CharacterTable.id, state!.character_id)).get()
    if (!character || character.novel_id !== novelID) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteCharacterState(stateID, directory))
    return { deleted: true }
  })
}

export function getStyleGuideEndpoint(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelID)).get()
    return row ? toStyleGuide(row) : { id: "", novelId: novelID, rules: {}, tone: "", pov: "", tense: "" }
  })
}

export function searchNovel(novelID: string, q: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const needle = q.trim()
    if (!needle) return []
    const pattern = `%${needle}%`
    const rows = db
      .select()
      .from(ChapterTable)
      .where(or(like(ChapterTable.title, pattern), like(ChapterTable.content, pattern)))
      .all()
      .filter((c) => c.novel_id === novelID)
    return rows.map((c) => {
      const idx = c.content.indexOf(needle)
      const snippet =
        idx >= 0 ? c.content.slice(Math.max(0, idx - 40), idx + needle.length + 40).replace(/\n+/g, " ") : c.title
      return {
        chapterId: c.id,
        title: c.title,
        order: c.order,
        volumeId: c.volume_id ?? undefined,
        snippet,
      }
    })
  })
}

export function updateStyleGuideEndpoint(novelID: string, input: UpdateStyleGuideInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpsertStyleGuide(novelID, input, directory))
    return toStyleGuide(row)
  })
}

export function updateNovel(novelID: string, input: UpdateNovelInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpdateNovel(novelID, input, directory))
    return toNovel(row)
  })
}

export function deleteNovel(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteNovel(novelID, directory))
    return { deleted: true }
  })
}

export function createCharacter(novelID: string, input: CreateCharacterInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateCharacter(novelID, input.name, input.role, input.description, directory),
    )
    return toCharacter(row)
  })
}

export function updateCharacter(novelID: string, characterID: string, input: UpdateCharacterInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpdateCharacter(characterID, input, directory))
    return toCharacter(row)
  })
}

export function deleteCharacter(novelID: string, characterID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteCharacter(characterID, directory))
    return { deleted: true }
  })
}

export function createTensionPoint(novelID: string, input: CreateTensionPointInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateTensionPoint(novelID, input.chapterNumber, input.level, directory),
    )
    return toTensionPoint(row)
  })
}

export function updateTensionPoint(
  novelID: string,
  pointID: string,
  input: UpdateTensionPointInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const level = input.level
    if (level === undefined) {
      const row = db.select().from(TensionLogTable).where(eq(TensionLogTable.id, pointID)).get()
      if (!row) yield* Effect.fail(novelNotFound(novelID))
      return toTensionPoint(row!)
    }
    const row = yield* Effect.promise(() => storeUpdateTensionPoint(pointID, level, directory))
    return toTensionPoint(row)
  })
}

export function deleteTensionPoint(novelID: string, pointID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteTensionPoint(pointID, directory))
    return { deleted: true }
  })
}

export function createPlotThread(novelID: string, input: CreatePlotThreadInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreatePlotThread(novelID, input.title, input.priority, input.description, directory),
    )
    return toPlotThread(row)
  })
}

export function updatePlotThread(novelID: string, threadID: string, input: UpdatePlotThreadInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpdatePlotThread(threadID, input, directory))
    return toPlotThread(row)
  })
}

export function deletePlotThread(novelID: string, threadID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeletePlotThread(threadID, directory))
    return { deleted: true }
  })
}

export function createForeshadowing(novelID: string, input: CreateForeshadowingInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateForeshadowing(novelID, input.content, input.plantedChapterId, directory),
    )
    return toForeshadowing(row)
  })
}

export function updateForeshadowing(
  novelID: string,
  entryID: string,
  input: UpdateForeshadowingInput,
  directory: string,
) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpdateForeshadowing(entryID, input, directory))
    return toForeshadowing(row)
  })
}

export function deleteForeshadowing(novelID: string, entryID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteForeshadowing(entryID, directory))
    return { deleted: true }
  })
}

export function createWorldEntry(novelID: string, input: CreateWorldEntryInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() =>
      storeCreateWorldEntry(novelID, input.category, input.title, input.content, directory),
    )
    return toWorldEntry(row)
  })
}

export function updateWorldEntry(novelID: string, entryID: string, input: UpdateWorldEntryInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpdateWorldEntry(entryID, input, directory))
    return toWorldEntry(row)
  })
}

export function deleteWorldEntry(novelID: string, entryID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    yield* Effect.promise(() => storeDeleteWorldEntry(entryID, directory))
    return { deleted: true }
  })
}

// ─── HttpApiBuilder group (wires endpoints to per-endpoint functions) ───

export const NovelHandler = HttpApiBuilder.group(Api, "server.novel", (handlers) =>
  Effect.succeed(
    handlers
      .handle("novel.list", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listNovels(location.directory)
        }),
      )
      .handle("novel.create", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createNovel(location.directory, ctx.payload)
        }),
      )
      .handle("novel.for-session", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* novelForSession(ctx.params.sessionID, location.directory)
        }),
      )
      .handle("novel.detail", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* novelDetail(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.volumes", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listVolumes(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.chapters", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listChapters(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.chapter", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getChapter(ctx.params.novelID, ctx.params.chapterID, location.directory)
        }),
      )
      .handle("novel.chapter-versions", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listChapterVersions(ctx.params.novelID, ctx.params.chapterID, location.directory)
        }),
      )
      .handle("novel.chapter-reviews", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listChapterReviews(ctx.params.novelID, ctx.params.chapterID, location.directory)
        }),
      )
      .handle("novel.rollback", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* rollbackChapter(ctx.params.novelID, ctx.params.chapterID, location.directory)
        }),
      )
      .handle("novel.update-content", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateChapterContent(ctx.params.novelID, ctx.params.chapterID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.approval", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* submitApproval(ctx.params.novelID, ctx.params.chapterID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.characters", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listCharacters(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.plot-threads", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listPlotThreads(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.foreshadowing", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listForeshadowing(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.world-entries", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listWorldEntries(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.outline", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getOutlineBundle(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.update-outline", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateOutline(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.export", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* exportNovel(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.delete-chapter", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteChapterEndpoint(ctx.params.novelID, ctx.params.chapterID, location.directory)
        }),
      )
      .handle("novel.create-volume", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createVolumeEndpoint(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-volume", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateVolumeEndpoint(ctx.params.novelID, ctx.params.volumeID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete-volume", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteVolumeEndpoint(ctx.params.novelID, ctx.params.volumeID, location.directory)
        }),
      )
      .handle("novel.restore-version", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* restoreChapterVersion(ctx.params.novelID, ctx.params.chapterID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.move-chapter", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* moveChapterEndpoint(ctx.params.novelID, ctx.params.chapterID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-chapter", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateChapterEndpoint(ctx.params.novelID, ctx.params.chapterID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.relationships", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listRelationships(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.create-relationship", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createRelationshipEndpoint(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-relationship", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateRelationshipEndpoint(
            ctx.params.novelID,
            ctx.params.relationshipID,
            ctx.payload,
            location.directory,
          )
        }),
      )
      .handle("novel.delete-relationship", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteRelationshipEndpoint(ctx.params.novelID, ctx.params.relationshipID, location.directory)
        }),
      )
      .handle("novel.character-states", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listCharacterStates(ctx.params.novelID, ctx.params.characterID, location.directory)
        }),
      )
      .handle("novel.all-character-states", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listAllCharacterStates(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.create-character-state", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createCharacterStateEndpoint(
            ctx.params.novelID,
            ctx.params.characterID,
            ctx.payload,
            location.directory,
          )
        }),
      )
      .handle("novel.update-character-state", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateCharacterStateEndpoint(
            ctx.params.novelID,
            ctx.params.stateID,
            ctx.payload,
            location.directory,
          )
        }),
      )
      .handle("novel.delete-character-state", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteCharacterStateEndpoint(ctx.params.novelID, ctx.params.stateID, location.directory)
        }),
      )
      .handle("novel.style-guide", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getStyleGuideEndpoint(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.update-style-guide", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateStyleGuideEndpoint(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.search", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* searchNovel(ctx.params.novelID, ctx.query.q, location.directory)
        }),
      )
      .handle("novel.tension", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listTensionPoints(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.bind", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* bindSession(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.create-chapter", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createChapterEndpoint(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateNovel(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteNovel(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.create-character", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createCharacter(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-character", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateCharacter(ctx.params.novelID, ctx.params.characterID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete-character", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteCharacter(ctx.params.novelID, ctx.params.characterID, location.directory)
        }),
      )
      .handle("novel.create-tension", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createTensionPoint(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-tension", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateTensionPoint(ctx.params.novelID, ctx.params.pointID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete-tension", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteTensionPoint(ctx.params.novelID, ctx.params.pointID, location.directory)
        }),
      )
      .handle("novel.create-plot-thread", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createPlotThread(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-plot-thread", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updatePlotThread(ctx.params.novelID, ctx.params.threadID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete-plot-thread", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deletePlotThread(ctx.params.novelID, ctx.params.threadID, location.directory)
        }),
      )
      .handle("novel.create-foreshadowing", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createForeshadowing(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-foreshadowing", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateForeshadowing(ctx.params.novelID, ctx.params.entryID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete-foreshadowing", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteForeshadowing(ctx.params.novelID, ctx.params.entryID, location.directory)
        }),
      )
      .handle("novel.create-world-entry", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createWorldEntry(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.update-world-entry", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateWorldEntry(ctx.params.novelID, ctx.params.entryID, ctx.payload, location.directory)
        }),
      )
      .handle("novel.delete-world-entry", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteWorldEntry(ctx.params.novelID, ctx.params.entryID, location.directory)
        }),
      ),
  ),
)
