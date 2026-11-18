/**
 * 压缩全生命周期 server 组合层 e2e（session-context-compaction 6.1）：真 Database 持久化 +
 * SessionV2 durable admission + SessionExecutionLocal drain + TestLLMServer 假端点，用中文
 * 长会话取证阈值前自动压缩、手动受理去重、失败重试与 DashScope 溢出兜底，断言固化。
 *
 * 组合镜像 novel-writer-e2e/harness.ts（去掉 novel-writer 插件）与生产 server.ts：
 * 全局节点 = Database/EventV2/SessionProjector/SessionStore/SessionV2 + TestLLMServer，
 * SessionExecution 绑进程本地实现；LocationServiceMap 由 AppNodeBuilder 自动构建。
 * 阈值判定是请求估算（4 字符/token 的 JSON 粗估）：中文按 UTF-16 length 计入，因此
 * 小窗口（context=2000）+ 显式 buffer/keep 把触发线压到可由字数确定性跨过的位置。
 */
import { expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { SessionMessage } from "@opennovel-ai/schema/session-message"
import { ConfigV1 } from "@opennovel-ai/core/config/v1/config"
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
import { provideTmpdirServer, requireInstance } from "../fixture/fixture"
import { Reply, TestLLMServer } from "../lib/llm-server"
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

/**
 * 压缩 e2e 的实例配置：test-model + 显式压缩域数值。
 * 阈值判定是请求估算（4 字符/token 的 JSON 粗估），判定量含 system prompt、工具定义与
 * SystemContext baseline（随环境漂移，实测约 21k 字符 ≈ 5300 tokens）。窗口 40000、
 * reserved 6000 → trigger 34000：第 1 轮估算 ~15300 不触发，第 2 轮 ~35600 触发。
 * plan 还要求摘要 prompt 本身不超窗（head 全量 + 模板 ≈ 32000 < 40000-100），keep 极小
 * 让 recent 为空、head 取全部对话正好压线；S 漂移 ±10k 字符两侧余量仍稳。
 * background 固定关闭，避免后台候选的摘要请求污染计数；手动路径用例再关 auto。
 */
function compactionCfg(
  url: string,
  compaction: { reserved: number; keep: number; context?: number; auto?: boolean; background?: boolean },
): Partial<ConfigV1.Info> {
  const model = {
    id: "test-model",
    name: "Test Model",
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: compaction.context ?? 40000, output: 100 },
    cost: { input: 0, output: 0 },
    options: {},
  } as ConfigModel
  return {
    model: "test/test-model",
    small_model: "test/test-model",
    // V1 键名经 migrate 映射：reserved → core buffer（触发余量），preserve_recent_tokens → keep.tokens
    compaction: {
      auto: compaction.auto ?? true,
      background: compaction.background ?? false,
      reserved: compaction.reserved,
      preserve_recent_tokens: compaction.keep,
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

/** 摘要请求特征：summaryPrompt 固定开头（compaction.ts promptFor），同时覆盖新建与更新两种措辞 */
const isSummaryRequest = (hit: { body: Record<string, unknown> }) => bodyText(hit).includes("anchored summary")

/** 命中模板结构校验（至少一个 ## 章节标题）的中文摘要回复 */
const SUMMARY_REPLY = [
  "## Objective",
  "- 追查江堤密信疑案",
  "",
  "## Important Details",
  "- 密信数字三七九四指向城外盐仓",
  "",
  "## Work State",
  "### Completed",
  "- 已勘察江堤现场并取得布条",
  "",
  "### Active",
  "- 前往盐仓核对账册",
  "",
  "### Blocked",
  "- (none)",
  "",
  "## Next Move",
  "1. 检查盐仓账册",
  "2. (none)",
  "",
  "## Relevant Files",
  "- (none)",
].join("\n")

const repeat = (unit: string, count: number) => Array.from({ length: count }, () => unit).join("")

const openSession = Effect.gen(function* () {
  const instance = yield* requireInstance
  const sessions = yield* SessionV2.Service
  const session = yield* sessions.create({
    title: "压缩e2e",
    agent: AgentV2.ID.make("build"),
    location: Location.Ref.make({ directory: AbsolutePath.make(instance.directory) }),
  })
  return session.id
})

const compactionsOf = (messages: SessionMessage.Message[]) =>
  messages.filter((message): message is Extract<SessionMessage.Message, { type: "compaction" }> => message.type === "compaction")

it.live(
  "中文长会话达到阈值自动压缩并继续原始回合",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const sessions = yield* SessionV2.Service
        const sessionID = yield* openSession
        // 第 1 轮输入 ~40k 字符 ≈ 10000 tokens：低于 trigger 25000，不压缩
        const user1 = repeat("探员沿江堤排查旧年密信线索，", 3080)
        const reply1 = repeat("密信中的数字与盐仓账册暗合，", 60)
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("江堤排查"),
          new Reply().text(reply1).usage({ input: 900, output: 60 }).stop().item(),
        )
        yield* llm.pushMatch(
          isSummaryRequest,
          new Reply().text(SUMMARY_REPLY).stop().item(),
        )
        // 第 2 轮输入 ~80k 字符 ≈ 20000 tokens：把请求估算推过 trigger，触发自动压缩
        const user2 = repeat("决定连夜出城前往盐仓，", 7300)
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("连夜出城"),
          new Reply().text("盐仓账册已核实。").usage({ input: 400, output: 20 }).stop().item(),
        )

        yield* sessions.prompt({ sessionID, prompt: { text: user1 } })
        yield* sessions.wait(sessionID)
        const first = yield* sessions.messages({ sessionID, order: "asc" })
        expect(compactionsOf(first)).toHaveLength(0)

        yield* sessions.prompt({ sessionID, prompt: { text: user2 } })
        yield* sessions.wait(sessionID)
        const second = yield* sessions.messages({ sessionID, order: "asc" })
        const compactions = compactionsOf(second)
        expect(compactions).toHaveLength(1)
        const compaction = compactions[0]
        expect(compaction.status).toBe("completed")
        expect(compaction.summary).toContain("## Objective")
        expect(second.findLast((message) => message.type === "assistant")?.type).toBe("assistant")

        const hits = yield* llm.hits
        const summaryHits = hits.filter(isSummaryRequest)
        expect(summaryHits).toHaveLength(1)
        expect(bodyText(summaryHits[0])).toContain("江堤排查")
      }),
      { config: (url) => compactionCfg(url, { reserved: 6000, keep: 100 }) },
    ),
  120_000,
)

