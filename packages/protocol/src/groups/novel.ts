import {
  ApprovalInput,
  BindSessionInput,
  Chapter,
  ChapterDetail,
  ChapterVersion,
  ChapterReview,
  Character,
  CharacterState,
  CreateChapterInput,
  CreateCharacterInput,
  CreateCharacterStateInput,
  CreateForeshadowingInput,
  CreateNovelInput,
  CreatePlotThreadInput,
  CreateRelationshipInput,
  CreateTensionPointInput,
  CreateVolumeInput,
  CreateWorldEntryInput,
  Foreshadowing,
  MoveChapterInput,
  Novel,
  NovelDetail,
  NovelExport,
  NovelSearchResult,
  OutlineBundle,
  OutlineUpdateInput,
  PlotThread,
  Relationship,
  RestoreVersionInput,
  StyleGuide,
  TensionPoint,
  UpdateChapterContentInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateCharacterStateInput,
  UpdateForeshadowingInput,
  UpdateNovelInput,
  UpdatePlotThreadInput,
  UpdateRelationshipInput,
  UpdateStyleGuideInput,
  UpdateTensionPointInput,
  UpdateVolumeInput,
  UpdateWorldEntryInput,
  Volume,
  WorldEntry,
} from "@opennovel-ai/schema/novel"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const root = "/api/novel"

export class NovelNotFoundError extends Schema.ErrorClass<NovelNotFoundError>("NovelNotFoundError")(
  {
    name: Schema.Literal("NovelNotFoundError"),
    data: Schema.Struct({ message: Schema.String, novelId: Schema.optional(Schema.String) }),
  },
  { httpApiStatus: 404 },
) {}

