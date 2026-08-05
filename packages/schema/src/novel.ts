import { Schema } from "effect"
import { optional } from "./schema"
import { NonNegativeInt, PositiveInt } from "./schema"

export const Genre = Schema.Literals(["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"])
export type Genre = typeof Genre.Type

export const Novel = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  genre: Genre,
  synopsis: Schema.String,
  status: Schema.String,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
}).annotate({ identifier: "Novel.Novel" })
export interface Novel extends Schema.Schema.Type<typeof Novel> {}

export const NovelStats = Schema.Struct({
  chapterCount: NonNegativeInt,
  volumeCount: NonNegativeInt,
  characterCount: NonNegativeInt,
  wordCount: NonNegativeInt,
}).annotate({ identifier: "Novel.NovelStats" })
export interface NovelStats extends Schema.Schema.Type<typeof NovelStats> {}

export const NovelDetail = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  genre: Genre,
  synopsis: Schema.String,
  status: Schema.String,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  styleGuide: Schema.suspend(() => StyleGuide),
  stats: NovelStats,
}).annotate({ identifier: "Novel.NovelDetail" })
export interface NovelDetail extends Schema.Schema.Type<typeof NovelDetail> {}

export const Volume = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  order: NonNegativeInt,
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.Volume" })
export interface Volume extends Schema.Schema.Type<typeof Volume> {}

export const VolumeSummary = Schema.Struct({
  id: Schema.String,
  volumeId: Schema.String,
  summary: Schema.String,
  charActive: Schema.Array(Schema.String),
  charDormant: Schema.Array(Schema.String),
  threadsOpen: Schema.Array(Schema.String),
  threadsClosed: Schema.Array(Schema.String),
}).annotate({ identifier: "Novel.VolumeSummary" })
export interface VolumeSummary extends Schema.Schema.Type<typeof VolumeSummary> {}

export const Chapter = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  volumeId: optional(Schema.String),
  title: Schema.String,
  order: NonNegativeInt,
  status: Schema.String,
  wordCount: NonNegativeInt,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
}).annotate({ identifier: "Novel.Chapter" })
export interface Chapter extends Schema.Schema.Type<typeof Chapter> {}

export const ChapterDetail = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  volumeId: optional(Schema.String),
  title: Schema.String,
  order: NonNegativeInt,
  status: Schema.String,
  wordCount: NonNegativeInt,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  content: Schema.String,
}).annotate({ identifier: "Novel.ChapterDetail" })
export interface ChapterDetail extends Schema.Schema.Type<typeof ChapterDetail> {}

export const ChapterVersion = Schema.Struct({
  id: Schema.String,
  chapterId: Schema.String,
  version: PositiveInt,
  content: Schema.String,
  wordCount: NonNegativeInt,
  createdAt: Schema.Int,
  createdBy: Schema.String,
}).annotate({ identifier: "Novel.ChapterVersion" })
export interface ChapterVersion extends Schema.Schema.Type<typeof ChapterVersion> {}

export const ReviewDimension = Schema.Struct({
  dimension: Schema.String,
  status: Schema.Literals(["PASS", "WARN", "FAIL"]),
  detail: Schema.String,
  evidence: optional(Schema.String),
}).annotate({ identifier: "Novel.ReviewDimension" })
export interface ReviewDimension extends Schema.Schema.Type<typeof ReviewDimension> {}

export const ChapterReview = Schema.Struct({
  id: Schema.String,
  chapterId: Schema.String,
  round: PositiveInt,
  source: Schema.Literals(["deterministic", "auditor", "human"]),
  overall: Schema.Literals(["PASS", "WARN", "FAIL"]),
  passCount: NonNegativeInt,
  warnCount: NonNegativeInt,
  failCount: NonNegativeInt,
  dimensions: Schema.Array(ReviewDimension),
  summary: Schema.String,
  sessionId: optional(Schema.String),
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.ChapterReview" })
export interface ChapterReview extends Schema.Schema.Type<typeof ChapterReview> {}

export const Character = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  name: Schema.String,
  role: Schema.String,
  description: Schema.String,
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.Character" })
export interface Character extends Schema.Schema.Type<typeof Character> {}

export const CharacterState = Schema.Struct({
  id: Schema.String,
  characterId: Schema.String,
  chapterId: optional(Schema.String),
  active: Schema.Int,
  location: optional(Schema.String),
  mood: optional(Schema.String),
  summary: optional(Schema.String),
}).annotate({ identifier: "Novel.CharacterState" })
export interface CharacterState extends Schema.Schema.Type<typeof CharacterState> {}

export const Relationship = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  charAId: Schema.String,
  charBId: Schema.String,
  type: Schema.String,
  description: Schema.String,
}).annotate({ identifier: "Novel.Relationship" })
export interface Relationship extends Schema.Schema.Type<typeof Relationship> {}

