/**
 * 小说写作模式（项目级）契约 schema
 *
 * 持久化到项目根 .novel/config.json，对应 novel-store 实现的 WritingMode / SetupMode。
 * 命名沿用 snake_case 与配置文件保持一致（writing_mode / setup_mode），便于跨语言辨识。
 */
import { Schema } from "effect"

/** 写作模式枚举 */
export const WritingMode = Schema.Literals(["auto", "review"]).annotate({
  identifier: "Novel.WritingMode",
  description: "写作模式：auto = 全自动写完直接推进；review = 每章写完置 pending_review 等用户审批",
})
export type WritingMode = typeof WritingMode.Type

/** 初始化模式枚举 */
export const SetupMode = Schema.Literals(["interactive", "auto"]).annotate({
  identifier: "Novel.SetupMode",
  description: "初始化模式：interactive = 与用户讨论并呈现方案，确认后才落库；auto = 直接落库",
})
export type SetupMode = typeof SetupMode.Type

/** 完整模式配置（输出） */
export const NovelMode = Schema.Struct({
  writing_mode: WritingMode,
  setup_mode: SetupMode,
}).annotate({
  identifier: "Novel.NovelMode",
  description: "项目级写作模式与初始化模式",
})
export interface NovelMode extends Schema.Schema.Type<typeof NovelMode> {}

/** 模式设置入参（部分字段，PATCH 语义） */
export const NovelModePatch = Schema.Struct({
  writing_mode: Schema.optional(WritingMode),
  setup_mode: Schema.optional(SetupMode),
}).annotate({
  identifier: "Novel.NovelModePatch",
  description: "模式设置入参，仅指定需要修改的字段",
})
export interface NovelModePatch extends Schema.Schema.Type<typeof NovelModePatch> {}
