/**
 * 技法 agent 流程 e2e 驱动器（V2）：SessionV2 durable admission + SessionExecution
 * 进程本地 drain + TestLLMServer 假端点。
 *
 * 组合镜像 core 测试范式（session-create.test.ts）与生产 server.ts：
 * 全局节点 = Database/EventV2/SessionProjector/SessionStore/SessionV2 + TestLLMServer，
 * SessionExecution 绑进程本地实现；LocationServiceMap 由 AppNodeBuilder 自动构建
 * （buildLocationServiceMap，per-tmpdir location 服务：Config/AgentV2/PluginV2/
 * ToolRegistry/SessionRunnerModel 等，hoist 的 global 节点经共享 memoMap 与根层同实例）。
 * novel-writer V2 插件经 providerCfg 写入的项目级 plugins 配置加载（同
 * `opennovel novel init` 的 wireNovelWriterV2 接线），director 等写作 agent
 * 与 88 工具全部由它注册。
 * provider 配置参照 httpapi-exercise 的 fakeLlmConfig：@ai-sdk/openai-compatible 指向假端点。
 */
import { ConfigV1 } from "@opennovel-ai/core/v1/config/config"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opennovel-ai/core/effect/app-node"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { CrossSpawnSpawner } from "@opennovel-ai/core/cross-spawn-spawner"
import { Database } from "@opennovel-ai/core/database/database"
import { EventV2 } from "@opennovel-ai/core/event"
import { Location } from "@opennovel-ai/core/location"
import { buildLocationServiceMap, LocationServiceMap } from "@opennovel-ai/core/location-services"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionExecutionLocal } from "@opennovel-ai/core/session/execution/local"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { requireInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const replacements = [
  [ProjectV2.node, projects],
  [SessionExecution.node, SessionExecutionLocal.node],
] as LayerNode.Replacements

// 显式构建 LSM 并同时入组+绑定（同 AppNodeBuilder 自动路径的结构，replacements
// 同样透传进 per-location 构建）：入组让编译产物类型携带 LocationServiceMap.Service，
// 绑定满足 SessionV2 的 unbound 依赖
const locationServiceMapNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: buildLocationServiceMap(replacements),
  deps: [],
})

export const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      CrossSpawnSpawner.node,
      testLLMServerNode,
      locationServiceMapNode,
    ]),
    [...replacements, [LocationServiceMap.node, locationServiceMapNode]],
  ),
)

type ConfigModel = NonNullable<NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]>["models"]>[string]

/** 实例 provider 配置：test/test-model 指向 TestLLMServer 假端点（同 httpapi-exercise fakeLlmConfig）。 */
export function providerCfg(
  url: string,
): Partial<ConfigV1.Info> & { plugins: string[]; experimental: { subagent_depth: number } } {
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
    // novel-writer V2 接线（镜像 wireNovelWriterV2）：插件入口 + subagent 深度
    plugins: ["@opennovel-ai/plugin/novel-writer-v2"],
    experimental: { subagent_depth: 2 },
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

/**
 * 发一条用户消息并等 V2 drain 落定（director 代理，每回合新开会话）。
 * 返回末尾 assistant 消息；drain 失败时 result 为 undefined（wait 不传播 drain 错误，
 * 失败信号靠后续工具调用断言与运行日志定位）。
 */
export function driveTurn(message: string) {
  return Effect.gen(function* () {
    const instance = yield* requireInstance
    const sessions = yield* SessionV2.Service
    const maps = yield* LocationServiceMap.Service
    const session = yield* sessions.create({
      title: "技法e2e",
      agent: AgentV2.ID.make("director"),
      location: Location.Ref.make({ directory: AbsolutePath.make(instance.directory) }),
    })
    // 轮询必须复用会话行重建的 location（fromRow 恒带 workspaceID 显式键）——
    // 自建 Ref 形状不同会被 LayerMap 建成另一份互不可见的 location 服务（§11-10）。
    const stored = yield* sessions.get(session.id)
    // 外部插件（config-plugin fork 装载 novel-writer-v2）的 agent transform 会
    // 登记进已完成的外层 State.batch 的 reload 集合——无人触发即永不 materialize
    // （design §11-16/18，server 端以 wait+reload 手动收口）。每轮轮询强制 reload
    // 重建状态，等写作 agent 家族落进该 location 的 AgentV2 再发车。
    yield* pollWithTimeout(
      Effect.gen(function* () {
        const agents = yield* AgentV2.Service
        yield* agents.reload()
        const registered = new Set((yield* agents.all()).map((agent) => agent.id))
        return ["director", "pipeline", "writer", "auditor"].every((id) => registered.has(AgentV2.ID.make(id)))
          ? (true as const)
          : undefined
      }).pipe(Effect.provide(maps.get(stored.location))),
      "writing agents never materialized",
      "30 seconds",
    )
    yield* sessions.prompt({ sessionID: session.id, prompt: { text: message } })
    yield* sessions.wait(session.id)
    const messages = yield* sessions.messages({ sessionID: session.id })
    return { sessionID: session.id, result: messages.findLast((item) => item.type === "assistant") }
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
