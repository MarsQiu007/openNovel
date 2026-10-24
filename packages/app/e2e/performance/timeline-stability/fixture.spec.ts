// timeline-stability fixture 自检（D6）：Playwright 纯 node 断言（不用 page），
// 接班被删的 bun:test 风格 fixture.test.ts。覆盖 D3 帧序列生成器与种子工厂。
import { expect, test } from "@playwright/test"
import { validateV2Timeline } from "../../utils/v2-fixture"
import {
  assistantID,
  assistantMessage,
  historyMessages,
  prompted,
  reasoningTurn,
  retried,
  revertCommitted,
  sessionID,
  sessionUpdated,
  shellSequence,
  stepEnded,
  stepFailed,
  stepStarted,
  textTurn,
  toolSequence,
  userID,
  userMessage,
} from "./fixture"

const types = (frames: { payload: { type: string } }[]) => frames.map((frame) => frame.payload.type)

test("textTurn emits started/delta×N/ended and deltas reassemble the text", () => {
  const frames = textTurn({ text: "abcdefg", textID: "prt_t1", chunks: 3 })
  expect(types(frames)).toEqual([
    "session.next.text.started",
    "session.next.text.delta",
    "session.next.text.delta",
    "session.next.text.delta",
    "session.next.text.ended",
  ])
  const deltas = frames
    .filter((frame) => frame.payload.type === "session.next.text.delta")
    .map((frame) => String(frame.payload.properties["delta"]))
  expect(deltas.join("")).toBe("abcdefg")
  expect(frames.every((frame) => frame.payload.properties["textID"] === "prt_t1")).toBe(true)
  expect(frames.every((frame) => frame.payload.properties["assistantMessageID"] === assistantID)).toBe(true)
})

test("reasoningTurn emits the reasoning frame sequence", () => {
  const frames = reasoningTurn({ text: "thinking aloud", reasoningID: "prt_r1", chunks: 2 })
  expect(types(frames)).toEqual([
    "session.next.reasoning.started",
    "session.next.reasoning.delta",
    "session.next.reasoning.delta",
    "session.next.reasoning.ended",
  ])
  expect(frames.at(-1)?.payload.properties["text"]).toBe("thinking aloud")
})

test("toolSequence emits called/progress/success in order", () => {
  const frames = toolSequence({
    callID: "call_x",
    tool: "bash",
    input: { command: "ls" },
    progress: [{ output: "a" }, { output: "ab" }],
    outcome: { completed: { content: [{ type: "text", text: "ab" }] } },
  })
  expect(types(frames)).toEqual([
    "session.next.tool.called",
    "session.next.tool.progress",
    "session.next.tool.progress",
    "session.next.tool.success",
  ])
  expect(frames.every((frame) => frame.payload.properties["callID"] === "call_x")).toBe(true)
  // called/success 的 provider 为 schema 必填（v2Event 构造即校验，此处钉住语义）
  expect(frames[0]?.payload.properties["provider"]).toEqual({ executed: false })
  expect(frames.at(-1)?.payload.properties["provider"]).toEqual({ executed: true })
})

test("toolSequence failed variant ends with tool.failed", () => {
  const frames = toolSequence({
    callID: "call_y",
    tool: "edit",
    input: { filePath: "a.ts" },
    outcome: { failed: "boom" },
  })
  expect(types(frames)).toEqual(["session.next.tool.called", "session.next.tool.failed"])
  expect(frames.at(-1)?.payload.properties["error"]).toEqual({ type: "unknown", message: "boom" })
})

test("shellSequence grows output via progress structured and settles with content", () => {
  const frames = shellSequence({ callID: "call_s", outputs: ["line1", "line1\nline2"], outcome: { completed: "line1\nline2" } })
  expect(types(frames)).toEqual([
    "session.next.tool.called",
    "session.next.tool.progress",
    "session.next.tool.progress",
    "session.next.tool.success",
  ])
  expect(frames[1]?.payload.properties["structured"]).toMatchObject({ output: "line1" })
  expect(frames.at(-1)?.payload.properties["structured"]).toMatchObject({ output: "line1\nline2" })
})

test("lifecycle frames carry the session and retry attempts increment", () => {
  expect(stepStarted().payload.properties["sessionID"]).toBe(sessionID)
  expect(stepEnded().payload.properties["finish"]).toBe("stop")
  expect(stepFailed("nope").payload.properties["error"]).toEqual({ type: "unknown", message: "nope" })
  expect(retried(1).payload.properties["attempt"]).toBe(1)
  expect(retried(2).payload.properties["attempt"]).toBe(2)
  expect(revertCommitted().payload.properties["messageID"]).toBe(userID)
  expect(sessionUpdated().payload.type).toBe("session.next.updated")
  expect(prompted("hello").payload.properties["prompt"]).toEqual({ text: "hello" })
})

test("seed factories produce a valid deterministic timeline", () => {
  const timeline = [userMessage(), assistantMessage([])]
  expect(() => validateV2Timeline(timeline)).not.toThrow()
  expect(timeline[0]?.id).toBe(userID)
  expect(timeline[1]?.id).toBe(assistantID)
  const history = historyMessages(3)
  expect(history).toHaveLength(6)
  expect(() => validateV2Timeline(history)).not.toThrow()
  expect(history.map((message) => message.id)).toEqual([
    "msg_00000_history_a_user",
    "msg_00000_history_b_assistant",
    "msg_00001_history_a_user",
    "msg_00001_history_b_assistant",
    "msg_00002_history_a_user",
    "msg_00002_history_b_assistant",
  ])
})

test("default assistant seeds as completed; explicit false stays in-flight", () => {
  const done = assistantMessage([])
  expect(done.time.completed).toBe((done.time.created ?? 0) + 1000)
  const inflight = assistantMessage([], { completed: false })
  expect(inflight.time.completed).toBeUndefined()
})
