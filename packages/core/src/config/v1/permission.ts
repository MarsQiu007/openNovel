export * as ConfigPermissionV1 from "./permission"

import { Schema, SchemaGetter } from "effect"

export const Action = Schema.Literals(["ask", "allow", "deny"]).annotate({ identifier: "PermissionActionConfig" })
export type Action = Schema.Schema.Type<typeof Action>

export const Object = Schema.Record(Schema.String, Action).annotate({ identifier: "PermissionObjectConfig" })
export type Object = Schema.Schema.Type<typeof Object>

export const Rule = Schema.Union([Action, Object]).annotate({ identifier: "PermissionRuleConfig" })
export type Rule = Schema.Schema.Type<typeof Rule>

// 裁判策略档位值（V2 policy 的值域）：挂在 RestValue 里让其余键也能通过校验，
// 显式字段之外的误写（如对某工具写 "judge"）在迁移层按非法 effect 丢弃，不沉淀为规则。
const PolicyValue = Schema.Record(Schema.String, Schema.Literals(["judge", "allow", "ask"]))
const JudgeConfig = Schema.Struct({
  model: Schema.optional(Schema.String).annotate({
    description: "裁判模型引用（providerID/modelID），缺省跟随会话当前模型",
  }),
})
const ModeValue = Schema.Literals(["ask", "judge-shadow", "judge"])

// RestValue 必须能容纳显式字段 mode/policy/judge 的类型（StructWithRest 的索引签名约束），
// 因此把裁判相关形状并进来；键仍是判别依据（mode/policy/judge 是配置键，不是工具名）。
const RestValue = Schema.Union([Rule, ModeValue, PolicyValue, JudgeConfig])

// Known permission keys get explicit types in the Effect schema for generated
// docs/types. Runtime config parsing uses Effect's `propertyOrder: "original"`
// parse option so user key order is preserved for permission precedence.
//
// mode / policy / judge 是 V2 裁判配置字段（与 ConfigV2.Permission 同形状）：磁盘上的
// opennovel.json 由 V1 Info 解析（服务端配置层与 HttpApi 均走 ConfigV1.Info），而裁判
// 链路经 V2 读取，因此 V1 on-disk schema 必须原样承载这些字段，否则含裁判配置的文件
// 会让服务端配置解析整体失败。真实工具不会恰好命名为 mode/policy/judge。
const InputObject = Schema.StructWithRest(
  Schema.Struct({
    read: Schema.optional(Rule),
    edit: Schema.optional(Rule),
    glob: Schema.optional(Rule),
    grep: Schema.optional(Rule),
    list: Schema.optional(Rule),
    bash: Schema.optional(Rule),
    task: Schema.optional(Rule),
    external_directory: Schema.optional(Rule),
    todowrite: Schema.optional(Action),
    question: Schema.optional(Action),
    webfetch: Schema.optional(Action),
    websearch: Schema.optional(Action),
    lsp: Schema.optional(Rule),
    doom_loop: Schema.optional(Action),
    skill: Schema.optional(Rule),
    mode: Schema.optional(ModeValue).annotate({
      description: "权限裁判模式：ask 全人审（默认）/ judge-shadow 影子双轨 / judge 强制生效",
    }),
    policy: Schema.optional(PolicyValue).annotate({
      description: "按动作覆盖裁判策略表（judge 进裁判 / allow 确定性放行 / ask 走人审）",
    }),
    judge: Schema.optional(JudgeConfig).annotate({
      description: "裁判模型等裁判专属配置",
    }),
  }),
  [Schema.Record(Schema.String, RestValue)],
)

const InputSchema = Schema.Union([Action, InputObject])

const normalizeInput = (input: Schema.Schema.Type<typeof InputSchema>): Schema.Schema.Type<typeof InputObject> =>
  typeof input === "string" ? { "*": input } : input

export const Info = InputSchema.pipe(
  Schema.decodeTo(InputObject, {
    decode: SchemaGetter.transform(normalizeInput),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
).annotate({ identifier: "PermissionConfig" })
type _Info = Schema.Schema.Type<typeof InputObject>
export type Info = { -readonly [K in keyof _Info]: _Info[K] }