it.live(
  "手动压缩受理排队且活跃操作去重",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const sessions = yield* SessionV2.Service
        const sessionID = yield* openSession
        const user1 = repeat("探员整理盐仓线索册页，", 40)
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("盐仓线索"),
          new Reply().text("线索册已整理。").usage({ input: 700, output: 30 }).stop().item(),
        )
        yield* sessions.prompt({ sessionID, prompt: { text: user1 } })
        yield* sessions.wait(sessionID)

        const latch = yield* Deferred.make<void>()
        yield* llm.pushMatch(
          isSummaryRequest,
          new Reply().wait(Effect.runPromise(Deferred.await(latch))).text(SUMMARY_REPLY).stop().item(),
        )

        const first = yield* sessions.compact({ sessionID })
        expect(first.status).toBe("queued")
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const messages = yield* sessions.messages({ sessionID, order: "asc" })
            const running = compactionsOf(messages).some((message) => message.status === "running")
            return running ? (true as const) : undefined
          }),
          "compaction never started running",
          "30 seconds",
        )

        const second = yield* sessions.compact({ sessionID })
        expect(second.status).toBe("running")
        expect(second.messageID).toBe(first.messageID)

        yield* Deferred.succeed(latch, void 0)
        yield* sessions.wait(sessionID)
        const messages = yield* sessions.messages({ sessionID, order: "asc" })
        const compactions = compactionsOf(messages)
        expect(compactions).toHaveLength(1)
        expect(compactions[0].status).toBe("completed")

        const hits = yield* llm.hits
        expect(hits.filter(isSummaryRequest)).toHaveLength(1)
      }),
      { config: (url) => compactionCfg(url, { reserved: 6000, keep: 100, auto: false }) },
    ),
  120_000,
)

