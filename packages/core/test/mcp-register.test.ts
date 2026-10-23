import { describe, expect } from "bun:test"
import path from "node:path"
import { Mcp } from "@opennovel-ai/core/mcp"
import { AgentV2 } from "@opennovel-ai/core/agent"
import type { ToolContent } from "@opennovel-ai/llm"
import { McpRegister } from "../src/mcp/register"
import { Config } from "@opennovel-ai/core/config"
import { ConfigMCP } from "@opennovel-ai/core/config/mcp"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Global } from "@opennovel-ai/core/global"
import { Location } from "@opennovel-ai/core/location"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionV2 } from "@opennovel-ai/core/session"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { Effect, Layer, Schedule } from "effect"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const fixture = path.join(import.meta.dir, "fixture", "mcp-stdio.ts")

type Servers = Record<string, ConfigMCP.Local>

const local = (environment?: Record<string, string>): ConfigMCP.Local =>
  new ConfigMCP.Local({
    type: "local",
    command: [process.execPath, fixture],
    ...(environment ? { environment } : {}),
  })

const assertions: PermissionV2.AssertInput[] = []
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

// servers 回调拿 tmp 路径：工具文件等夹具路径依赖测试专属目录
// setup 在层构建前执行：夹具文件必须先于服务器进程启动落盘
function testLayer(servers: (tmp: string) => Servers, setup?: (tmp: string) => Effect.Effect<void>) {
  return Layer.unwrap(
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.tap((tmp) => setup?.(tmp.path) ?? Effect.void),
      Effect.map((tmp) => {
        const global = (name: string) => path.join(tmp.path, "global", name)
        return AppNodeBuilder.build(LayerNode.group([McpRegister.node, Mcp.node, ToolRegistry.node]), [
          [
            Location.node,
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
            ),
          ],
          [
            Config.node,
            Layer.succeed(
              Config.Service,
              Config.Service.of({
                entries: () =>
                  Effect.succeed([
                    new Config.Document({
                      type: "document",
                      info: new Config.Info({ mcp: new ConfigMCP.Info({ servers: servers(tmp.path) }) }),
                    }),
                  ]),
              }),
            ),
          ],
          [
            Global.node,
            Global.layerWith({
              home: tmp.path,
              data: global("data"),
              cache: global("cache"),
              config: global("config"),
              state: global("state"),
              tmp: global("tmp"),
              bin: global("bin"),
              log: global("log"),
              repos: global("repos"),
            }),
          ],
          [PermissionV2.node, permission],
        ])
      }),
    ),
  )
}

const plain = testLayer(() => ({ fixture: local() }))

const identity = {
  sessionID: SessionV2.ID.make("ses_mcp_register"),
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_mcp_register"),
}

const call = (name: string, input: Record<string, unknown> = {}) => ({
  type: "tool-call" as const,
  id: `call_${name}`,
  name,
  input,
})

const retry = Schedule.spaced("100 millis").pipe(Schedule.both(Schedule.recurs(200)))

const waitDefinition = (registry: ToolRegistry.Interface, name: string) =>
  registry.materialize().pipe(
    Effect.filterOrElse(
      (materialized) => materialized.definitions.some((def) => def.name === name),
      (materialized) =>
        Effect.fail(new Error(`definitions: ${materialized.definitions.map((def) => def.name).join(",")}`)),
    ),
    Effect.retry(retry),
    Effect.map((materialized) => materialized.definitions.find((def) => def.name === name)!),
  )

const settle = (registry: ToolRegistry.Interface, name: string, input: Record<string, unknown> = {}) =>
  registry.materialize().pipe(Effect.flatMap((materialized) => materialized.settle({ ...identity, call: call(name, input) })))

