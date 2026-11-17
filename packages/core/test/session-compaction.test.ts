import { expect, test } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { LLM, LLMError, LLMEvent, Message, Model, type LLMRequest } from "@opennovel-ai/llm"
import * as OpenAIChat from "@opennovel-ai/llm/protocols/openai-chat"
import { Config } from "@opennovel-ai/core/config"
import { ConfigCompaction } from "@opennovel-ai/core/config/compaction"
import type { EventV2 } from "@opennovel-ai/core/event"
import { SessionCompaction } from "@opennovel-ai/core/session/compaction"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionSchema } from "@opennovel-ai/core/session/schema"

const makeCompaction = (auto: boolean) =>
  SessionCompaction.make({
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 纯函数用例不触发事件发布：完整 EventV2 接口与判定逻辑无关
    events: { publish: () => Effect.die("unused") } as unknown as EventV2.Interface,
    llm: { stream: () => Stream.empty },
    config: [
      new Config.Document({
        type: "document",
        info: new Config.Info({ compaction: new ConfigCompaction.Info({ auto }) }),
      }),
    ],
  })

test("auto:false disables threshold trigger and overflow recovery together", () => {
  const compact = Model.make({
    id: "compact",
    provider: "fake",
    route: OpenAIChat.route.with({ limits: { context: 4_000, output: 50 } }),
  })
  const input = {
    sessionID: SessionSchema.ID.make("ses_compact_auto"),
    messageID: SessionMessage.ID.make("msg_compact_auto"),
    entries: [],
    model: compact,
    request: LLM.request({
      model: compact,
      messages: [Message.user("Earlier question ".repeat(400))],
      tools: [],
    }),
  }

  const enabled = makeCompaction(true)
  expect(enabled.thresholdExceeded(input)).toBe(true)
  expect(enabled.overflowRecoveryEnabled).toBe(true)

  const disabled = makeCompaction(false)
  expect(disabled.thresholdExceeded(input)).toBe(false)
  expect(disabled.shouldAutoCompact(input)).toBe(false)
  expect(disabled.overflowRecoveryEnabled).toBe(false)
})

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

// ---- 4.1 有界摘要：输出预算、四级溢出缩减、工具裁剪层级与一次结构 nudge ----

const SUMMARY_GOOD = "## Objective\n- Ship the fix"

const makeSummarizer = (script: Stream.Stream<LLMEvent, LLMError>[]) => {
  const published: { type: string; data: Record<string, unknown> }[] = []
  const requests: LLMRequest[] = []
  let call = 0
  const compaction = SessionCompaction.make({
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 与 makeCompaction 相同：纯函数用例只需捕获发布的事件载荷
    events: {
      publish: (definition: { readonly type: string }, data: Record<string, unknown>) =>
        Effect.sync(() => {
          published.push({ type: definition.type, data })
        }),
    } as unknown as EventV2.Interface,
    llm: {
      stream: (request: LLMRequest) => {
        requests.push(request)
        return script[call++] ?? Stream.empty
      },
    },
    config: [
      new Config.Document({
        type: "document",
        info: new Config.Info({ compaction: new ConfigCompaction.Info({ auto: true }) }),
      }),
    ],
  })
  return { compaction, published, requests }
}

const ladderModel = Model.make({
  id: "ladder",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 50_000, output: 4_096 } }),
})

const entry = (seq: number, text: string) => ({
  seq,
  message: SessionMessage.User.make({
    id: SessionMessage.ID.make(`msg_ladder_${seq}`),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  }),
})

const ladderInput = (entries: readonly { seq: number; message: SessionMessage.User }[]) => ({
  sessionID: SessionSchema.ID.make("ses_ladder"),
  messageID: SessionMessage.ID.make("msg_ladder_op"),
  entries,
  model: ladderModel,
  request: LLM.request({ model: ladderModel, messages: [Message.user("kickoff")], tools: [] }),
})

const overflow = (message = "prompt too long") =>
  Stream.make(LLMEvent.providerError({ message, classification: "context-overflow" }))
const textReply = (text: string) => Stream.make(LLMEvent.textDelta({ id: "text", text }), LLMEvent.finish({ reason: "stop" }))

const requestSize = (request: LLMRequest) => JSON.stringify(request.messages).length

const failedMessage = (published: { type: string; data: Record<string, unknown> }[]) => {
  const failed = published.find((event) => event.type === "session.next.compaction.failed")
  const error = failed?.data.error
  return error && typeof error === "object" && "message" in error ? String(error.message) : ""
}

