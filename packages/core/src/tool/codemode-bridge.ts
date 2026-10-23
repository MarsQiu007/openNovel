export * as CodeModeBridge from "./codemode-bridge"

import { Tool } from "@opennovel-ai/codemode"
import type { ToolDefinition } from "@opennovel-ai/llm"
import type { Effect } from "effect"

/**
 * registry inventory → codemode 工具树的桥接。
 *
 * JSON Schema 只塑造沙箱内的模型可见签名（值透传不校验）；输入解码、
 * 权限断言与输出限界全部发生在 fork registry 的 settle 边界——桥接层
 * 不复制任何校验与授权逻辑。
 */
export const toHostTools = (
  definitions: ReadonlyArray<ToolDefinition>,
  settle: (name: string, input: unknown) => Effect.Effect<unknown, unknown>,
): Record<string, Tool.Definition> =>
  Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      Tool.make({
        description: definition.description,
        input: definition.inputSchema as Tool.JsonSchema,
        run: (input) => settle(definition.name, input),
      }),
    ]),
  )
