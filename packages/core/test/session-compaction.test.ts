import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM, Message, Model } from "@opennovel-ai/llm"
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
