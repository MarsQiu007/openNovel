/**
 * 任务 5.3/5.4 核心路径测试（真实栈）：retest 的前置插件有界等待、宿主在临时
 * Location 代持注册 deny-first 复测 agent、白名单精确物化与收尾清理。
 *
 * 会话栈与 session-cancel.test.ts 同款；withinLocation 桩把真实 AgentV2/ToolRegistry
 * 服务接入预检段（注册走真实 State.transform，清理走真实 Scope finalizer），catalog
 * 与 PluginV2 可编程。deny-first 物化精确性由发车预检断言：materialize 后工具名称
 * 集合必须精确等于授权白名单，集合不符即不发车。
 */
import { describe, expect } from "bun:test"
import { LLMClient, LLMError, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opennovel-ai/llm"
import * as OpenAIChat from "@opennovel-ai/llm/protocols/openai-chat"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Catalog } from "@opennovel-ai/core/catalog"
import { Config } from "@opennovel-ai/core/config"
import { ConfigCompaction } from "@opennovel-ai/core/config/compaction"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opennovel-ai/core/effect/app-node-platform"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { RetestAuthorization } from "@opennovel-ai/core/plugin/retest-authorization"
import { Location } from "@opennovel-ai/core/location"
import { ModelV2 } from "@opennovel-ai/core/model"
import { PluginSession } from "@opennovel-ai/core/plugin/session"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { QuestionV2 } from "@opennovel-ai/core/question"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionRunCoordinator } from "@opennovel-ai/core/session/run-coordinator"
import { SessionRunner } from "@opennovel-ai/core/session/runner"
import * as SessionRunnerLLM from "@opennovel-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opennovel-ai/core/session/runner/model"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SessionTitle } from "@opennovel-ai/core/session/title"
import { SessionV2 } from "@opennovel-ai/core/session"
import { Snapshot } from "@opennovel-ai/core/snapshot"
import { ReferenceGuidance } from "@opennovel-ai/core/reference/guidance"
import { SkillGuidance } from "@opennovel-ai/core/skill/guidance"
import { SystemContext } from "@opennovel-ai/core/system-context"
import { SystemContextRegistry } from "@opennovel-ai/core/system-context/registry"
import { ApplicationTools } from "@opennovel-ai/core/tool/application-tools"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { Tool } from "@opennovel-ai/core/tool/tool"
import { Deferred, Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "../lib/effect"

const RETEST_AGENT_ID = "insight-retester"
const ORIGIN_SESSION = "ses_retest_origin"

// 可控 provider：默认返回一次完整成功 turn（文本 + finish），不发工具调用
const requests: LLMRequest[] = []
let response: LLMEvent[] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(response)
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "test-model", provider: "test", route: OpenAIChat.route })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const systemContextKey = SystemContext.Key.make("test/context")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.succeed(
          SystemContext.combine([
            SystemContext.make({
              key: systemContextKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("Initial context"),
              baseline: String,
              update: (_previous, current) => current,
              removed: () => "System context source removed: test/context",
            }),
          ]),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)
const titleFake = Layer.succeed(
  SessionTitle.Service,
  SessionTitle.Service.of({ ensure: () => Effect.void }),
)

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SessionTitle.node, titleFake],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      wait: coordinator.wait,
    })
  }),
).pipe(Layer.provide(runnerLayer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SessionTitle.node, titleFake],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  response = [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "text-retest" }),
    LLMEvent.textDelta({ id: "text-retest", text: "复测完成" }),
    LLMEvent.textEnd({ id: "text-retest" }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  ]
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)

  // 预检的 deny-first 物化断言需要非空注册表（内置工具由宿主启动注册，本栈没有）：
  // 注册两个假应用工具，白名单才能取全量注册集的严格子集。State.transform 是作用域化
  // 注册——必须挂到测试体自己的 scope（Effect.scoped 会当场关闭并撤销登记）
  const applications = yield* ApplicationTools.Service
  const fake = Tool.make({
    description: "复测假工具",
    input: Schema.Struct({}),
    output: Schema.Struct({ ok: Schema.Boolean }),
    execute: () => Effect.succeed({ ok: true }),
  })
  yield* applications.register({ retest_alpha: fake, retest_beta: fake })
})

const stubModel = {
  ...ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model")),
  api: { id: "test-model", type: "aisdk", package: "@ai-sdk/anthropic" },
} as ModelV2.Info

/**
 * withinLocation 桩：agent 与工具注册表用环境真实服务（注册与清理走真实
 * State.transform 与 Scope finalizer）；catalog 可编程（默认提供受支持的
 * test-model）；PluginV2.wait 按模式可控。
 */
