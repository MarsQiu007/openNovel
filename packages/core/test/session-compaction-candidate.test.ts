import { expect } from "bun:test"
import { DateTime, Effect, Fiber, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LLM, LLMError, LLMEvent, Message, Model, type LLMRequest } from "@opennovel-ai/llm"
import * as OpenAIChat from "@opennovel-ai/llm/protocols/openai-chat"
import { Config } from "@opennovel-ai/core/config"
import { ConfigCompaction } from "@opennovel-ai/core/config/compaction"
import { ModelV2 } from "@opennovel-ai/core/model"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import type { EventV2 } from "@opennovel-ai/core/event"
import { SessionCompaction } from "@opennovel-ai/core/session/compaction"
import { SessionCompactionCandidate } from "@opennovel-ai/core/session/compaction-candidate"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { it } from "./lib/effect"

// 窗口 50k / output 4k / 固定预留 20k → trigger = 30k，启动线 = 30k - min(60k, 15k) = 15k
const candidateModel = Model.make({
  id: "ladder",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 50_000, output: 4_096 } }),
})

const modelRef = ModelV2.Ref.make({
  id: ModelV2.ID.make("ladder"),
  providerID: ProviderV2.ID.make("fake"),
})

const AGENT = "writer"
const sessionID = SessionSchema.ID.make("ses_bg_candidate")
const SUMMARY_GOOD = "## Objective\n- Ship the fix"

const config = (background = true) => [
  new Config.Document({
    type: "document",
    info: new Config.Info({
      compaction: new ConfigCompaction.Info({
        auto: true,
        background,
        buffer: 20_000,
        keep: new ConfigCompaction.Keep({ tokens: 8_000 }),
      }),
    }),
  }),
]

const anchorEntry = {
  seq: 0,
  message: SessionMessage.Assistant.make({
    id: SessionMessage.ID.make("msg_bg_anchor"),
    type: "assistant",
    agent: AGENT,
    model: modelRef,
    content: [],
    tokens: { input: 1_000, output: 50, reasoning: 0, cache: { read: 100, write: 0 } },
    time: { created: DateTime.makeUnsafe(0) },
  }),
}

const user = (seq: number, text: string) => ({
  seq,
  message: SessionMessage.User.make({
    id: SessionMessage.ID.make(`msg_bg_${seq}`),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  }),
})

// 总估算约 17k token（> 8k keep，head 非空），plan 可行
const entries = [
  anchorEntry,
  ...Array.from({ length: 40 }, (_, index) => user(index + 1, `work item ${index + 1} `.repeat(120))),
]

const bigRequest = (chars: number) =>
  LLM.request({ model: candidateModel, messages: [Message.user("x".repeat(chars))], tools: [] })

const startInput = (request: LLMRequest): SessionCompactionCandidate.StartInput => ({
  sessionID,
  agent: AGENT,
  entries,
  model: candidateModel,
  modelRef,
  request,
})

const planned = SessionCompaction.engine({ llm: { stream: () => Stream.empty }, config: config() }).plan({
  sessionID,
  messageID: SessionMessage.ID.create(),
  entries,
  model: candidateModel,
  request: bigRequest(80_000),
})

const takeInput: SessionCompactionCandidate.TakeInput = {
  sessionID,
  firstMessageID: planned?.firstMessageID,
  keepStartID: planned?.keepStartID,
  fingerprint: planned?.fingerprint ?? "",
  tailTokens: planned?.tailTokens ?? 0,
  tailLimit: planned?.tailLimit ?? 0,
}

const textReply = (text: string) =>
  Stream.make(
    LLMEvent.textDelta({ id: "text", text }),
    LLMEvent.finish({
      reason: "stop",
      usage: { inputTokens: 700, outputTokens: 90, reasoningTokens: 10, cacheReadInputTokens: 200, cacheWriteInputTokens: 0 },
    }),
  )

const overflow = () =>
  Stream.make(LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }))

const makeService = (script: Stream.Stream<LLMEvent, LLMError>[], configEntries = config()) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    let call = 0
    const requests: LLMRequest[] = []
    const service = SessionCompactionCandidate.make({
      llm: {
        stream: (request: LLMRequest) => {
          requests.push(request)
          return script[call++] ?? Stream.empty
        },
      },
      config: configEntries,
      scope,
    })
    return { service, requests }
  })

it.effect("does not start a candidate below the background start line", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService([textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(2_000)))
    // 槽位未建：take 立即返回 undefined，且摘要流从未被调用
    expect(yield* service.take(takeInput)).toBeUndefined()
    expect(requests).toHaveLength(0)
  }),
)

it.effect("reuses a matching candidate once and attaches measured usage", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService([textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(80_000)))

    const candidate = yield* service.take(takeInput)
    expect(candidate?.text).toBe(SUMMARY_GOOD)
    expect(candidate?.usage).toEqual({
      input: 700,
      output: 90,
      reasoning: 10,
      cache: { read: 200, write: 0 },
    })
    // 已消费的候选不重复可用，也不计入丢弃成本（其 usage 随操作 Ended 记账）
    expect(yield* service.take(takeInput)).toBeUndefined()
    expect(yield* service.discarded(sessionID)).toBe(0)
    expect(requests).toHaveLength(1)
  }),
)

