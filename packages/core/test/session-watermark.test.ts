import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { Model } from "@opennovel-ai/schema/model"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionWatermark } from "@opennovel-ai/core/session/watermark"

const model = (ref: string) => Model.Ref.parse(ref)
const current = model("test-provider/test-model")

const entry = (seq: number, message: SessionMessage.Message): SessionWatermark.Entry => ({ seq, message })

const user = (text: string): SessionMessage.Message =>
  SessionMessage.User.make({ id: SessionMessage.ID.create(), type: "user", text, time: { created: DateTime.makeUnsafe(1_000) } })

const assistant = (
  ref: Model.Ref,
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } },
  content: SessionMessage.AssistantContent[] = [],
): SessionMessage.Message =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "writer",
    model: ref,
    content,
    ...(tokens === undefined ? {} : { tokens }),
    time: { created: DateTime.makeUnsafe(2_000) },
  })

const variantRef = Schema.decodeUnknownSync(Model.Ref)({
  id: "test-model",
  providerID: "test-provider",
  variant: "fast",
})

const tokens = { input: 1_000, output: 50, reasoning: 20, cache: { read: 300, write: 100 } }

const compute = (entries: SessionWatermark.Entry[], window = 128_000, buffer: number | string = "15%") =>
  SessionWatermark.compute({
    entries,
    agent: "writer",
    model: current,
    window,
    output: 8_000,
    buffer,
  })

describe("SessionWatermark.compute", () => {
  test("中文冷启动：无锚点时按 CJK 保守估算并降级", () => {
    const watermark = compute([entry(1, user("汉".repeat(100)))])
    expect(watermark.source).toBe("estimated")
    expect(watermark.measured).toBe(0)
    // CJK 按不低于 1 token/字：100 汉字至少 100 token，不得偏晚
    expect(watermark.estimated).toBeGreaterThanOrEqual(100)
    expect(watermark.degraded).toContain("尚无实测用量锚点")
    expect(watermark.trigger).toEqual({ share: 0.15, tokens: 128_000 - Math.max(Math.round(128_000 * 0.15), 8_000) })
    expect(watermark.ratio).toBeCloseTo(watermark.total / 128_000, 5)
  })

  test("缓存 token 计入实测锚点，锚点之后按未测量后缀估算", () => {
    const watermark = compute([
      entry(1, user("hello")),
      entry(2, assistant(current, tokens)),
      entry(3, user("后续问题")),
    ])
    expect(watermark.source).toBe("mixed")
    expect(watermark.measured).toBe(1_000 + 300 + 100 + 50 + 20)
    expect(watermark.estimated).toBe(SessionWatermark.estimateText("后续问题"))
  })

  test("锚点本地工具结果计入后缀，锚点自身输出被 usage 覆盖", () => {
    const tool = SessionMessage.AssistantTool.make({
      type: "tool",
      id: SessionMessage.ID.create(),
      name: "bash",
      state: SessionMessage.ToolStateCompleted.make({
        status: "completed",
        input: { command: "ls" },
        content: [{ type: "text", text: "x".repeat(400) }],
        structured: {},
      }),
      time: { created: DateTime.makeUnsafe(2_000) },
    })
    const watermark = compute([
      entry(1, user("run it")),
      entry(
        2,
        assistant(current, tokens, [
          SessionMessage.AssistantText.make({ type: "text", id: "txt_1", text: "已完成" }),
          tool,
        ]),
      ),
    ])
    expect(watermark.source).toBe("mixed")
    expect(watermark.measured).toBe(1_470)
    // 400 个 ASCII 工具输出 ≈ 100 token；锚点自身的文本与调用输入不计入后缀
    expect(watermark.estimated).toBeGreaterThanOrEqual(100)
    expect(watermark.estimated).toBeLessThan(110)
  })

  test("模型切换与 variant 不匹配使旧锚点失效", () => {
    const oldModel = model("test-provider/old-model")
    const switched = compute([entry(1, assistant(oldModel, tokens)), entry(2, user("hi"))])
    expect(switched.source).toBe("estimated")
    expect(switched.measured).toBe(0)

    const boundary = compute([
      entry(1, assistant(oldModel, tokens)),
      entry(
        2,
        SessionMessage.ModelSwitched.make({
          id: SessionMessage.ID.create(),
          type: "model-switched",
          model: current,
          time: { created: DateTime.makeUnsafe(1_500) },
        }),
      ),
      entry(3, assistant(current, tokens)),
      entry(4, user("hi")),
    ])
    expect(boundary.source).toBe("mixed")
    expect(boundary.measured).toBe(1_470)

    const variantMismatch = compute([entry(1, assistant(variantRef, tokens)), entry(2, user("hi"))])
    expect(variantMismatch.source).toBe("estimated")
  })

  test("未知窗口降级且不伪造触发阈值", () => {
    const watermark = SessionWatermark.compute({
      entries: [entry(1, user("hello"))],
      agent: "writer",
      model: current,
      window: undefined,
      output: 8_000,
      buffer: "15%",
    })
    expect(watermark.window).toBeUndefined()
    expect(watermark.trigger).toBeUndefined()
    expect(watermark.ratio).toBe(0)
    expect(watermark.degraded).toContain("窗口")
  })

  test("固定数值 buffer 不携带 share，仍保留 output 空间", () => {
    const watermark = compute([entry(1, user("hello"))], 100_000, 20_000)
    expect(watermark.trigger).toEqual({ tokens: 80_000 })
  })
})