it.live(
  "压缩失败可读且手动重试成功",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const sessions = yield* SessionV2.Service
        const sessionID = yield* openSession
        const user1 = repeat("探员核对盐仓出货记录，", 40)
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("出货记录"),
          new Reply().text("出货记录核对完毕。").usage({ input: 700, output: 30 }).stop().item(),
        )
        yield* sessions.prompt({ sessionID, prompt: { text: user1 } })
        yield* sessions.wait(sessionID)

        // 400 落 InvalidRequestReason（无溢出词表命中）不进入 executor 的 5xx 重试阶梯；
        // 500 会被 maxRetries=10 重试，重试请求落 auto "ok" 会污染失败路径取证
        yield* llm.pushMatch(isSummaryRequest, { type: "http-error", status: 400, body: { error: { message: "upstream exploded" } } })
        const admission = yield* sessions.compact({ sessionID })
        expect(admission.status).toBe("queued")
        yield* sessions.wait(sessionID)
        const failed = compactionsOf(yield* sessions.messages({ sessionID, order: "asc" }))
        expect(failed).toHaveLength(1)
        expect(failed[0].status).toBe("failed")
        // 失败错误脱敏：仅固定中文文案，不透传响应体、密钥或内部字段
        const failureText = JSON.stringify(failed[0].error ?? {})
        expect(failureText).toContain("摘要")
        expect(failureText).not.toContain("upstream")
        expect(failureText).not.toContain("e2e-secret-key")

        yield* llm.pushMatch(isSummaryRequest, new Reply().text(SUMMARY_REPLY).stop().item())
        const retry = yield* sessions.compact({ sessionID })
        expect(retry.status).toBe("queued")
        expect(retry.messageID).not.toBe(admission.messageID)
        yield* sessions.wait(sessionID)
        const messages = yield* sessions.messages({ sessionID, order: "asc" })
        const compactions = compactionsOf(messages)
        expect(compactions.map((message) => message.status)).toEqual(["failed", "completed"])
      }),
      { config: (url) => compactionCfg(url, { reserved: 6000, keep: 100, auto: false }) },
    ),
  120_000,
)

it.live(
  "provider 上下文溢出触发前台压缩兜底并继续原始回合",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const sessions = yield* SessionV2.Service
        const sessionID = yield* openSession
        const user1 = repeat("探员梳理盐仓银钱往来，", 30)
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("银钱往来"),
          new Reply().text("往来账目梳理完成。").usage({ input: 500, output: 30 }).stop().item(),
        )
        yield* sessions.prompt({ sessionID, prompt: { text: user1 } })
        yield* sessions.wait(sessionID)
        expect(compactionsOf(yield* sessions.messages({ sessionID, order: "asc" }))).toHaveLength(0)

        // DashScope 溢出形状（provider-error 词表 "Range of input length should be"）
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("夜探盐仓"),
          { type: "http-error", status: 400, body: { code: "InvalidParameter", message: "Range of input length should be [1, 129024]" } },
        )
        yield* llm.pushMatch(isSummaryRequest, new Reply().text(SUMMARY_REPLY).stop().item())
        yield* llm.pushMatch(
          (hit) => !isSummaryRequest(hit) && bodyText(hit).includes("夜探盐仓"),
          new Reply().text("夜探盐仓收获颇丰。").usage({ input: 300, output: 20 }).stop().item(),
        )
        yield* sessions.prompt({ sessionID, prompt: { text: repeat("趁夜色掩护夜探盐仓，", 12) } })
        yield* sessions.wait(sessionID)

        const messages = yield* sessions.messages({ sessionID, order: "asc" })
        const compactions = compactionsOf(messages)
        expect(compactions).toHaveLength(1)
        expect(compactions[0].status).toBe("completed")
        expect(messages.findLast((message) => message.type === "assistant")?.type).toBe("assistant")

        const hits = yield* llm.hits
        // 兜底链路可观测结果：摘要 1 次；含「夜探盐仓」的非摘要请求 = 被拒的原始请求 + 压缩后重发，各 1 次
        expect(hits.filter(isSummaryRequest)).toHaveLength(1)
        expect(hits.filter((hit) => !isSummaryRequest(hit) && bodyText(hit).includes("夜探盐仓"))).toHaveLength(2)
      }),
      { config: (url) => compactionCfg(url, { reserved: 6000, keep: 100 }) },
    ),
  120_000,
)