export const PlotThread = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  title: Schema.String,
  status: Schema.String,
  priority: Schema.String,
  description: Schema.String,
  createdAt: Schema.Int,
  closedAt: optional(Schema.Int),
}).annotate({ identifier: "Novel.PlotThread" })
export interface PlotThread extends Schema.Schema.Type<typeof PlotThread> {}

export const Foreshadowing = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  plantedChapterId: optional(Schema.String),
  resolvedChapterId: optional(Schema.String),
  content: Schema.String,
  state: Schema.String,
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.Foreshadowing" })
export interface Foreshadowing extends Schema.Schema.Type<typeof Foreshadowing> {}

export const WorldEntry = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  category: Schema.String,
  title: Schema.String,
  content: Schema.String,
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.WorldEntry" })
export interface WorldEntry extends Schema.Schema.Type<typeof WorldEntry> {}

export const StyleGuide = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  rules: Schema.Record(Schema.String, Schema.String),
  tone: Schema.String,
  pov: Schema.String,
  tense: Schema.String,
}).annotate({ identifier: "Novel.StyleGuide" })
export interface StyleGuide extends Schema.Schema.Type<typeof StyleGuide> {}

export const TensionPoint = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  chapterNumber: PositiveInt,
  level: Schema.Number,
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.TensionPoint" })
export interface TensionPoint extends Schema.Schema.Type<typeof TensionPoint> {}

export const HookRotation = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  hookType: Schema.String,
  chapterId: optional(Schema.String),
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.HookRotation" })
export interface HookRotation extends Schema.Schema.Type<typeof HookRotation> {}

export interface _OutlineNode {
  readonly id: string
  readonly type: "master" | "volume" | "chapter"
  readonly title: string
  readonly content?: string
  readonly children: ReadonlyArray<_OutlineNode>
}

export const OutlineNode: Schema.Schema<_OutlineNode> = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["master", "volume", "chapter"]),
  title: Schema.String,
  content: optional(Schema.String),
  children: Schema.Array(Schema.suspend(() => OutlineNode as any)),
}).annotate({ identifier: "Novel.OutlineNode" })
export interface OutlineNode extends Schema.Schema.Type<typeof OutlineNode> {}

export const OutlineBundle = Schema.Struct({
  master: Schema.String,
  volumes: Schema.Array(
    Schema.Struct({
      volumeId: Schema.String,
      markdown: Schema.String,
    }),
  ),
  chapters: Schema.Array(
    Schema.Struct({
      chapterId: Schema.String,
      markdown: Schema.String,
    }),
  ),
}).annotate({ identifier: "Novel.OutlineBundle" })
export interface OutlineBundle extends Schema.Schema.Type<typeof OutlineBundle> {}

export const OutlineUpdateInput = Schema.Struct({
  section: Schema.Literals(["master", "volume", "chapter"]),
  id: optional(Schema.String),
  markdown: Schema.String,
}).annotate({ identifier: "Novel.OutlineUpdateInput" })
export interface OutlineUpdateInput extends Schema.Schema.Type<typeof OutlineUpdateInput> {}

export const NovelExport = Schema.Struct({
  filename: Schema.String,
  content: Schema.String,
}).annotate({ identifier: "Novel.NovelExport" })
export interface NovelExport extends Schema.Schema.Type<typeof NovelExport> {}

