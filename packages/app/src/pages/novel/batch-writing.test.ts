import { describe, expect, test } from "bun:test"
import { buildBatchWritingPrompt } from "./batch-writing"

describe("buildBatchWritingPrompt", () => {
  test("默认生成连写 5 章请求", () => {
    expect(buildBatchWritingPrompt()).toBe("连写 5 章")
  })

  test("支持指定章数", () => {
    expect(buildBatchWritingPrompt(10)).toBe("连写 10 章")
  })
})