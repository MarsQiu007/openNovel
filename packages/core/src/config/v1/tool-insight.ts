export * as ConfigToolInsight from "./tool-insight"

import { Schema } from "effect"

/**
 * 工具改进日志（toolInsight）全局设置。
 * 在 ConfigV1.Info 中保持纯 optional：键缺省时有效值为关闭，禁止用解码默认值把缺省
 * payload 物化成 `{ enabled: false }` 覆写既有设置。项目配置不覆盖这两个全局隐私字段。
 */
export const ToolInsight = Schema.Struct({
  enabled: Schema.Boolean.annotate({
    description: "Whether the local tool improvement log is enabled. Absent field means disabled.",
  }),
  directory: Schema.optional(Schema.String).annotate({
    description:
      "Optional shared log root directory. Empty or absent resolves to the per-project '.novel/evaluate/tool-insight/' directory; a shared root is isolated per project by a short hash.",
  }),
}).annotate({
  identifier: "ToolInsight",
  description: "Local tool insight logging settings; project config cannot override these global privacy settings",
})
