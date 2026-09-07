/**
 * 技法库管理契约。
 *
 * 输出模型不暴露 embedding 向量；置信度由反馈闭环维护，不在管理界面直接编辑。
 */
import { Schema } from "effect"
import { optional } from "./schema.js"

export const TechniqueLevel = Schema.Literals(["paragraph", "sentence", "dialogue", "description", "transition"]).annotate({
  identifier: "Novel.TechniqueLevel",
  description: "技法作用层级：段落 / 句子 / 对话 / 描写 / 过渡",
})
export type TechniqueLevel = typeof TechniqueLevel.Type

export const TechniqueStatus = Schema.Literals(["unverified", "verified", "shadow", "archived"]).annotate({
  identifier: "Novel.TechniqueStatus",
  description: "技法状态：unverified / verified / shadow / archived",
})
export type TechniqueStatus = typeof TechniqueStatus.Type

export const TechniqueEvidence = Schema.Struct({
  sourceTitle: Schema.String,
  sourceLocation: Schema.String,
  excerpt: Schema.String,
  annotation: Schema.String,
}).annotate({ identifier: "Novel.TechniqueEvidence" })
export type TechniqueEvidence = typeof TechniqueEvidence.Type

export const Technique = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  principle: Schema.String,
  instruction: Schema.String,
  sceneTypes: Schema.Array(Schema.String),
  level: TechniqueLevel,
  evidence: Schema.Array(TechniqueEvidence),
  commonMisuse: Schema.String,
  confidence: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  status: TechniqueStatus,
  usageCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastUsedAt: optional(Schema.Int),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
}).annotate({ identifier: "Novel.Technique" })
export interface Technique extends Schema.Schema.Type<typeof Technique> {}

export const TechniqueFeedback = Schema.Struct({
  id: Schema.String,
  techniqueId: Schema.String,
  chapterId: Schema.String,
  score: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  wasUsed: Schema.Boolean,
  comment: Schema.String,
  createdAt: Schema.Int,
}).annotate({ identifier: "Novel.TechniqueFeedback" })
export type TechniqueFeedback = typeof TechniqueFeedback.Type

export const TechniqueDetail = Schema.Struct({
  technique: Technique,
  feedbacks: Schema.Array(TechniqueFeedback),
}).annotate({ identifier: "Novel.TechniqueDetail" })
export interface TechniqueDetail extends Schema.Schema.Type<typeof TechniqueDetail> {}

export const CreateTechniqueInput = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  instruction: Schema.NonEmptyString.check(Schema.isMaxLength(4000)),
  principle: Schema.optional(Schema.String),
  sceneTypes: Schema.optional(Schema.Array(Schema.String)),
  level: Schema.optional(TechniqueLevel),
  evidence: Schema.optional(Schema.Array(TechniqueEvidence)),
  commonMisuse: Schema.optional(Schema.String),
  status: Schema.optional(TechniqueStatus),
}).annotate({ identifier: "Novel.CreateTechniqueInput" })
export interface CreateTechniqueInput extends Schema.Schema.Type<typeof CreateTechniqueInput> {}

export const UpdateTechniqueInput = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(200))),
  principle: Schema.optional(Schema.String),
  instruction: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(4000))),
  sceneTypes: Schema.optional(Schema.Array(Schema.String)),
  level: Schema.optional(TechniqueLevel),
  evidence: Schema.optional(Schema.Array(TechniqueEvidence)),
  commonMisuse: Schema.optional(Schema.String),
  status: Schema.optional(TechniqueStatus),
}).annotate({ identifier: "Novel.UpdateTechniqueInput" })
export interface UpdateTechniqueInput extends Schema.Schema.Type<typeof UpdateTechniqueInput> {}

export const TechniqueInjection = Schema.Struct({
  enabled: Schema.Boolean,
}).annotate({
  identifier: "Novel.TechniqueInjection",
  description: "项目级技法注入开关；false 表示保持 shadow 模式",
})
export interface TechniqueInjection extends Schema.Schema.Type<typeof TechniqueInjection> {}