describe("McpRegister", () => {
  it.live(
    "registers connected server tools and settles calls through the bridge",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const definition = yield* waitDefinition(registry, "fixture_echo")
        expect(definition.description).toBe("Echo text back")
        expect(definition.inputSchema).toMatchObject({ type: "object", properties: { text: { type: "string" } } })

        const settlement = yield* settle(registry, "fixture_echo", { text: "hi" })
        expect(settlement.result).toEqual({ type: "text", value: "hi" })
        expect(assertions.at(-1)).toMatchObject({ action: "mcp_fixture_echo", resources: ["*"] })
      }).pipe(Effect.provide(plain)),
    { timeout: 60_000 },
  )

  it.live(
    "falls back to a permissive input schema when the server schema is unresolvable",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const definition = yield* waitDefinition(registry, "fixture_bad_schema")
        expect(definition.inputSchema).not.toMatchObject({ $ref: expect.anything() })

        // 回退为 Unknown 后输入直通到服务器，由服务器端校验
        const settlement = yield* settle(registry, "fixture_bad_schema")
        expect(settlement.result).toEqual({ type: "error", value: "unknown tool: bad_schema" })
      }).pipe(Effect.provide(plain)),
    { timeout: 60_000 },
  )

  it.live(
    "maps server error results to tool failures",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* waitDefinition(registry, "fixture_fail")
        const settlement = yield* settle(registry, "fixture_fail")
        expect(settlement.result).toEqual({ type: "error", value: "boom" })
      }).pipe(Effect.provide(plain)),
    { timeout: 60_000 },
  )

  it.live(
    "maps calls on a disconnected server to tool failures",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const mcp = yield* Mcp.Service
        yield* waitDefinition(registry, "fixture_echo")
        yield* mcp.disconnect("fixture")
        const settlement = yield* settle(registry, "fixture_echo")
        expect(settlement.result).toMatchObject({ type: "error" })
        if (settlement.result.type === "error") expect(String(settlement.result.value)).toContain("not connected")
      }).pipe(Effect.provide(plain)),
    { timeout: 60_000 },
  )

  it.live(
    "converts result content parts and prefers structured content",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* waitDefinition(registry, "fixture_rich")

        const rich = yield* settle(registry, "fixture_rich")
        expect(rich.result.type).toBe("content")
        if (rich.result.type !== "content") return
        const parts = rich.result.value
        expect(parts[0]).toEqual({ type: "text", text: "plain" })
        // ToolContent 的 schema 类型在 content 分支外会退化成 any，回调参数显式标注
        const image = parts.find((part: ToolContent) => part.type === "file")
        expect(image?.mime).toBe("image/png")
        expect(image?.uri).toMatch(/^data:image\/png;base64,/)
        const texts = parts.flatMap((part: ToolContent) => (part.type === "text" ? [part.text] : []))
        expect(texts).toContain("[Resource link: file:///tmp/linked.txt]")
        expect(texts).toContain("[Resource file:///tmp/notes.txt (text/plain)]\nnote body")
        expect(texts).toContain('[Resource file:///tmp/data.json (application/json)]\n{"k":1}')
        expect(texts).toContain("[Binary resource file:///tmp/blob.bin (application/octet-stream, 4 bytes) omitted]")

        // structuredContent 直通结构化输出
        const structured = yield* settle(registry, "fixture_structured")
        expect(structured.output?.structured).toEqual({ answer: 42 })

        // 无 outputSchema 的 JSON 文本预解析为对象
        const json = yield* settle(registry, "fixture_json_text")
        expect(json.output?.structured).toEqual({ answer: 42 })
        expect(json.result).toEqual({ type: "text", value: '{"answer":42}' })
      }).pipe(Effect.provide(plain)),
    { timeout: 60_000 },
  )

  it.live(
    "drops a wholly denied tool from materialization",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* waitDefinition(registry, "fixture_echo")

        const denied = yield* registry.materialize([{ action: "mcp_fixture_echo", resource: "*", effect: "deny" }])
        const names = denied.definitions.map((def) => def.name)
        expect(names).not.toContain("fixture_echo")
        expect(names).toContain("fixture_fail")

        // 资源级收紧不等于整工具消失
        const narrowed = yield* registry.materialize([
          { action: "mcp_fixture_echo", resource: "some/resource", effect: "deny" },
        ])
        expect(narrowed.definitions.map((def) => def.name)).toContain("fixture_echo")
      }).pipe(Effect.provide(plain)),
    { timeout: 60_000 },
  )

  it.live(
    "prefixes digit-leading names and suffixes registry-name collisions",
    () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* waitDefinition(registry, "mcp_2srv_echo")

        // 服务器 mcp_2srv 的工具键恰好撞上 2srv 加前缀后的注册名，后到者追加序号
        const names = (yield* registry.materialize()).definitions.map((def) => def.name)
        expect(names).toContain("mcp_2srv_echo_1")
      }).pipe(
        Effect.provide(
          testLayer(() => ({
            "2srv": local(),
            mcp_2srv: local(),
          })),
        ),
      ),
    { timeout: 60_000 },
  )

  it.live(
    "re-registers when the server broadcasts a tool list change",
    () => {
      // 层的输出类型不含 Location：setup 阶段把目录交给测试体写 v2 工具文件
      let dir = ""
      return Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const mcp = yield* Mcp.Service
        yield* waitDefinition(registry, "fixture_reload")
        const before = (yield* registry.materialize()).definitions.map((def) => def.name)
        expect(before).not.toContain("fixture_extra")

        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "tools.json"),
            JSON.stringify([
              { name: "reload", description: "Re-read the tools file", inputSchema: { type: "object", properties: {} } },
              { name: "extra", description: "Added after reload", inputSchema: { type: "object", properties: {} } },
            ]),
          ),
        )
        yield* mcp.callTool({ server: "fixture", name: "reload" })

        const definition = yield* waitDefinition(registry, "fixture_extra")
        expect(definition.description).toBe("Added after reload")
      }).pipe(
        Effect.provide(
          testLayer(
            (tmp) => ({ fixture: local({ MCP_FIXTURE_TOOLS: path.join(tmp, "tools.json") }) }),
            (tmp) => {
              dir = tmp
              return Effect.promise(() =>
                Bun.write(
                  path.join(tmp, "tools.json"),
                  JSON.stringify([
                    {
                      name: "reload",
                      description: "Re-read the tools file",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ]),
                ),
              )
            },
          ),
        ),
      )
    },
    { timeout: 60_000 },
  )
})