const withinLocationStub = (
  deps: { agents: AgentV2.Service["Service"]; registry: ToolRegistry.Service["Service"] },
  over: { plugins?: "resolve" | "fail" | "never"; available?: readonly ModelV2.Info[] } = {},
) => {
  const available = over.available ?? [stubModel]
  const catalog = Catalog.Service.of({
    transform: () => Effect.die("测试桩未实现的成员"),
    reload: () => Effect.die("测试桩未实现的成员"),
    provider: { get: () => Effect.succeed(undefined), all: () => Effect.succeed([]), available: () => Effect.succeed([]) },
    model: {
      get: () => Effect.succeed(undefined),
      all: () => Effect.succeed([]),
      available: () => Effect.succeed([...available]),
      default: () => Effect.succeed(stubModel),
      small: () => Effect.succeed(undefined),
    },
  })
  const plugins = Layer.succeed(
    PluginV2.Service,
    PluginV2.Service.of({
      add: () => Effect.die("测试桩未实现的成员"),
      remove: () => Effect.die("测试桩未实现的成员"),
      wait: () =>
        over.plugins === "fail"
          ? Effect.die(new Error("插件装载失败"))
          : over.plugins === "never"
            ? Effect.never
            : Effect.void,
    }),
  )
  return <A>(
    ref: Location.Ref,
    precheck: Effect.Effect<A, Error, AgentV2.Service | ToolRegistry.Service | Catalog.Service | PluginV2.Service>,
  ): Effect.Effect<A, unknown> =>
    Effect.provide(
      precheck,
      Layer.mergeAll(Layer.succeed(AgentV2.Service, deps.agents), Layer.succeed(ToolRegistry.Service, deps.registry), Layer.succeed(Catalog.Service, catalog), plugins),
    )
}

const retestAuthorization = (expectedTools: readonly string[]) => {
  const issued = RetestAuthorization.issue({
    sessionID: ORIGIN_SESSION,
    caseDigest: "digest",
    runs: 1,
    model: { providerID: "test", modelID: "test-model" },
    expectedTools,
  })
  return { id: issued.id, caseDigest: issued.caseDigest }
}

const retestStartInput = (expectedTools: readonly string[], over?: { agent?: string; plugins?: "resolve" | "fail" | "never" }) => ({
  mode: "retest" as const,
  agent: over?.agent ?? RETEST_AGENT_ID,
  prompt: "按固定步骤调用白名单工具",
  expectedTools,
  directory: "/project",
  originSessionID: ORIGIN_SESSION,
  model: { providerID: "test", modelID: "test-model" },
  authorization: retestAuthorization(expectedTools),
  retestAgent: { id: RETEST_AGENT_ID, description: "内部复测执行 agent", system: "严格按步骤执行" },
  ...(over?.plugins === undefined ? {} : { requiredPlugins: ["config-plugin"] }),
})

