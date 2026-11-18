/**
 * 进程重启不自动重放（session-context-compaction 6.1 第 5 取证点）。
 * 同一主层在共享 DB 文件上构建两个「进程」scope：scope1 手动压缩停在 running
 * （摘要请求 hang、scope 不关闭、不写终态），scope2 构建并触发同 location 的
 * 服务层 —— SessionCompactionRecovery.settle 把遗留 running 结算为
 * interrupted(restart)，且不向 provider 重放任何请求（共享假端点的 calls 不增）。
 *
 * 假端点独立于两个 scope 先行构建：scope 间的 provider 配置都指向它，
 * calls 计数是「重启后是否重放」的唯一观测点；两个 scope 各自用独立 memoMap，
 * 保证 Database/Session 层不共享实例、只有 SQLite 文件（WAL 两连接）是共享面。
 */
import { expect, test } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { join } from "path"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { ConfigV1 } from "@opennovel-ai/core/config/v1/config"
import { CrossSpawnSpawner } from "@opennovel-ai/core/cross-spawn-spawner"
import { Database } from "@opennovel-ai/core/database/database"
import { EventV2 } from "@opennovel-ai/core/event"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opennovel-ai/core/effect/app-node"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Location } from "@opennovel-ai/core/location"
import { buildLocationServiceMap, LocationServiceMap } from "@opennovel-ai/core/location-services"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionExecutionLocal } from "@opennovel-ai/core/session/execution/local"
import { SessionMessage } from "@opennovel-ai/schema/session-message"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { provideInstance, requireInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout } from "../lib/effect"
import { Reply, TestLLMServer } from "../lib/llm-server"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

/**
 * 同一 SQLite 文件上构建独立「进程」层。Database 用显式文件路径替换节点：
 * preload 在任何 src/ import 前把 Flag.OPENNOVEL_DB 冻结为 ":memory:"（flag.ts 模块级快照，
 * 测试体内改 process.env 无效），走默认节点两个 scope 各拿独立内存库，重启侧读不到
 * scope1 的 session。替换同时传进 LocationServiceMap，让遗留结算用的 location 服务层
 * 也落在同一文件上。
 */
function buildMainLayer(dbFile: string) {
  const replacements = [
    [ProjectV2.node, projects],
    [SessionExecution.node, SessionExecutionLocal.node],
    [Database.node, Database.layerFromPath(dbFile)],
  ] as LayerNode.Replacements
  const locationServiceMapNode = makeGlobalNode({
    service: LocationServiceMap.Service,
    layer: buildLocationServiceMap(replacements),
    deps: [],
  })
  return AppNodeBuilder.build(
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
  )
}

type ConfigModel = NonNullable<NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]>["models"]>[string]

/** auto 关闭：普通对话轮不触发自动压缩，遗留 running 只能来自手动压缩。 */
function compactionCfg(url: string): Partial<ConfigV1.Info> {
  const model = {
    id: "test-model",
    name: "Test Model",
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: 40000, output: 100 },
    cost: { input: 0, output: 0 },
    options: {},
  } as ConfigModel
  return {
    model: "test/test-model",
    small_model: "test/test-model",
    compaction: {
      auto: false,
      background: false,
      reserved: 6000,
      preserve_recent_tokens: 100,
    },
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: { "test-model": model },
        options: { apiKey: "e2e-secret-key", baseURL: url },
      },
    },
  }
}

const bodyText = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body)
const isSummaryRequest = (hit: { body: Record<string, unknown> }) => bodyText(hit).includes("anchored summary")

const compactionsOf = (messages: SessionMessage.Message[]) =>
  messages.filter((message): message is Extract<SessionMessage.Message, { type: "compaction" }> => message.type === "compaction")

