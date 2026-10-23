import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { ToolFailure } from "@opennovel-ai/llm"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { SessionV2 } from "@opennovel-ai/core/session"
import { CodeModeTool } from "@opennovel-ai/core/tool/codemode"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { Tool } from "@opennovel-ai/core/tool/tool"
import { Tools } from "@opennovel-ai/core/tool/tools"
import { ToolOutputStore } from "@opennovel-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, toolDefinitions } from "./lib/tool"

let assertions: PermissionV2.AssertInput[] = []

const allow = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)).pipe(Effect.asVoid),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
// 放行 code_mode 本体、拒绝 fixture_write（验证脚本内写操作仍过工具自身断言）
const denyWrite = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      input.action === "fixture_write"
        ? Effect.fail(new PermissionV2.BlockedError({ rules: [] }))
        : Effect.sync(() => assertions.push(input)).pipe(Effect.asVoid),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const denyCodeMode = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      input.action === CodeModeTool.toolName
        ? Effect.fail(new PermissionV2.BlockedError({ rules: [] }))
        : Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

// 构建层之外再 merge 一份权限 stub：夹具工具在测试体内直接取 PermissionV2.Service
const toolLayer = (permission: Layer.Layer<PermissionV2.Service>) =>
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, CodeModeTool.node, AgentV2.node]), [
      [PermissionV2.node, permission],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ]),
    permission,
  )
const it = testEffect(toolLayer(allow))
const writeDenied = testEffect(toolLayer(denyWrite))
const codeModeDenied = testEffect(toolLayer(denyCodeMode))

const session = SessionV2.ID.make("ses_codemode")
const call = (name: string, input: unknown) => ({
  sessionID: session,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

// 测试夹具：echo 回显（只读）、write_probe（execute 内自断言 fixture_write）、
// secret_probe（挂 fixture_secret 目录动作，验证 whollyDisabled 不进 inventory）
const echo = Tool.make({
  description: "Echo the input text back",
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ text: Schema.String }),
  execute: (input) => Effect.succeed({ text: input.text }),
})

const registerFixtures = Effect.gen(function* () {
  const tools = yield* Tools.Service
  const permission = yield* PermissionV2.Service
  yield* tools.register({
    echo,
    write_probe: Tool.make({
      description: "Write probe guarded by the fixture_write action",
      input: Schema.Struct({}),
      output: Schema.Struct({ done: Schema.Boolean }),
      execute: (_input, context) =>
        permission
          .assert({
            action: "fixture_write",
            resources: ["*"],
            save: ["*"],
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
          })
          .pipe(
            Effect.mapError(() => new ToolFailure({ message: "write_probe blocked by permission" })),
            Effect.as({ done: true }),
          ),
    }),
    secret_probe: Tool.withPermission(
      Tool.make({
        description: "Secret probe filtered out when fixture_secret is denied",
        input: Schema.Struct({}),
        output: Schema.Struct({ found: Schema.Boolean }),
        execute: () => Effect.succeed({ found: true }),
      }),
      "fixture_secret",
    ),
  })
})

describe("CodeModeTool 沙箱执行", () => {
  it.effect("脚本并发调用只读工具并聚合返回，调用清单入输出", () =>
    Effect.gen(function* () {
      assertions = []
      yield* registerFixtures
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(
        registry,
        call(CodeModeTool.toolName, {
          code: `const [a, b] = await Promise.all([tools.echo({ text: "一" }), tools.echo({ text: "二" })])
return [a.text, b.text]`,
        }),
      )
      expect(result.type).toBe("text")
      const text = result.type === "text" ? String(result.value) : ""
      expect(text).toContain("一")
      expect(text).toContain("二")
      expect(text.match(/echo: success/g)?.length).toBe(2)
      expect(assertions).toMatchObject([{ action: "code_mode" }])
    }),
  )

  writeDenied.effect("脚本内写操作经工具自身权限断言上浮为脚本可见失败", () =>
    Effect.gen(function* () {
      yield* registerFixtures
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(
        registry,
        call(CodeModeTool.toolName, { code: `return await tools.write_probe({})` }),
      )
      // 程序失败是数据而非工具错误：模型拿到诊断可自行修正
      expect(result.type).toBe("text")
      const text = result.type === "text" ? String(result.value) : ""
      expect(text).toContain("Error:")
      expect(text).toContain("write_probe blocked by permission")
    }),
  )

  writeDenied.effect("脚本 try/catch 可捕获被拒的写调用并继续", () =>
    Effect.gen(function* () {
      yield* registerFixtures
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(
        registry,
        call(CodeModeTool.toolName, {
          code: `try {
  await tools.write_probe({})
  return "not blocked"
} catch (error) {
  const ok = await tools.echo({ text: "fallback" })
  return "caught:" + ok.text
}`,
        }),
      )
      expect(result.type).toBe("text")
      expect(result.type === "text" && String(result.value)).toContain("caught:fallback")
    }),
  )

  it.effect("被 deny 的工具不进沙箱 inventory（调用报 UnknownTool）", () =>
    Effect.gen(function* () {
      yield* registerFixtures
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (item) => {
          item.permissions = [{ action: "fixture_secret", resource: "*", effect: "deny" }]
        }),
      )
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(
        registry,
        call(CodeModeTool.toolName, { code: `return await tools.secret_probe({})` }),
      )
      expect(result.type).toBe("text")
      const text = result.type === "text" ? String(result.value) : ""
      expect(text).toContain("Error:")
      expect(text).toContain("secret_probe")
    }),
  )

  it.effect("脚本语法错误是数据型诊断而非工具错误", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, call(CodeModeTool.toolName, { code: "return 1 +=" }))
      expect(result.type).toBe("text")
      const text = result.type === "text" ? String(result.value) : ""
      expect(text).toContain("Error:")
      expect(text).toContain("ParseError")
    }),
  )

  codeModeDenied.effect("权限 deny 时 code_mode 执行被拒", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, call(CodeModeTool.toolName, { code: "return 1" }))
      expect(result.type).toBe("error")
    }),
  )

  it.effect("目录面：deny code_mode 动作时工具本体从目录消失", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const visible = yield* toolDefinitions(registry)
      expect(visible.map((definition) => definition.name)).toContain(CodeModeTool.toolName)
      const denied = yield* toolDefinitions(registry, [
        { action: CodeModeTool.toolName, resource: "*", effect: "deny" },
      ])
      expect(denied.map((definition) => definition.name)).not.toContain(CodeModeTool.toolName)
    }),
  )
})
