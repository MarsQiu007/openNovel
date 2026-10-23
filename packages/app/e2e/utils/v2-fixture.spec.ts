// v2-fixture 自检单测：合法构造过校验、畸形构造抛错、时间线自检拒绝。
// 用 @playwright/test 纯 node 断言（不用 page），随默认 testMatch 进 CI；
// 不得改成 .test.ts（默认 testMatch 也会收集，bun:test 导入在 Playwright 下即炸）。
import { expect, test } from "@playwright/test"
import {
  resetV2FixtureCounters,
  v2AssistantMessage,
  v2Compaction,
  v2Event,
  v2History,
  v2StreamTurn,
  v2Text,
  v2Tool,
  v2ToolCompleted,
  v2ToolError,
  v2ToolPending,
  v2ToolRunning,
  v2UserMessage,
  validateV2Timeline,
} from "./v2-fixture"

test.beforeEach(() => resetV2FixtureCounters())

test("constructs valid user/assistant/compaction messages", () => {
  const messages = [
    v2UserMessage({ text: "hello" }),
    v2AssistantMessage({ content: [v2Text("world")], completed: 1_760_000_100_000 }),
    v2Compaction({ reason: "auto", summary: "s", recent: "r" }),
  ]
  expect(messages).toHaveLength(3)
  expect(() => validateV2Timeline(messages)).not.toThrow()
})

test("constructs tool content in all four states", () => {
  const assistant = v2AssistantMessage({
    content: [
      v2Tool({ name: "bash", state: v2ToolPending({ command: "ls" }) }),
      v2Tool({ name: "bash", state: v2ToolRunning({ input: { command: "ls" } }) }),
      v2Tool({
        name: "edit",
        state: v2ToolCompleted({ input: { filePath: "a.ts" }, structured: { title: "Edited a.ts" } }),
      }),
      v2Tool({ name: "websearch", state: v2ToolError({ input: { query: "q" }, error: "boom" }) }),
    ],
  })
  expect(assistant.content).toHaveLength(4)
  const pending = assistant.content[0]
  if (pending?.type !== "tool" || pending.state.status !== "pending") throw new Error("expected pending tool")
  expect(JSON.parse(pending.state.input)).toEqual({ command: "ls" })
})

test("rejects malformed wire shapes via schema validation", () => {
  expect(() => v2UserMessage({ id: "not-a-msg-id", text: "x" })).toThrow()
  expect(() =>
    v2AssistantMessage({ id: "msg_ok_1", content: [{ type: "text", id: "t1", text: "x", extra: 1 } as never] }),
  ).toThrow()
  expect(() => v2Compaction({ reason: "bogus" as never, summary: "s", recent: "r" })).toThrow()
})

test("timeline self-check rejects duplicates and orphan assistants", () => {
  const user = v2UserMessage({ text: "a" })
  expect(() => validateV2Timeline([user, user])).toThrow(/duplicate message id/)
  const orphan = v2AssistantMessage({ content: [v2Text("x")] })
  expect(() => validateV2Timeline([orphan])).toThrow(/orphan assistant/)
  const dupContent = v2AssistantMessage({ content: [v2Text("x", "same"), v2Text("y", "same")] })
  expect(() => validateV2Timeline([v2UserMessage({ text: "a" }), dupContent])).toThrow(/duplicate content id/)
})

test("event factory validates properties and envelopes", () => {
  const frame = v2Event("C:/dir", "session.next.text.delta", {
    timestamp: 1_760_000_000_000,
    sessionID: "ses_1",
    assistantMessageID: "msg_1",
    textID: "t1",
    delta: "hi",
  })
  expect(frame.payload.type).toBe("session.next.text.delta")
  expect(frame.payload.id).toMatch(/^evt_fixture_\d{4}$/)
  expect(() => v2Event("C:/dir", "session.next.unknown", {})).toThrow(/unknown V2 event type/)
  expect(() => v2Event("C:/dir", "session.next.text.delta", { timestamp: 1 })).toThrow()
  expect(() =>
    v2Event("C:/dir", "question.v2.asked", {
      id: "que_1",
      sessionID: "ses_1",
      questions: [{ question: "q?", header: "h", options: [{ label: "a", description: "d" }] }],
    }),
  ).not.toThrow()
})

test("stream turn emits the minimal six-frame sequence", () => {
  const frames = v2StreamTurn({ directory: "C:/dir", sessionID: "ses_1", text: "abcdef", chunks: 3 })
  expect(frames.map((frame) => frame.payload.type)).toEqual([
    "session.next.prompted",
    "session.next.step.started",
    "session.next.text.started",
    "session.next.text.delta",
    "session.next.text.delta",
    "session.next.text.delta",
    "session.next.text.ended",
    "session.next.step.ended",
  ])
  const deltas = frames
    .filter((frame) => frame.payload.type === "session.next.text.delta")
    .map((frame) => String(frame.payload.properties["delta"]))
  expect(deltas.join("")).toBe("abcdef")
})

test("history builder produces ordered user/assistant pairs", () => {
  const history = v2History(5)
  expect(history).toHaveLength(10)
  expect(() => validateV2Timeline(history)).not.toThrow()
  expect(history[0]?.type).toBe("user")
  expect(history[1]?.type).toBe("assistant")
})
