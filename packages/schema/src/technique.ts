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

export const TechniqueScope = Schema.Literals(["general", "adult"]).annotate({
  identifier: "Novel.TechniqueScope",
  description: "内容性质：general=通用写法（入全局库跨书共享）；adult=成人内容（留本书库）",
})
export type TechniqueScope = typeof TechniqueScope.Type

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
  scope: TechniqueScope,
  /** 来源库：book=本书库；global=全局通用库。单源接口缺省由服务端按所查库填充。 */
  library: Schema.optional(Schema.Literals(["book", "global"])),
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
  scope: Schema.optional(TechniqueScope),
  /** 归属库：book=本书库（缺省）；global=全局通用库（仅允许 scope=general）。命名为 targetLibrary 以规避 httpapi-codegen 对 query/payload 同名字段的碰撞校验。 */
  targetLibrary: Schema.optional(Schema.Literals(["book", "global"])),
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
  scope: Schema.optional(TechniqueScope),
}).annotate({ identifier: "Novel.UpdateTechniqueInput" })
export interface UpdateTechniqueInput extends Schema.Schema.Type<typeof UpdateTechniqueInput> {}

export const TechniqueContentNature = Schema.Literals(["adult", "general"]).annotate({
  identifier: "Novel.TechniqueContentNature",
  description: "书级内容性质：adult=成人内容；general=通用",
})
export type TechniqueContentNature = typeof TechniqueContentNature.Type

export const TechniqueContentNatureState = Schema.Struct({
  value: TechniqueContentNature,
  /** override=人工覆盖值；passive=被动信号（书库存在 adult 技法判 adult，否则 general） */
  source: Schema.Literals(["override", "passive"]),
}).annotate({
  identifier: "Novel.TechniqueContentNatureState",
  description: "书级内容性质有效值及来源",
})
export interface TechniqueContentNatureState extends Schema.Schema.Type<typeof TechniqueContentNatureState> {}

export const TechniqueInjection = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  contentNature: Schema.optional(TechniqueContentNatureState),
  contentNatureOverride: Schema.optional(Schema.Union([TechniqueContentNature, Schema.Null])),
}).annotate({
  identifier: "Novel.TechniqueInjection",
  description:
    "项目级技法配置：enabled=技法注入开关（false 保持 shadow 模式）；contentNature=书级内容性质有效值及来源；contentNatureOverride=人工覆盖（null 清除、缺省=自动模式）",
})
export interface TechniqueInjection extends Schema.Schema.Type<typeof TechniqueInjection> {}
