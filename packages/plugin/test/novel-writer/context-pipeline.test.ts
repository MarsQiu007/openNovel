import { describe, test, expect } from "bun:test"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"

describe("context-pipeline", () => {
  test("writer 提示词包含三阶段上下文获取策略", () => {
    const prompt = writerAgentConfig.systemPrompt
    expect(prompt).toContain("0a")
    expect(prompt).toContain("0b")
    expect(prompt).toContain("0c")
    expect(prompt).toContain("基线快照")
    expect(prompt).toContain("信息缺口")
    expect(prompt).toContain("聚焦深挖")
  })

  test("writer 提示词包含 focus 参数使用说明", () => {
    const prompt = writerAgentConfig.systemPrompt
    expect(prompt).toContain("focus")
  })
})
