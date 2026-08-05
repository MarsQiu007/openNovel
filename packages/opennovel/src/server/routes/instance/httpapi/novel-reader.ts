import { Effect } from "effect"
import { HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http"
import { eq, asc } from "drizzle-orm"
import { readFileSync, readdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import {
  getDb,
  getDbPath,
  NovelTable,
  ChapterTable,
  VolumeTable,
  CharacterTable,
  RelationshipTable,
  WorldEntryTable,
  ForeshadowingTable,
  StyleGuideTable,
  PlotThreadTable,
  ChapterSummaryTable,
} from "@opennovel-ai/plugin/novel-writer/session-store"
// text import is inlined by Bun.build at bundle time; typed as HTMLBundle by bun-types but is a string
import readerHtml from "./novel-reader.html" with { type: "text" }

function resolveDir(request: HttpServerRequest.HttpServerRequest): string | undefined {
  const url = new URL(request.url, "http://localhost")
  return url.searchParams.get("directory") || request.headers["x-opennovel-directory"] || undefined
}

function getOutlinesDir(directory?: string | null): string {
  return join(dirname(getDbPath(directory)), "outlines")
}

export const novelReaderRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", "/reader", () => Effect.succeed(HttpServerResponse.html(readerHtml as unknown as string)))

    yield* router.add("GET", "/api/novels", (request) =>
      Effect.sync(() => {
        const novels = getDb(resolveDir(request), { fresh: true }).select().from(NovelTable).all()
        return HttpServerResponse.jsonUnsafe({ data: novels })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const novel = getDb(resolveDir(request), { fresh: true })
          .select()
          .from(NovelTable)
          .where(eq(NovelTable.id, novelId))
          .get()
        if (!novel) return HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 })
        return HttpServerResponse.jsonUnsafe({ data: novel })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/chapters", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const chapters = getDb(resolveDir(request), { fresh: true })
          .select({
            id: ChapterTable.id,
            title: ChapterTable.title,
            order: ChapterTable.order,
            status: ChapterTable.status,
            word_count: ChapterTable.word_count,
            volume_id: ChapterTable.volume_id,
            summary: ChapterSummaryTable.summary,
          })
          .from(ChapterTable)
          .leftJoin(ChapterSummaryTable, eq(ChapterSummaryTable.chapter_id, ChapterTable.id))
          .where(eq(ChapterTable.novel_id, novelId))
          .orderBy(asc(ChapterTable.order))
          .all()
        return HttpServerResponse.jsonUnsafe({ data: chapters })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/chapters/:chapterId", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const chapterId = params.chapterId
        if (!chapterId) return HttpServerResponse.jsonUnsafe({ error: "missing chapterId" }, { status: 404 })
        const chapter = getDb(resolveDir(request), { fresh: true })
          .select()
          .from(ChapterTable)
          .where(eq(ChapterTable.id, chapterId))
          .get()
        if (!chapter) return HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 })

        if (chapter.status === "outline") {
          const outlinePath = join(getOutlinesDir(resolveDir(request)), `chapter-${chapter.order}.md`)
          if (existsSync(outlinePath)) {
            const outlineContent = readFileSync(outlinePath, "utf-8")
            return HttpServerResponse.jsonUnsafe({ data: { ...chapter, content: outlineContent } })
          }
        }

        return HttpServerResponse.jsonUnsafe({ data: chapter })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/volumes", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const volumes = getDb(resolveDir(request), { fresh: true })
          .select()
          .from(VolumeTable)
          .where(eq(VolumeTable.novel_id, novelId))
          .orderBy(asc(VolumeTable.order))
          .all()
        return HttpServerResponse.jsonUnsafe({ data: volumes })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/characters", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const db = getDb(resolveDir(request), { fresh: true })
        const characters = db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
        const relationships = db.select().from(RelationshipTable).where(eq(RelationshipTable.novel_id, novelId)).all()
        return HttpServerResponse.jsonUnsafe({ data: { characters, relationships } })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/world", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const entries = getDb(resolveDir(request), { fresh: true })
          .select()
          .from(WorldEntryTable)
          .where(eq(WorldEntryTable.novel_id, novelId))
          .orderBy(asc(WorldEntryTable.created_at))
          .all()
        return HttpServerResponse.jsonUnsafe({ data: entries })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/foreshadowing", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const db = getDb(resolveDir(request), { fresh: true })
        const foreshadowing = db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.novel_id, novelId)).all()
        const threads = db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()
        return HttpServerResponse.jsonUnsafe({ data: { foreshadowing, threads } })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/style", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const novelId = params.novelId
        if (!novelId) return HttpServerResponse.jsonUnsafe({ error: "missing novelId" }, { status: 404 })
        const style = getDb(resolveDir(request), { fresh: true })
          .select()
          .from(StyleGuideTable)
          .where(eq(StyleGuideTable.novel_id, novelId))
          .get()
        return HttpServerResponse.jsonUnsafe({ data: style || null })
      }),
    )

    yield* router.add("GET", "/api/novels/:novelId/outlines", (request) =>
      Effect.sync(() => {
        const dir = getOutlinesDir(resolveDir(request))
        if (!existsSync(dir)) return HttpServerResponse.jsonUnsafe({ data: [] })
        const files = readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => {
            const content = readFileSync(join(dir, f), "utf-8")
            return { filename: f, content }
          })
        return HttpServerResponse.jsonUnsafe({ data: files })
      }),
    )
  }),
)
