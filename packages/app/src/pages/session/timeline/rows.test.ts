import { describe, expect, test } from "bun:test"
import { reasoningPartRenderable } from "./timeline-row"

describe("reasoningPartRenderable", () => {
  const base = { text: "## 思考标题\n正文", partCompleted: false, messageCompleted: false, showReasoning: false }

  test("流式 + 设置关：不成行（微光行语义）", () => {
    expect(reasoningPartRenderable(base)).toBe(false)
  })

  test("流式 + 设置开：成行", () => {
    expect(reasoningPartRenderable({ ...base, showReasoning: true })).toBe(true)
  })

  test("单段思考完成但消息仍流式 + 设置关：成行", () => {
    expect(reasoningPartRenderable({ ...base, partCompleted: true })).toBe(true)
  })

  test("已完成 + 设置关：成行", () => {
    expect(reasoningPartRenderable({ ...base, messageCompleted: true })).toBe(true)
  })

  test("已完成 + 设置开：成行", () => {
    expect(reasoningPartRenderable({ ...base, messageCompleted: true, showReasoning: true })).toBe(true)
  })

  test("空正文始终不成行", () => {
    expect(
      reasoningPartRenderable({ ...base, text: "  \n  ", messageCompleted: true, showReasoning: true }),
    ).toBe(false)
    expect(reasoningPartRenderable({ ...base, text: undefined, showReasoning: true })).toBe(false)
  })
})
