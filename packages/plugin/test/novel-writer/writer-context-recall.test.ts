import { describe, test, expect } from "bun:test"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"

describe("writer-context-recall", () => {
  test("writer 提示词包含 assemble_context_snapshot 调用步骤", () => {
    const prompt = writerAgentConfig.systemPrompt
    expect(prompt).toContain("assemble_context_snapshot")
    expect(prompt).toContain("0a")
    expect(prompt).toContain("0b")
    expect(prompt).toContain("0c")
    expect(prompt).toContain("focus")
    expect(prompt).toContain("三路召回")
  })

  test("writer 提示词包含 recall_history 深挖指引", () => {
    const prompt = writerAgentConfig.systemPrompt
    expect(prompt).toContain("recall_history")
    expect(prompt).toContain("深挖")
  })
})
