export * as McpRegister from "./register"

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { McpEvent } from "@opennovel-ai/schema/mcp-event"
import { Context, Effect, Exit, Fiber, JsonSchema, Layer, Ref, Schema, SchemaRepresentation, Scope, Semaphore, Stream } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { PermissionV2 } from "../permission"
import { ReadTool } from "../tool/read"
import { Tool } from "../tool/tool"
import { ToolRegistry } from "../tool/registry"
import { Tools } from "../tool/tools"
import { McpCatalog } from "./catalog"
import { Mcp } from "./index"

export interface Interface {
  /** 等待首次注册完成（测试与调用方守序用）；重注册由 ToolsChanged 事件驱动 */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/McpRegister") {}

type ResultContent = CallToolResult["content"][number]

interface ExecuteResult {
  readonly value: unknown
  readonly content: ReadonlyArray<Tool.Content>
}

const TEXTUAL_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/sql",
  "image/svg+xml",
])

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const events = yield* EventV2.Service
    const root = yield* Effect.scope
    const lock = Semaphore.makeUnsafe(1)
    const registration = yield* Ref.make<Scope.Closeable | undefined>(undefined)

    const reload = lock.withPermits(1)(
      Effect.gen(function* () {
        const listed = yield* mcp.tools()
        const record: Record<string, Tool.AnyTool> = {}
        const used = new Set<string>()
        for (const [base, tool] of Object.entries(listed)) {
          record[registryName(base, used)] = yield* toTool(base, tool)
        }
        // 先注册新一批再关旧 scope：registry 的 latest-wins 语义保证关旧后暴露的是新注册，目录无空窗
        const child = yield* Scope.fork(root)
        yield* tools
          .register(record)
          .pipe(Scope.provide(child), Effect.onError(() => Scope.close(child, Exit.void)))
        const previous = yield* Ref.getAndSet(registration, child)
        if (previous !== undefined) yield* Scope.close(previous, Exit.void)
      }),
    )

    const initial = yield* reload.pipe(Effect.forkScoped({ startImmediately: true }))
    yield* events
      .subscribe(McpEvent.ToolsChanged)
      .pipe(Stream.debounce("100 millis"), Stream.runForEach(() => reload), Effect.forkScoped({ startImmediately: true }))

    function toTool(base: string, listed: Mcp.ListedTool) {
      return Effect.gen(function* () {
        // 服务器下发的 inputSchema 不可信（坏 $ref 等会抛错）：转换失败回退 Unknown，交给服务器端校验
        const input = yield* Effect.try({
          try: () => jsonSchemaCodec(listed.def.inputSchema),
          catch: () => new Error("unsupported input schema"),
        }).pipe(Effect.orElseSucceed(() => Schema.Unknown))
        return Tool.withPermission(
          Tool.make({
            description: listed.def.description ?? "",
            input,
            output: Schema.Unknown,
            structured: Schema.Unknown,
            toStructuredOutput: ({ output }) => (output as ExecuteResult).value,
            toModelOutput: ({ output }) => (output as ExecuteResult).content,
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* permission.assert({
                  action: `mcp_${base}`,
                  resources: ["*"],
                  save: ["*"],
                  metadata: { input: input ?? {} },
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const result = yield* mcp
                  .callTool({
                    server: listed.server,
                    name: listed.def.name,
                    args: (input ?? {}) as Record<string, unknown>,
                  })
                  .pipe(
                    Effect.catchTags({
                      "MCP.NotFoundError": (error) =>
                        new Tool.Failure({ message: `MCP server "${error.name}" is not available` }),
                      "MCP.ToolCallError": (error) => new Tool.Failure({ message: error.message }),
                    }),
                  )
                if (result.isError)
                  return yield* new Tool.Failure({
                    message:
                      result.content
                        .flatMap((part) => (part.type === "text" ? [part.text] : []))
                        .join("\n")
                        .trim() || "MCP tool returned an error",
                  })
                const content = result.content.map(toContent)
                return { value: toolValue(listed, result, content), content } satisfies ExecuteResult
              }).pipe(
                Effect.mapError((error) =>
                  error instanceof Tool.Failure
                    ? error
                    : new Tool.Failure({
                        message: `Unable to execute ${base}: ${error instanceof Error ? error.message : String(error)}`,
                      }),
                ),
              ),
          }),
          `mcp_${base}`,
        )
      })
    }

    return Service.of({ flush: Fiber.await(initial).pipe(Effect.asVoid) })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Mcp.node, ToolRegistry.node, PermissionV2.node, EventV2.node],
})