it.effect("discards the candidate when the conversation changed since the snapshot", () =>
  Effect.gen(function* () {
    const { service } = yield* makeService([textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(80_000)))
    // 追加一条消息后重算计划：保留起点/首条 ID 失配
    const grown = [...entries, user(41, "new message ".repeat(120))]
    const replanned = SessionCompaction.engine({ llm: { stream: () => Stream.empty }, config: config() }).plan({
      sessionID,
      messageID: SessionMessage.ID.create(),
      entries: grown,
      model: candidateModel,
      request: bigRequest(80_000),
    })

    const result = yield* service.take({
      sessionID,
      firstMessageID: replanned?.firstMessageID,
      keepStartID: replanned?.keepStartID,
      fingerprint: replanned?.fingerprint ?? "",
      tailTokens: replanned?.tailTokens ?? 0,
      tailLimit: replanned?.tailLimit ?? 0,
    })

    // 失效候选回退前台：不计 completed，usage 计入丢弃成本（700+90+10+200）
    expect(result).toBeUndefined()
    expect(yield* service.discarded(sessionID)).toBe(1_000)
  }),
)

it.effect("discards the candidate when the config fingerprint changed", () =>
  Effect.gen(function* () {
    const { service } = yield* makeService([textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(80_000)))
    // 预留配置变化 → 指纹失配，即使会话零变更也不应用旧候选
    const replanned = SessionCompaction.engine({
      llm: { stream: () => Stream.empty },
      config: [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({ auto: true, background: true, buffer: "50%" }),
          }),
        }),
      ],
    }).plan({
      sessionID,
      messageID: SessionMessage.ID.create(),
      entries,
      model: candidateModel,
      request: bigRequest(80_000),
    })

    const result = yield* service.take({
      sessionID,
      firstMessageID: replanned?.firstMessageID,
      keepStartID: replanned?.keepStartID,
      fingerprint: replanned?.fingerprint ?? "",
      tailTokens: replanned?.tailTokens ?? 0,
      tailLimit: replanned?.tailLimit ?? 0,
    })

    expect(result).toBeUndefined()
    expect(yield* service.discarded(sessionID)).toBe(1_000)
  }),
)

it.effect("discards an expired candidate after the cache TTL", () =>
  Effect.gen(function* () {
    const { service } = yield* makeService([textReply(SUMMARY_GOOD), textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(80_000)))
    expect(yield* service.take(takeInput)).toBeDefined()

    yield* service.start(startInput(bigRequest(80_000)))
    // TestClock 下 fork 的候选 fiber 需一次调度才完成：先就绪再推进时钟，否则 take 走等待超时路径而非 TTL 过期路径
    yield* Effect.yieldNow
    yield* TestClock.adjust("6 minutes")
    expect(yield* service.take(takeInput)).toBeUndefined()
    expect(yield* service.discarded(sessionID)).toBe(1_000)
  }),
)

it.effect("trips the circuit breaker after two background failures until cycle resets", () =>
  Effect.gen(function* () {
    const failures = [overflow(), overflow(), overflow(), overflow(), overflow()]
    const { service, requests } = yield* makeService([...failures, ...failures, textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(80_000)))
    expect(yield* service.take(takeInput)).toBeUndefined()
    yield* service.start(startInput(bigRequest(80_000)))
    expect(yield* service.take(takeInput)).toBeUndefined()
    expect(requests).toHaveLength(10)
    // 连续两次后台失败：熔断期内不再启动新的后台尝试
    yield* service.start(startInput(bigRequest(80_000)))
    expect(requests).toHaveLength(10)
    // 压缩闭环后开启新周期：后台可再启动（阈值时的有界前台机会与此无关）
    yield* service.cycle(sessionID)
    yield* service.start(startInput(bigRequest(80_000)))
    expect(requests).toHaveLength(11)
    expect((yield* service.take(takeInput))?.text).toBe(SUMMARY_GOOD)
  }),
)

it.effect("background off disables pregeneration without touching threshold auto-compaction", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService([textReply(SUMMARY_GOOD)], config(false))
    yield* service.start(startInput(bigRequest(80_000)))
    expect(yield* service.take(takeInput)).toBeUndefined()
    expect(requests).toHaveLength(0)

    // 阈值自动压缩与后台开关无关：超出触发线仍判定应自动压缩
    const compaction = SessionCompaction.make({
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 纯函数用例不触发事件发布：完整 EventV2 接口与判定逻辑无关
      events: { publish: () => Effect.die("unused") } as unknown as EventV2.Interface,
      llm: { stream: () => Stream.empty },
      config: config(false),
    })
    expect(
      compaction.shouldAutoCompact({
        sessionID,
        messageID: SessionMessage.ID.create(),
        entries,
        model: candidateModel,
        request: bigRequest(130_000),
      }),
    ).toBe(true)
  }),
)

it.effect("waits for an in-flight candidate with a bounded timeout then falls back", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService([Stream.never, textReply(SUMMARY_GOOD)])
    yield* service.start(startInput(bigRequest(80_000)))
    // 摘要流挂起：等待 30 秒超时后丢弃回退前台，在飞 fiber 被中断
    const fiber = yield* Effect.forkChild(service.take(takeInput))
    yield* TestClock.adjust("31 seconds")
    expect(yield* Fiber.join(fiber)).toBeUndefined()
    expect(requests).toHaveLength(1)
    // 槽位已清：可立即启动下一个候选
    yield* service.start(startInput(bigRequest(80_000)))
    expect(requests).toHaveLength(2)
  }),
)