export const CreateVolumeInput = Schema.Struct({
  title: Schema.String,
  summary: optional(Schema.String),
}).annotate({ identifier: "Novel.CreateVolumeInput" })
export interface CreateVolumeInput extends Schema.Schema.Type<typeof CreateVolumeInput> {}

export const UpdateVolumeInput = Schema.Struct({
  title: optional(Schema.String),
  summary: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateVolumeInput" })
export interface UpdateVolumeInput extends Schema.Schema.Type<typeof UpdateVolumeInput> {}

export const RestoreVersionInput = Schema.Struct({
  version: PositiveInt,
}).annotate({ identifier: "Novel.RestoreVersionInput" })
export interface RestoreVersionInput extends Schema.Schema.Type<typeof RestoreVersionInput> {}

export const MoveChapterInput = Schema.Struct({
  action: Schema.Literals(["up", "down", "to-volume"]),
  volumeId: optional(Schema.String),
}).annotate({ identifier: "Novel.MoveChapterInput" })
export interface MoveChapterInput extends Schema.Schema.Type<typeof MoveChapterInput> {}

export const UpdateChapterInput = Schema.Struct({
  title: optional(Schema.String),
  status: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateChapterInput" })
export interface UpdateChapterInput extends Schema.Schema.Type<typeof UpdateChapterInput> {}

export const CreateRelationshipInput = Schema.Struct({
  charAId: Schema.String,
  charBId: Schema.String,
  type: Schema.String,
  description: optional(Schema.String),
}).annotate({ identifier: "Novel.CreateRelationshipInput" })
export interface CreateRelationshipInput extends Schema.Schema.Type<typeof CreateRelationshipInput> {}

export const UpdateRelationshipInput = Schema.Struct({
  type: optional(Schema.String),
  description: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateRelationshipInput" })
export interface UpdateRelationshipInput extends Schema.Schema.Type<typeof UpdateRelationshipInput> {}

export const CreateCharacterStateInput = Schema.Struct({
  chapterId: optional(Schema.String),
  place: optional(Schema.String),
  mood: optional(Schema.String),
  summary: optional(Schema.String),
}).annotate({ identifier: "Novel.CreateCharacterStateInput" })
export interface CreateCharacterStateInput extends Schema.Schema.Type<typeof CreateCharacterStateInput> {}

export const UpdateCharacterStateInput = Schema.Struct({
  active: optional(Schema.Int),
  place: optional(Schema.String),
  mood: optional(Schema.String),
  summary: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateCharacterStateInput" })
export interface UpdateCharacterStateInput extends Schema.Schema.Type<typeof UpdateCharacterStateInput> {}

export const UpdateStyleGuideInput = Schema.Struct({
  tone: optional(Schema.String),
  pov: optional(Schema.String),
  tense: optional(Schema.String),
  rules: optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "Novel.UpdateStyleGuideInput" })
export interface UpdateStyleGuideInput extends Schema.Schema.Type<typeof UpdateStyleGuideInput> {}

export const NovelSearchResult = Schema.Struct({
  chapterId: Schema.String,
  title: Schema.String,
  order: Schema.Int,
  volumeId: optional(Schema.String),
  snippet: Schema.String,
}).annotate({ identifier: "Novel.NovelSearchResult" })
export interface NovelSearchResult extends Schema.Schema.Type<typeof NovelSearchResult> {}

export const CreateNovelInput = Schema.Struct({
  title: Schema.String,
  genre: Genre,
  synopsis: Schema.String,
}).annotate({ identifier: "Novel.CreateNovelInput" })
export interface CreateNovelInput extends Schema.Schema.Type<typeof CreateNovelInput> {}

export const UpdateChapterContentInput = Schema.Struct({
  content: Schema.String,
}).annotate({ identifier: "Novel.UpdateChapterContentInput" })
export interface UpdateChapterContentInput extends Schema.Schema.Type<typeof UpdateChapterContentInput> {}

export const ApprovalInput = Schema.Struct({
  action: Schema.Literals(["approve", "reject"]),
  comment: optional(Schema.String),
}).annotate({ identifier: "Novel.ApprovalInput" })
export interface ApprovalInput extends Schema.Schema.Type<typeof ApprovalInput> {}

export const BindSessionInput = Schema.Struct({
  sessionID: Schema.String,
}).annotate({ identifier: "Novel.BindSessionInput" })
export interface BindSessionInput extends Schema.Schema.Type<typeof BindSessionInput> {}

export const CreateChapterInput = Schema.Struct({
  title: Schema.String,
  volumeId: optional(Schema.String),
  order: optional(NonNegativeInt),
}).annotate({ identifier: "Novel.CreateChapterInput" })
export interface CreateChapterInput extends Schema.Schema.Type<typeof CreateChapterInput> {}

export const UpdateNovelInput = Schema.Struct({
  title: optional(Schema.String),
  synopsis: optional(Schema.String),
  genre: optional(Genre),
}).annotate({ identifier: "Novel.UpdateNovelInput" })
export interface UpdateNovelInput extends Schema.Schema.Type<typeof UpdateNovelInput> {}

export const CreateCharacterInput = Schema.Struct({
  name: Schema.String,
  role: optional(Schema.String),
  description: optional(Schema.String),
}).annotate({ identifier: "Novel.CreateCharacterInput" })
export interface CreateCharacterInput extends Schema.Schema.Type<typeof CreateCharacterInput> {}

export const UpdateCharacterInput = Schema.Struct({
  name: optional(Schema.String),
  role: optional(Schema.String),
  description: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateCharacterInput" })
export interface UpdateCharacterInput extends Schema.Schema.Type<typeof UpdateCharacterInput> {}

export const CreateTensionPointInput = Schema.Struct({
  chapterNumber: PositiveInt,
  level: Schema.Number,
}).annotate({ identifier: "Novel.CreateTensionPointInput" })
export interface CreateTensionPointInput extends Schema.Schema.Type<typeof CreateTensionPointInput> {}

export const UpdateTensionPointInput = Schema.Struct({
  level: optional(Schema.Number),
}).annotate({ identifier: "Novel.UpdateTensionPointInput" })
export interface UpdateTensionPointInput extends Schema.Schema.Type<typeof UpdateTensionPointInput> {}

export const CreatePlotThreadInput = Schema.Struct({
  title: Schema.String,
  priority: optional(Schema.String),
  description: optional(Schema.String),
}).annotate({ identifier: "Novel.CreatePlotThreadInput" })
export interface CreatePlotThreadInput extends Schema.Schema.Type<typeof CreatePlotThreadInput> {}

export const UpdatePlotThreadInput = Schema.Struct({
  title: optional(Schema.String),
  status: optional(Schema.String),
  priority: optional(Schema.String),
  description: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdatePlotThreadInput" })
export interface UpdatePlotThreadInput extends Schema.Schema.Type<typeof UpdatePlotThreadInput> {}

export const CreateForeshadowingInput = Schema.Struct({
  content: Schema.String,
  plantedChapterId: optional(Schema.String),
}).annotate({ identifier: "Novel.CreateForeshadowingInput" })
export interface CreateForeshadowingInput extends Schema.Schema.Type<typeof CreateForeshadowingInput> {}

export const UpdateForeshadowingInput = Schema.Struct({
  content: optional(Schema.String),
  state: optional(Schema.String),
  resolvedChapterId: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateForeshadowingInput" })
export interface UpdateForeshadowingInput extends Schema.Schema.Type<typeof UpdateForeshadowingInput> {}

export const CreateWorldEntryInput = Schema.Struct({
  category: Schema.String,
  title: Schema.String,
  content: optional(Schema.String),
}).annotate({ identifier: "Novel.CreateWorldEntryInput" })
export interface CreateWorldEntryInput extends Schema.Schema.Type<typeof CreateWorldEntryInput> {}

export const UpdateWorldEntryInput = Schema.Struct({
  category: optional(Schema.String),
  title: optional(Schema.String),
  content: optional(Schema.String),
}).annotate({ identifier: "Novel.UpdateWorldEntryInput" })
export interface UpdateWorldEntryInput extends Schema.Schema.Type<typeof UpdateWorldEntryInput> {}