export class ChapterNotFoundError extends Schema.ErrorClass<ChapterNotFoundError>("ChapterNotFoundError")(
  {
    name: Schema.Literal("ChapterNotFoundError"),
    data: Schema.Struct({
      message: Schema.String,
      novelId: Schema.optional(Schema.String),
      chapterId: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 404 },
) {}

export class NovelValidationError extends Schema.ErrorClass<NovelValidationError>("NovelValidationError")(
  {
    name: Schema.Literal("NovelValidationError"),
    data: Schema.Struct({ message: Schema.String, field: Schema.optional(Schema.String) }),
  },
  { httpApiStatus: 400 },
) {}

export const NovelGroup = HttpApiGroup.make("server.novel")
  .add(
    HttpApiEndpoint.get("novel.list", root, {
      query: LocationQuery,
      success: Schema.Array(Novel),
      error: NovelValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.list",
          summary: "List novels",
          description: "List all novels with their stats.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.create", root, {
      query: LocationQuery,
      payload: CreateNovelInput,
      success: Novel,
      error: NovelValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.create",
          summary: "Create novel",
          description: "Create a new novel with title, genre, and synopsis.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.for-session", `${root}/for-session/:sessionID`, {
      params: { sessionID: Schema.String },
      query: LocationQuery,
      success: Novel,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.for-session",
          summary: "Novel for session",
          description: "Resolve the novel bound to a session. Declared before /:novelID to avoid route swallowing.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.detail", `${root}/:novelID`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: NovelDetail,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.detail",
          summary: "Novel detail",
          description: "Get a novel with its style guide and stats.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.volumes", `${root}/:novelID/volumes`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(Volume),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.volumes",
          summary: "List volumes",
          description: "List all volumes of a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.chapters", `${root}/:novelID/chapters`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(Chapter),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.chapters",
          summary: "List chapters",
          description: "List all chapters of a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.chapter", `${root}/:novelID/chapters/:chapterID`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      success: ChapterDetail,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.chapter",
          summary: "Chapter detail",
          description: "Get a single chapter with its content.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.chapter-versions", `${root}/:novelID/chapters/:chapterID/versions`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(ChapterVersion),
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.chapter-versions",
          summary: "List chapter versions",
          description: "List the version history of a chapter.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.chapter-reviews", `${root}/:novelID/chapters/:chapterID/reviews`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(ChapterReview),
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.chapter-reviews",
          summary: "List chapter reviews",
          description:
            "List the persisted review records of a chapter (deterministic checks, auditor deep audits, human annotations), newest first.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.rollback", `${root}/:novelID/chapters/:chapterID/rollback`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      success: Chapter,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.rollback",
          summary: "Rollback chapter",
          description: "Roll a chapter back to its previous version.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.update-content", `${root}/:novelID/chapters/:chapterID/content`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      payload: UpdateChapterContentInput,
      success: Chapter,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.update-content",
          summary: "Update chapter content",
          description: "Replace the content of a chapter.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.approval", `${root}/:novelID/chapters/:chapterID/approval`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      payload: ApprovalInput,
      success: Chapter,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.approval",
          summary: "Approve or reject chapter",
          description: "Submit an approval decision for a chapter.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.characters", `${root}/:novelID/characters`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(Character),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.characters",
          summary: "List characters",
          description: "List all characters of a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.plot-threads", `${root}/:novelID/plot-threads`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(PlotThread),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.plot-threads",
          summary: "List plot threads",
          description: "List all plot threads of a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.foreshadowing", `${root}/:novelID/foreshadowing`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(Foreshadowing),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.foreshadowing",
          summary: "List foreshadowing",
          description: "List all foreshadowing entries of a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.world-entries", `${root}/:novelID/world-entries`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(WorldEntry),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.world-entries",
          summary: "List world entries",
          description: "List all world-building entries of a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.outline", `${root}/:novelID/outline`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: OutlineBundle,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.outline",
          summary: "Novel outline",
          description: "Get the master, volume, and chapter outline bundle for a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.update-outline", `${root}/:novelID/outline`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: OutlineUpdateInput,
      success: OutlineBundle,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.update-outline",
          summary: "Update outline section",
          description: "Update the master, volume, or chapter outline markdown.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.export", `${root}/:novelID/export`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: NovelExport,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.export",
          summary: "Export novel",
          description: "Compile the full novel (volumes and chapters in order) into a single markdown document.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-chapter", `${root}/:novelID/chapters/:chapterID`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.delete-chapter", summary: "Delete chapter" })),
  )
  .add(
    HttpApiEndpoint.post("novel.create-volume", `${root}/:novelID/volumes`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateVolumeInput,
      success: Volume,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.create-volume", summary: "Create volume" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-volume", `${root}/:novelID/volumes/:volumeID`, {
      params: { novelID: Schema.String, volumeID: Schema.String },
      query: LocationQuery,
      payload: UpdateVolumeInput,
      success: Volume,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update-volume", summary: "Update volume" })),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-volume", `${root}/:novelID/volumes/:volumeID`, {
      params: { novelID: Schema.String, volumeID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.delete-volume",
          summary: "Delete volume; its chapters become unassigned",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.restore-version", `${root}/:novelID/chapters/:chapterID/restore`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      payload: RestoreVersionInput,
      success: Chapter,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.restore-version",
          summary: "Restore chapter to a specific version",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.move-chapter", `${root}/:novelID/chapters/:chapterID/move`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      payload: MoveChapterInput,
      success: Chapter,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.move-chapter",
          summary: "Reorder chapter or move it to another volume",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.update-chapter", `${root}/:novelID/chapters/:chapterID`, {
      params: { novelID: Schema.String, chapterID: Schema.String },
      query: LocationQuery,
      payload: UpdateChapterInput,
      success: Chapter,
      error: ChapterNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.update-chapter", summary: "Update chapter title or status" }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.relationships", `${root}/:novelID/relationships`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(Relationship),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.relationships", summary: "List character relationships" }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.create-relationship", `${root}/:novelID/relationships`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateRelationshipInput,
      success: Relationship,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.create-relationship", summary: "Create character relationship" }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.update-relationship", `${root}/:novelID/relationships/:relationshipID`, {
      params: { novelID: Schema.String, relationshipID: Schema.String },
      query: LocationQuery,
      payload: UpdateRelationshipInput,
      success: Relationship,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.update-relationship", summary: "Update character relationship" }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-relationship", `${root}/:novelID/relationships/:relationshipID`, {
      params: { novelID: Schema.String, relationshipID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.delete-relationship", summary: "Delete character relationship" }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.character-states", `${root}/:novelID/characters/:characterID/states`, {
      params: { novelID: Schema.String, characterID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(CharacterState),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.character-states", summary: "List character states" }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.all-character-states", `${root}/:novelID/character-states`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(CharacterState),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.all-character-states",
          summary: "List all character states for a novel",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.create-character-state", `${root}/:novelID/characters/:characterID/states`, {
      params: { novelID: Schema.String, characterID: Schema.String },
      query: LocationQuery,
      payload: CreateCharacterStateInput,
      success: CharacterState,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.create-character-state", summary: "Create character state" }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.update-character-state", `${root}/:novelID/character-states/:stateID`, {
      params: { novelID: Schema.String, stateID: Schema.String },
      query: LocationQuery,
      payload: UpdateCharacterStateInput,
      success: CharacterState,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.update-character-state", summary: "Update character state" }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-character-state", `${root}/:novelID/character-states/:stateID`, {
      params: { novelID: Schema.String, stateID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.delete-character-state", summary: "Delete character state" }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.style-guide", `${root}/:novelID/style-guide`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: StyleGuide,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.style-guide", summary: "Get novel style guide" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-style-guide", `${root}/:novelID/style-guide`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: UpdateStyleGuideInput,
      success: StyleGuide,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.update-style-guide", summary: "Update novel style guide" }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.search", `${root}/:novelID/search`, {
      params: { novelID: Schema.String },
      query: Schema.Struct({
        q: Schema.String,
        location: Schema.optional(
          Schema.Struct({ directory: Schema.optional(Schema.String), workspace: Schema.optional(Schema.String) }),
        ),
      }),
      success: Schema.Array(NovelSearchResult),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.search",
          summary: "Full-text search across chapter titles and content",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("novel.tension", `${root}/:novelID/tension`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Array(TensionPoint),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.tension",
          summary: "Tension curve",
          description: "List tension points tracking the novel's pacing curve.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.bind", `${root}/:novelID/bind`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: BindSessionInput,
      success: Novel,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novel.bind",
          summary: "Bind session",
          description: "Bind a session to a novel.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.create-chapter", `${root}/:novelID/chapters`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateChapterInput,
      success: Chapter,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.create-chapter", summary: "Create chapter" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update", `${root}/:novelID`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: UpdateNovelInput,
      success: Novel,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update", summary: "Update novel" })),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete", `${root}/:novelID`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.delete", summary: "Delete novel" })),
  )
  .add(
    HttpApiEndpoint.post("novel.create-character", `${root}/:novelID/characters`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateCharacterInput,
      success: Character,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.create-character", summary: "Create character" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-character", `${root}/:novelID/characters/:characterID`, {
      params: { novelID: Schema.String, characterID: Schema.String },
      query: LocationQuery,
      payload: UpdateCharacterInput,
      success: Character,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update-character", summary: "Update character" })),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-character", `${root}/:novelID/characters/:characterID`, {
      params: { novelID: Schema.String, characterID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.delete-character", summary: "Delete character" })),
  )
  .add(
    HttpApiEndpoint.post("novel.create-tension", `${root}/:novelID/tension`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateTensionPointInput,
      success: TensionPoint,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.create-tension", summary: "Create tension point" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-tension", `${root}/:novelID/tension/:pointID`, {
      params: { novelID: Schema.String, pointID: Schema.String },
      query: LocationQuery,
      payload: UpdateTensionPointInput,
      success: TensionPoint,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update-tension", summary: "Update tension point" })),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-tension", `${root}/:novelID/tension/:pointID`, {
      params: { novelID: Schema.String, pointID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.delete-tension", summary: "Delete tension point" })),
  )
  .add(
    HttpApiEndpoint.post("novel.create-plot-thread", `${root}/:novelID/plot-threads`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreatePlotThreadInput,
      success: PlotThread,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.create-plot-thread", summary: "Create plot thread" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-plot-thread", `${root}/:novelID/plot-threads/:threadID`, {
      params: { novelID: Schema.String, threadID: Schema.String },
      query: LocationQuery,
      payload: UpdatePlotThreadInput,
      success: PlotThread,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update-plot-thread", summary: "Update plot thread" })),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-plot-thread", `${root}/:novelID/plot-threads/:threadID`, {
      params: { novelID: Schema.String, threadID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.delete-plot-thread", summary: "Delete plot thread" })),
  )
  .add(
    HttpApiEndpoint.post("novel.create-foreshadowing", `${root}/:novelID/foreshadowing`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateForeshadowingInput,
      success: Foreshadowing,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.create-foreshadowing", summary: "Create foreshadowing" }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novel.update-foreshadowing", `${root}/:novelID/foreshadowing/:entryID`, {
      params: { novelID: Schema.String, entryID: Schema.String },
      query: LocationQuery,
      payload: UpdateForeshadowingInput,
      success: Foreshadowing,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.update-foreshadowing", summary: "Update foreshadowing" }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-foreshadowing", `${root}/:novelID/foreshadowing/:entryID`, {
      params: { novelID: Schema.String, entryID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.novel.delete-foreshadowing", summary: "Delete foreshadowing" }),
      ),
  )
  .add(
    HttpApiEndpoint.post("novel.create-world-entry", `${root}/:novelID/world-entries`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: CreateWorldEntryInput,
      success: WorldEntry,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.create-world-entry", summary: "Create world entry" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-world-entry", `${root}/:novelID/world-entries/:entryID`, {
      params: { novelID: Schema.String, entryID: Schema.String },
      query: LocationQuery,
      payload: UpdateWorldEntryInput,
      success: WorldEntry,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update-world-entry", summary: "Update world entry" })),
  )
  .add(
    HttpApiEndpoint.delete("novel.delete-world-entry", `${root}/:novelID/world-entries/:entryID`, {
      params: { novelID: Schema.String, entryID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.delete-world-entry", summary: "Delete world entry" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "novel", description: "Novel writing and review routes." }))
