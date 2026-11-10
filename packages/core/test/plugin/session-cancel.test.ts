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
import { RetestAuthorization } from "@opennovel-ai/core/plugin/retest-authorization"
import { PluginV2 } from "@opennovel-ai/core/plugin"
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
import { Deferred, Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "../lib/effect"

// 可控 provider：responseStream 首次消费即生效（部分事件后驻留），供测试在真实
// provider turn 进行中触发取消（形状与 session-runner.test.ts 的 client 一致）
const requests: LLMRequest[] = []
let response: LLMEvent[] = []
let responseStream: Stream.Stream<LLMEvent, LLMError> | undefined
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      if (responseStream) {
        const stream = responseStream
        responseStream = undefined
        return stream
      }
      return Stream.fromIterable(response)
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
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
// 真实 coordinator execution：cancel 触发的是真实 drain interrupt 而非假桩
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
  response = []
  responseStream = undefined
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("PluginSession 全真栈取消（任务 2.3）", () => {
  it.effect("执行中取消终止真实 provider 工作并刷出中断帧", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exec = yield* SessionExecution.Service
      const agents = yield* AgentV2.Service
      const registry = yield* ToolRegistry.Service
      // 预检要求目标 agent 存在；预期工具集合取自真实 materialize，保证预检正向通过
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        }),
      )
      const selection = yield* agents.select(AgentV2.ID.make("build"))
      if (selection.info === undefined) return yield* Effect.die("build agent 未就绪")
      const expectedTools = (yield* registry.materialize(selection.info.permissions)).definitions.map(
        (definition) => definition.name,
      )

      // 真实 provider turn 进行中：吐出 stepStart 与 text 片段后驻留，
      // 保证中断时 assistant 草稿已存在（同 session-runner 中断先例的形态）
      const streamed = yield* Deferred.make<void>()
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-cancelled" }),
          LLMEvent.textDelta({ id: "text-cancelled", text: "Partial" }),
        ]),
        Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
      )

      const domain = yield* PluginSession.make({
        sessions: session,
        execution: exec,
        pluginID: "test-plugin",
        // 单位置测试栈：Agent/Registry 服务本就在环境里，预检段直接提供；
        // catalog 替身恒提供一个受支持的默认模型，满足 organize 模型固定段
        // 单位置测试栈：Agent/Registry 服务本就在环境里，预检段直接提供；
        // catalog 替身恒提供一个受支持的默认模型，满足 organize 模型固定段；
        // PluginV2 替身恒 die：用例未传 requiredPlugins，走到插件等待即偏离预期
        withinLocation: (ref, precheck) => {
          const defaultModel = {
            ...ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model")),
            api: { id: "test-model", type: "aisdk", package: "@ai-sdk/anthropic" },
          } as ModelV2.Info
          const catalog = Catalog.Service.of({
            transform: () => Effect.die("测试桩未实现的成员"),
            reload: () => Effect.die("测试桩未实现的成员"),
            provider: { get: () => Effect.succeed(undefined), all: () => Effect.succeed([]), available: () => Effect.succeed([]) },
            model: {
              get: () => Effect.succeed(undefined),
              all: () => Effect.succeed([]),
              available: () => Effect.succeed([defaultModel]),
              default: () => Effect.succeed(defaultModel),
              small: () => Effect.succeed(undefined),
            },
          })
          return Effect.provide(
            precheck,
            Layer.mergeAll(
              Layer.succeed(AgentV2.Service, agents),
              Layer.succeed(ToolRegistry.Service, registry),
              Layer.succeed(Catalog.Service, catalog),
              Layer.succeed(
                PluginV2.Service,
                PluginV2.Service.of({
                  add: () => Effect.die("测试桩未实现的成员"),
                  remove: () => Effect.die("测试桩未实现的成员"),
                  wait: () => Effect.die("测试桩未实现的成员"),
                }),
              ),
            ),
          )
        },
      })
      const issued = RetestAuthorization.issue({
        sessionID: "ses_cancel_origin",
        caseDigest: "digest",
        runs: 2,
        model: { providerID: "test", modelID: "test-model" },
        expectedTools: [...expectedTools],
      })
      const handle = yield* Effect.promise(() =>
        domain.startBackground({
          mode: "retest",
          agent: "build",
          prompt: "复测该问题",
          expectedTools,
          directory: "/project",
          originSessionID: "ses_cancel_origin",
          model: { providerID: "test", modelID: "test-model" },
          authorization: { id: issued.id, caseDigest: issued.caseDigest },
        }),
      )
      // 真实 drain 已开始消费 provider 流
      yield* Deferred.await(streamed)
      expect(requests.length).toBeGreaterThan(0)

      yield* Effect.promise(() => handle.cancel())
      const result = yield* Effect.promise(() => handle.done)
      expect(result).toEqual({ status: "cancelled" })

      // drain 真实落定且 coordinator 不再活动
      const sessionID = SessionSchema.ID.make(handle.id)
      yield* exec.wait(sessionID)
      expect((yield* exec.active).has(sessionID)).toBe(false)
      // provider turn 被真实中断并刷出 assistant 错误帧（同 session-runner 中断语义）
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "复测该问题" },
        { type: "assistant", finish: "error", error: { type: "unknown", message: "Provider turn interrupted" } },
      ])
    }),
  )
})
