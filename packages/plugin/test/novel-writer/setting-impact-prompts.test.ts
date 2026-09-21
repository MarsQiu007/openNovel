import { describe, expect, test } from "bun:test"

describe("设定影响面提示词", () => {
  test("director / architect / observer / pipeline 均包含语义确认与门禁规则", async () => {
    const { directorAgentConfig } = await import("../../src/novel-writer/agents/director.js")
    const { architectAgent } = await import("../../src/novel-writer/agents/architect.js")
    const { observerAgent } = await import("../../src/novel-writer/agents/observer.js")
    const { pipelineAgentConfig } = await import("../../src/novel-writer/agents/pipeline.js")
    const prompts = [directorAgentConfig.systemPrompt, architectAgent.systemPrompt, observerAgent.prompt, pipelineAgentConfig.systemPrompt]

    expect(prompts).toHaveLength(4)
    for (const prompt of prompts) {
      expect(prompt).toContain("设定影响面处理")
      expect(prompt).toContain("impact_semantic_review")
      expect(prompt).toContain("requires_confirmation")
      expect(prompt).toContain("cascade_list_pending")
      expect(prompt).toContain("write_chapter")
    }
  })
})
