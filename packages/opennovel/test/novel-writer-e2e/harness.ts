/**
 * 技法 agent 流程 e2e 驱动器：全节点会话栈 + TestLLMServer 假端点 + 回合驱动与断言工具。
 *
 * 节点清单镜像 test/session/prompt.test.ts 的 promptRoot（全量会话栈），
 * 但不设 disableDefaultPlugins——NovelWriterPlugin 经 Plugin.node 自动装载。
 * provider 配置参照 httpapi-exercise 的 fakeLlmConfig：@ai-sdk/openai-compatible 指向假端点。
 */
import { ConfigV1 } from "@opennovel-ai/core/v1/config/config"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Agent as AgentSvc } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Database } from "@opennovel-ai/core/database/database"
import { Env } from "@/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { Instruction } from "@/session/instruction"
import { LSP } from "@/lsp/lsp"
import { LLM } from "@/session/llm"
import { MCP } from "@/mcp"
import { MessageV2 } from "@/session/message-v2"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Question } from "@/question"
import { Ripgrep } from "@opennovel-ai/core/ripgrep"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { SystemPrompt } from "@/session/system"
import { Todo } from "@/session/todo"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opennovel-ai/core/cross-spawn-spawner"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in novel-writer e2e"),
    authenticate: () => Effect.die("unexpected MCP auth in novel-writer e2e"),
    finishAuth: () => Effect.die("unexpected MCP auth in novel-writer e2e"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const promptRoot = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
])

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const root = LayerNode.group([promptRoot, testLLMServerNode])
const replacements = [
  [SessionSummary.node, summary],
  [LSP.node, lsp],
  [MCP.node, mcp],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
] as const

export const it = testEffect(LayerNode.compile(root, replacements))

type ConfigModel = NonNullable<NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]>["models"]>[string]

/** 实例 provider 配置：test/test-model 指向 TestLLMServer 假端点（同 httpapi-exercise fakeLlmConfig）。 */
export function providerCfg(url: string): Partial<ConfigV1.Info> {
  const model = {
    id: "test-model",
    name: "Test Model",
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: 100000, output: 10000 },
    cost: { input: 0, output: 0 },
    options: {},
  } as ConfigModel
  return {
    model: "test/test-model",
    small_model: "test/test-model",
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: { "test-model": model },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
  }
}

/** 发一条用户消息并跑完整个 agent 回合（director 代理）。 */
export function driveTurn(message: string) {
  return Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    yield* plugin.init()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "技法e2e",
      permission: [{ permission: "*", pattern: "*", action: "allow" as const }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "director",
      noReply: true,
      parts: [{ type: "text", text: message }],
    })
    const result = yield* prompt.loop({ sessionID: session.id })
    return { sessionID: session.id, result }
  })
}

type OpenAIRequestBody = {
  messages?: Array<{
    role?: string
    content?: unknown
    tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
  }>
}

/**
 * 从假 LLM 收到的请求体中，收集指定工具名的 assistant 调用（按发生顺序）。
 *
 * 注意：每轮新请求都会重放完整消息历史，同一调用在后续请求体中重复出现，
 * 且假 LLM 的工具调用 id 按回复重置（不同调用可能同为 call_1），
 * 因此按"消息历史内位置"去重——同一会话内历史只增不改，位置即身份。
 * fromHit 用于隔离多个 driveTurn：每个回合新开会话，历史从头开始。
 */
export function toolCallsOf(
  llm: TestLLMServer["Service"],
  name: string,
  fromHit = 0,
): Array<{ arguments: string }> {
  const hits = Effect.runSync(llm.hits).slice(fromHit)
  const seen = new Set<string>()
  const calls: Array<{ arguments: string }> = []
  for (const hit of hits) {
    const body = hit.body as OpenAIRequestBody
    for (const [mi, msg] of (body.messages ?? []).entries()) {
      if (msg.role !== "assistant") continue
      for (const [ci, call] of (msg.tool_calls ?? []).entries()) {
        if (call.function?.name !== name) continue
        const key = `${mi}:${ci}`
        if (seen.has(key)) continue
        seen.add(key)
        calls.push({ arguments: call.function.arguments ?? "" })
      }
    }
  }
  return calls
}

/** 当前已记录的假 LLM 请求数，配合 toolCallsOf 的 fromHit 隔离回合。 */
export function hitCount(llm: TestLLMServer["Service"]): number {
  return Effect.runSync(llm.hits).length
}

/** 全部请求体的序列化文本，用于"含/不含某片段"断言。 */
export function requestTexts(llm: TestLLMServer["Service"]): string[] {
  const hits = Effect.runSync(llm.hits)
  return hits.map((hit) => JSON.stringify(hit.body))
}
/**
 * 找到指定工具首次被调用后、紧随其后的 tool 结果消息内容（序列化字符串）。
 * 用于断言"真实工具执行结果"（如 confirm_techniques 返回的指导段），
 * 而非假 LLM 编造的 tool call 参数。
 */
export function toolResultAfter(llm: TestLLMServer["Service"], name: string, fromHit = 0): string | undefined {
  const hits = Effect.runSync(llm.hits).slice(fromHit)
  for (const hit of hits) {
    const body = hit.body as OpenAIRequestBody
    const messages = body.messages ?? []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      const called = (msg.tool_calls ?? []).some((call) => call.function?.name === name)
      if (!called) continue
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "tool") return JSON.stringify(messages[j].content)
      }
    }
  }
  return undefined
}