test(
  "进程重启后遗留压缩操作结算为 interrupted 且不自动重放",
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        // 独立假端点先行构建：两个 scope 的 provider 都指向它，calls 是重放观测点
        const serverScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(serverScope, Exit.void))
        const serverCtx = yield* Layer.buildWithMemoMap(TestLLMServer.layer, Layer.makeMemoMapUnsafe(), serverScope)
        const url = yield* Effect.gen(function* () {
          return (yield* TestLLMServer).url
        }).pipe(Effect.provide(serverCtx))
        const llmCalls = Effect.gen(function* () {
          return yield* (yield* TestLLMServer).calls
        }).pipe(Effect.provide(serverCtx))
        // 共享实例的受控入口：scope 内裸 yield* TestLLMServer 拿到的是 ctx 内置实例，
        // 队列项会推错 server —— 全部桩操作必须显式走共享端点
        const sharedLlm = Effect.gen(function* () {
          return yield* TestLLMServer
        }).pipe(Effect.provide(serverCtx))

        // 共享 SQLite 文件路径：两个「进程」scope 的 Database 层都指向它
        const dir = yield* tmpdirScoped({ config: compactionCfg(url) }).pipe(
          Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)),
        )
        const dbFile = join(dir, "opennovel.db")

        // scope1：正常一轮 + 手动压缩停在 running（摘要请求 hang、scope 不关闭）
        const scope1 = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope1, Exit.void))
        const ctx1 = yield* Layer.buildWithMemoMap(buildMainLayer(dbFile), Layer.makeMemoMapUnsafe(), scope1)

        const sessionID = yield* Effect.gen(function* () {
          const instance = yield* requireInstance
          const sessions = yield* SessionV2.Service
          const session = yield* sessions.create({
            title: "压缩重启e2e",
            agent: AgentV2.ID.make("build"),
            location: Location.Ref.make({ directory: AbsolutePath.make(instance.directory) }),
          })
          yield* (yield* sharedLlm).pushMatch(
            (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("盐仓线索"),
            new Reply().text("线索册已整理。").usage({ input: 700, output: 30 }).stop().item(),
          )
          // 文本长度 > keep 预算（100 tokens ≈ 400 chars）：保证 head 非空、压缩计划可行
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "探员整理盐仓线索册页。".repeat(40) } })
          yield* sessions.wait(session.id)
          yield* (yield* sharedLlm).pushMatch(
            isSummaryRequest,
            // 摘要永挂：drain 停在 running，compaction part 不写终态
            new Reply().wait(new Promise<never>(() => {})).text("").stop().item(),
          )
          const admission = yield* sessions.compact({ sessionID: session.id })
          expect(admission.status).toBe("queued")
          yield* pollWithTimeout(
            Effect.gen(function* () {
              const messages = yield* sessions.messages({ sessionID: session.id, order: "asc" })
              return compactionsOf(messages).some((message) => message.status === "running") ? (true as const) : undefined
            }),
            "compaction never started running",
            "30 seconds",
          )
          return session.id
        }).pipe(provideInstance(dir), Effect.provide(testInstanceStoreLayer), Effect.provide(ctx1))

        // running 状态先于摘要请求落库：等摘要请求真正到达假端点再记录基线，
        // 否则重启侧读 calls 会把它误算成「重放」
        yield* pollWithTimeout(
          Effect.gen(function* () {
            return (yield* llmCalls) >= 2 ? (true as const) : undefined
          }),
          "summary request never arrived at the fake endpoint",
          "30 seconds",
        )
        const callsAtRunning = yield* llmCalls

        // scope2：同 DB 文件的新「进程」；触发同 location 服务层即执行遗留结算
        const scope2 = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope2, Exit.void))
        const ctx2 = yield* Layer.buildWithMemoMap(buildMainLayer(dbFile), Layer.makeMemoMapUnsafe(), scope2)

        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const maps = yield* LocationServiceMap.Service
          const stored = yield* sessions.get(sessionID)
          yield* Effect.void.pipe(Effect.provide(maps.get(stored.location)))
          const messages = yield* sessions.messages({ sessionID, order: "asc" })
          const compactions = compactionsOf(messages)
          expect(compactions).toHaveLength(1)
          expect(compactions[0].status).toBe("interrupted")
          expect(compactions[0].cause).toBe("restart")
        }).pipe(Effect.provide(ctx2))

        // 无 provider 重放：重启侧没有发出任何请求
        expect(yield* llmCalls).toBe(callsAtRunning)
      }).pipe(Effect.scoped),
    )
  },
  120_000,
)