test("summary ladder shrinks the request step by step after provider overflow rejections", async () => {
  const entries = Array.from({ length: 40 }, (_, index) =>
    entry(index + 1, `work item ${index + 1} `.repeat(120)),
  )
  const { compaction, published, requests } = makeSummarizer([overflow(), overflow(), textReply(SUMMARY_GOOD)])

  const outcome = await Effect.runPromise(compaction.compactAfterOverflow(ladderInput(entries)))

  expect(outcome).toEqual({ status: "completed", messageID: SessionMessage.ID.make("msg_ladder_op") })
  expect(requests).toHaveLength(3)
  expect(requestSize(requests[1])).toBeLessThan(requestSize(requests[0]))
  expect(requestSize(requests[2])).toBeLessThan(requestSize(requests[1]))
  // 丢弃的较旧消息以注记明示，不静默从摘要输入与最近尾部同时丢弃
  expect(JSON.stringify(requests[2].messages)).toContain("earlier messages omitted from the summary")
  const ended = published.find((event) => event.type === "session.next.compaction.ended")
  expect(ended?.data.text).toBe(SUMMARY_GOOD)
  expect(published.some((event) => event.type === "session.next.compaction.failed")).toBe(false)
})

test("summary ladder gives up after the smallest shrink step", async () => {
  const entries = Array.from({ length: 40 }, (_, index) =>
    entry(index + 1, `work item ${index + 1} `.repeat(120)),
  )
  const secret = "sk-live-secret-should-not-leak"
  const { compaction, published, requests } = makeSummarizer([
    overflow(secret),
    overflow(secret),
    overflow(secret),
    overflow(secret),
    overflow(secret),
  ])

  const outcome = await Effect.runPromise(compaction.compactAfterOverflow(ladderInput(entries)))

  expect(outcome.status).toBe("failed")
  expect(requests).toHaveLength(5)
  const message = failedMessage(published)
  expect(message).toBe("摘要请求已缩减到最小级别仍被模型拒绝")
  expect(message).not.toContain(secret)
})

test("nudges once when the reply misses the template, then accepts a corrected summary", async () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry(index + 1, `topic ${index + 1} `.repeat(300)))
  const { compaction, published, requests } = makeSummarizer([
    textReply("随便聊聊，没有按模板输出"),
    textReply(SUMMARY_GOOD),
  ])

  const outcome = await Effect.runPromise(compaction.compactAfterOverflow(ladderInput(entries)))

  expect(outcome.status).toBe("completed")
  expect(requests).toHaveLength(2)
  expect(requests[1].messages).toHaveLength(2)
  const ended = published.find((event) => event.type === "session.next.compaction.ended")
  expect(ended?.data.text).toBe(SUMMARY_GOOD)
})

test("empty first reply fails without a nudge", async () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry(index + 1, `topic ${index + 1} `.repeat(300)))
  const { compaction, published, requests } = makeSummarizer([Stream.empty])

  const outcome = await Effect.runPromise(compaction.compactAfterOverflow(ladderInput(entries)))

  expect(outcome.status).toBe("failed")
  expect(requests).toHaveLength(1)
  expect(failedMessage(published)).toBe("摘要为空，已中止压缩")
})

test("reply still missing the template after the nudge fails", async () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry(index + 1, `topic ${index + 1} `.repeat(300)))
  const { compaction, published, requests } = makeSummarizer([
    textReply("第一段不符合结构"),
    textReply("第二段还是不符合结构"),
  ])

  const outcome = await Effect.runPromise(compaction.compactAfterOverflow(ladderInput(entries)))

  expect(outcome.status).toBe("failed")
  expect(requests).toHaveLength(2)
  expect(failedMessage(published)).toBe("摘要不符合约定结构，已中止压缩")
})

test("non-overflow provider error fails without ladder retries and stays sanitized", async () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry(index + 1, `topic ${index + 1} `.repeat(300)))
  const secret = "raw-provider-response-body-secret"
  const { compaction, published, requests } = makeSummarizer([
    Stream.make(LLMEvent.providerError({ message: `500 boom ${secret}` })),
  ])

  const outcome = await Effect.runPromise(compaction.compactAfterOverflow(ladderInput(entries)))

  expect(outcome.status).toBe("failed")
  expect(requests).toHaveLength(1)
  const message = failedMessage(published)
  expect(message).toBe("摘要生成失败，请稍后重试")
  expect(message).not.toContain(secret)
})