function jsonSchemaCodec(schema: unknown): Schema.Codec<unknown> {
  const js = (schema ?? { type: "object", properties: {} }) as JsonSchema.JsonSchema
  const draft = isDraft07(js) ? JsonSchema.fromSchemaDraft07(js) : JsonSchema.fromSchemaDraft2020_12(js)
  return SchemaRepresentation.toSchema(SchemaRepresentation.fromJsonSchemaDocument(draft)) as Schema.Codec<unknown>
}

function isDraft07(js: JsonSchema.JsonSchema) {
  if (typeof js !== "object" || js === null) return false
  return (typeof js.$schema === "string" && js.$schema.includes("draft-07")) || "definitions" in js
}

// Tool.validateName 要求字母开头且不超过 64 字符：数字开头补 mcp_ 前缀，超长截断，
// 截断撞名时追加序号后缀（同批次内确定，重注册间顺序稳定故命名稳定）
function registryName(base: string, used: Set<string>) {
  const normalized = /^[A-Za-z]/.test(base) ? base : `mcp_${base}`
  for (let suffix = 0; ; suffix++) {
    const tail = suffix === 0 ? "" : `_${suffix}`
    const name = normalized.slice(0, 64 - tail.length) + tail
    if (!used.has(name)) {
      used.add(name)
      return name
    }
  }
}

// 只内联 read 工具认可的图片类型：其余媒体走 data URI 会在后续 turn 的请求 lowering 处失败；
// fork 无二进制落盘通道（上游 ToolOutput.save 无对位），不支持的二进制降级为占位文本
function toContent(part: ResultContent): Tool.Content {
  if (part.type === "text") return { type: "text", text: part.text }
  if (part.type === "resource_link") return { type: "text", text: `[Resource link: ${part.uri}]` }
  if (part.type === "resource") {
    const resource = part.resource
    const mime = normalizeMime(resource.mimeType)
    if ("text" in resource)
      return { type: "text", text: `[Resource ${resource.uri}${mime ? ` (${mime})` : ""}]\n${resource.text}` }
    if (mime && ReadTool.SUPPORTED_IMAGE_MIMES.has(mime))
      return { type: "file", data: resource.blob, mime, name: resource.uri }
    if (mime && isTextual(mime))
      return {
        type: "text",
        text: `[Resource ${resource.uri} (${mime})]\n${Buffer.from(resource.blob, "base64").toString("utf8")}`,
      }
    return {
      type: "text",
      text: `[Binary resource ${resource.uri} (${mime ?? "unknown"}, ${byteLength(resource.blob)} bytes) omitted]`,
    }
  }
  const mime = normalizeMime(part.mimeType)
  if (mime && ReadTool.SUPPORTED_IMAGE_MIMES.has(mime)) return { type: "file", data: part.data, mime }
  return {
    type: "text",
    text: `[${part.type} content (${mime ?? "unknown"}, ${byteLength(part.data)} bytes) omitted]`,
  }
}

function normalizeMime(mime: string | undefined) {
  return mime?.split(";", 1)[0].trim().toLowerCase() || undefined
}

function isTextual(mime: string) {
  return mime.startsWith("text/") || TEXTUAL_MIMES.has(mime)
}

function byteLength(base64: string) {
  return Buffer.from(base64, "base64").byteLength
}

function toolValue(listed: Mcp.ListedTool, result: CallToolResult, content: ReadonlyArray<Tool.Content>) {
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  if (text === "") return null
  // 服务器未声明 outputSchema 时 agent 会把 JSON 文本当对象用，提前解析；解析失败保持原文
  if (listed.def.outputSchema === undefined && (text.startsWith("{") || text.startsWith("["))) {
    const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(text)
    if (parsed._tag === "Some") return parsed.value
  }
  return text
}