describe("PluginSession retest 隔离作用域（任务 5.3/5.4）", () => {
  it.effect("前置插件激活后代持注册 deny-first agent：单工具白名单精确物化，收尾清理", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      // 白名单取真实注册表的单个工具：deny-first 物化后必须精确等于它（≠全量）
      const probe = AgentV2.Info.empty(AgentV2.ID.make("probe"))
      const allTools = (yield* registry.materialize(probe.permissions)).definitions.map((definition) => definition.name)
      const whitelist = [allTools[0] as string]

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        withinLocation: withinLocationStub({ agents, registry }, { plugins: "resolve" }),
      })
      const handle = yield* Effect.promise(() => domain.startBackground(retestStartInput(whitelist)))
      const result = yield* Effect.promise(() => handle.done)
      expect(result).toEqual({ status: "success", text: "复测完成" })
      expect(requests.length).toBe(1)

      // 作用域收尾：代持注册的复测 agent 已被 finalizer 移除
      expect((yield* agents.select(AgentV2.ID.make(RETEST_AGENT_ID))).info).toBeUndefined()
      // get 回填持久化 Session 行的规范 stored.location
      const ref = yield* Effect.promise(() => domain.get(handle.id))
      expect(ref?.location).toBe("/project")
    }),
  )

  it.effect("两个不同白名单各自精确物化：权限按当次授权构造，不固化（任务 5.4）", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      const probe = AgentV2.Info.empty(AgentV2.ID.make("probe"))
      const allTools = (yield* registry.materialize(probe.permissions)).definitions.map((definition) => definition.name)
      const whitelistA = [allTools[0] as string]
      const whitelistB = [allTools[0] as string, allTools[1] as string]

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        withinLocation: withinLocationStub({ agents, registry }, { plugins: "resolve" }),
      })
      const first = yield* Effect.promise(() => domain.startBackground(retestStartInput(whitelistA)))
      expect(yield* Effect.promise(() => first.done)).toEqual({ status: "success", text: "复测完成" })
      const second = yield* Effect.promise(() => domain.startBackground(retestStartInput(whitelistB)))
      expect(yield* Effect.promise(() => second.done)).toEqual({ status: "success", text: "复测完成" })
      // 两次发车各自恰好一次 provider turn；第二次若沿用第一次权限（权限固化），
      // 预检的精确集合断言会拒绝发车
      expect(requests.length).toBe(2)
      expect((yield* agents.select(AgentV2.ID.make(RETEST_AGENT_ID))).info).toBeUndefined()
    }),
  )

  it.effect("未知 agent 在 prompt 前失败关闭：不发车不建会话", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      const probe = AgentV2.Info.empty(AgentV2.ID.make("probe"))
      const whitelist = [(yield* registry.materialize(probe.permissions)).definitions[0]?.name ?? "read"]

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        withinLocation: withinLocationStub({ agents, registry }, { plugins: "resolve" }),
      })
      // 注册的是 insight-retester，但 input.agent 指向不存在的 ghost：预检失败落 done
      // （fork 后的生命周期失败经 resultFromExit 落 done，不走 Promise 拒绝）
      const handle = yield* Effect.promise(() =>
        domain.startBackground(retestStartInput([whitelist[0] as string], { agent: "ghost" })),
      )
      const result = yield* Effect.promise(() => handle.done)
      expect(result.status).toBe("failure")
      if (result.status === "failure") expect(result.reason).toContain("后台会话 agent 不存在: ghost")
      expect(requests.length).toBe(0)
      expect((yield* agents.select(AgentV2.ID.make(RETEST_AGENT_ID))).info).toBeUndefined()
    }),
  )

  it.effect("复测固定模型不在可用集：发车前失败关闭，不静默回退（任务 5.4）", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      const probe = AgentV2.Info.empty(AgentV2.ID.make("probe"))
      const whitelist = [(yield* registry.materialize(probe.permissions)).definitions[0]?.name ?? "read"]

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        // 目录里可用的是另一个模型：固定模型 test-model 解析不一致，拒绝发车
        withinLocation: withinLocationStub(
          { agents, registry },
          { plugins: "resolve", available: [{ ...stubModel, id: ModelV2.ID.make("other-model") }] },
        ),
      })
      const handle = yield* Effect.promise(() => domain.startBackground(retestStartInput([whitelist[0] as string])))
      const result = yield* Effect.promise(() => handle.done)
      expect(result.status).toBe("failure")
      if (result.status === "failure") expect(result.reason).toContain("发车前模型解析与固定值不一致")
      expect(requests.length).toBe(0)
    }),
  )

  it.live("前置插件有界等待超时不发车（任务 5.3：无固定 sleep，事件驱动）", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      const probe = AgentV2.Info.empty(AgentV2.ID.make("probe"))
      const whitelist = [(yield* registry.materialize(probe.permissions)).definitions[0]?.name ?? "read"]

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        // 真实时钟注入短期限：wait 永不落定，超时即失败关闭
        retestPluginWaitTimeout: "30 millis",
        withinLocation: withinLocationStub({ agents, registry }, { plugins: "never" }),
      })
      const handle = yield* Effect.promise(() => domain.startBackground(retestStartInput([whitelist[0] as string], { plugins: "never" })))
      const result = yield* Effect.promise(() => handle.done)
      expect(result.status).toBe("failure")
      if (result.status === "failure") expect(result.reason).toContain("复测前置插件未激活: config-plugin")
      expect(requests.length).toBe(0)
    }),
  )

  it.effect("前置插件装载失败不发车：失败关闭并清理（任务 5.3）", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      const probe = AgentV2.Info.empty(AgentV2.ID.make("probe"))
      const whitelist = [(yield* registry.materialize(probe.permissions)).definitions[0]?.name ?? "read"]

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        withinLocation: withinLocationStub({ agents, registry }, { plugins: "fail" }),
      })
      // wait 以 defect 表达装载失败（接口无错误通道）：die 不走 Promise 拒绝，经 resultFromExit 落为 failure
      const handle = yield* Effect.promise(() => domain.startBackground(retestStartInput([whitelist[0] as string], { plugins: "fail" })))
      const result = yield* Effect.promise(() => handle.done)
      expect(result.status).toBe("failure")
      if (result.status === "failure") expect(result.reason).toContain("插件装载失败")
      expect(requests.length).toBe(0)
      expect((yield* agents.select(AgentV2.ID.make(RETEST_AGENT_ID))).info).toBeUndefined()
    }),
  )
})
