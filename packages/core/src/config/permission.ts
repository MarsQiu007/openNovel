export * as ConfigPermission from "./permission"

import { Schema } from "effect"

export class Judge extends Schema.Class<Judge>("ConfigV2.PermissionJudge")({
  model: Schema.String.pipe(Schema.optional).annotate({
    description: "裁判模型引用（providerID/modelID），缺省跟随会话当前模型",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Permission")({
  mode: Schema.Literals(["ask", "judge-shadow", "judge"]).pipe(Schema.optional).annotate({
    description: "权限裁判模式：ask 全人审（默认）/ judge-shadow 影子双轨 / judge 强制生效",
  }),
  policy: Schema.Record(Schema.String, Schema.Literals(["judge", "allow", "ask"])).pipe(Schema.optional).annotate({
    description: "按动作覆盖裁判策略表（judge 进裁判 / allow 确定性放行 / ask 走人审）",
  }),
  judge: Judge.pipe(Schema.optional).annotate({
    description: "裁判模型等裁判专属配置",
  }),
}) {}
