export * as CodeModeTool from "./codemode"

import { CodeMode, toolError } from "@opennovel-ai/codemode"
import { ToolFailure } from "@opennovel-ai/llm"
import { Effect, Layer, Ref, Schema } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { CodeModeBridge } from "./codemode-bridge"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

/**
 * Code Mode 工具（agent-code-mode）：agent 提交一段 JS，在受限解释器里
 * 以 `tools.<name>(input)` 批量调用本会话可见的工具，一次调用完成批量操作。
 *
 * 并存模式：本工具与既有直接工具定义共存，不隐藏任何工具的目录定义
 *（否决了上游 execute 启用即隐藏非 direct 工具的范式，见 change design）。
 * 沙箱无 import/文件系统/定时器/fetch；嵌套调用走 registry settle 边界，
 * 输入解码、输出限界与工具自身的权限断言全部继承——写操作仍过审批闸门。
 */

const ACTION = "code_mode"
const TIMEOUT_MS = 60_000

export const toolName = "code_mode"

const Input = Schema.Struct({
  code: Schema.String.annotate({
    description: "JavaScript source. Call tools as await tools.<name>(input); use an explicit return.",
  }),
})

const CallRecord = Schema.Struct({
  name: Schema.String,
  outcome: Schema.Literals(["success", "failure"]),
  message: Schema.optionalKey(Schema.String),
})

const Output = Schema.Struct({
  ok: Schema.Boolean,
  value: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(Schema.String),
  calls: Schema.Array(CallRecord),
})
type Output = Schema.Schema.Type<typeof Output>

const description = [
  "Run JavaScript in a confined Code Mode runtime to script batch tool calls and compose their results.",
  "Inside `code`, call any tool visible to you as `await tools.<name>(input)` (bracket notation for unusual names: tools[\"some-tool\"](input)). The callable set is exactly the tools you can see in this session.",
  "Discover tool signatures with `await tools.$codemode.search({ query })`.",
  "No imports, filesystem access, timers, or network (fetch is unavailable); all external access goes through `tools`.",
  "Prefer an explicit `return`; the returned value must be JSON-serializable.",
  "Await every call whose completion matters; run independent calls concurrently with Promise.allSettled.",
  "Write operations still go through the permission gate and may be declined.",
].join("\n")

const modelText = (output: Output) => {
  const calls =
    output.calls.length === 0
      ? "no tool calls"
      : output.calls
          .map((call) => `- ${call.name}: ${call.outcome}${call.message ? ` (${call.message})` : ""}`)
          .join("\n")
  if (!output.ok) return `Error: ${output.error ?? "unknown"}\n\ntool calls:\n${calls}`
  return `${output.value === undefined ? "undefined" : JSON.stringify(output.value, null, 2)}\n\ntool calls:\n${calls}`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const registry = yield* ToolRegistry.Service
    const agents = yield* AgentV2.Service

    yield* tools
      .register({
        [toolName]: Tool.withPermission(
          Tool.make({
            description,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: modelText(output) }],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* permission.assert({
                  action: ACTION,
                  resources: ["*"],
                  save: ["*"],
                  metadata: { code: input.code },
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const agent = yield* agents.get(context.agent)
                const materialization = yield* registry.materialize(agent?.permissions ?? [])
                // 嵌套调用的 ToolCall id 派生自外层调用，单次执行内单调递增
                const sequence = yield* Ref.make(0)
                const calls = yield* Ref.make<Array<Schema.Schema.Type<typeof CallRecord>>>([])
                const inventory = materialization.definitions.filter((definition) => definition.name !== toolName)
                const hostTools = CodeModeBridge.toHostTools(inventory, (name, toolInput) =>
                  Ref.getAndUpdate(sequence, (n) => n + 1).pipe(
                    Effect.flatMap((n) =>
                      materialization.settle({
                        sessionID: context.sessionID,
                        agent: context.agent,
                        assistantMessageID: context.assistantMessageID,
                        call: { type: "tool-call", id: `${context.toolCallID}#${n}`, name, input: toolInput },
                      }),
                    ),
                    Effect.flatMap((settlement) => {
                      // toolError 是解释器认可的模型安全通道；普通 Error 会被消毒成通用消息
                      if (settlement.result.type === "error")
                        return Effect.fail(toolError(String(settlement.result.value)))
                      return Effect.succeed(settlement.output?.structured ?? settlement.result.value)
                    }),
                  ),
                )
                const runtime = CodeMode.make({
                  tools: hostTools,
                  limits: { timeoutMs: TIMEOUT_MS },
                  onToolCallEnd: (call) =>
                    Ref.update(calls, (items) => [
                      ...items,
                      { name: call.name, outcome: call.outcome, ...(call.message ? { message: call.message } : {}) },
                    ]),
                })
                const result = yield* runtime.execute(input.code)
                const records = yield* Ref.get(calls)
                if (!result.ok)
                  return {
                    ok: false,
                    error: `${result.error.kind}: ${result.error.message}`,
                    calls: records,
                  }
                return { ok: true, value: result.value, calls: records }
              }).pipe(
                Effect.mapError((error) =>
                  error instanceof ToolFailure
                    ? error
                    : new ToolFailure({
                        message: `${toolName}: ${error instanceof Error ? error.message : String(error)}`,
                      }),
                ),
              ),
          }),
          ACTION,
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/codemode",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, AgentV2.node],
})
