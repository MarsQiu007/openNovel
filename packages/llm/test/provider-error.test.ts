import { describe, expect, test } from "bun:test"
import { isContextOverflow } from "../src"

describe("provider error classification", () => {
  test("classifies provider token limit messages as context overflow", () => {
    const messages = [
      "tokens in request more than max tokens allowed",
      '{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
      "Requested token count exceeds the model's maximum context length of 131072 tokens.",
      "Input length (265330) exceeds model's maximum context length (262144).",
      "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      "The input (516368 tokens) is longer than the model's context length (262144 tokens).",
      "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      // DashScope（Ported-from bdf019a9acef1df662f724527c538ac7dbd0f5b5）
      "Range of input length should be [1, 129024]",
      // Z.ai code 1261（Ported-from a931e8a9fd4fd75cdd41b2db05bd26bf4923df5d）
      "Prompt too long",
      "Prompt 超长",
      "Too many tokens",
      "Token limit exceeded",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("classifies empty-body 4xx status messages as context overflow", () => {
    const messages = [
      "400 (no body)",
      "400  status code  (no body)",
      "413 status code (no body)",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
    expect(isContextOverflow("401 (no body)")).toBe(false)
  })

  test("does not classify rate limits as context overflow", () => {
    const messages = [
      "Throttling error: Too many tokens, please wait before trying again.",
      "Rate limit exceeded, please retry after 30 seconds.",
      "Too many requests. Please slow down.",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })

  test("does not classify output parameter errors as context overflow", () => {
    // Cohere 把超过模型上限的 max_tokens 输出参数报成 "too many tokens"，压缩无法修复
    expect(isContextOverflow("max_tokens must be less than 4096")).toBe(false)
  })
})
