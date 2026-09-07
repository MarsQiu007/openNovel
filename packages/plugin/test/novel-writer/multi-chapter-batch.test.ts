import { describe, expect, test } from "bun:test"
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"
import { pipelineAgentConfig } from "../../src/novel-writer/agents/pipeline.js"

describe("multi-chapter batch prompts", () => {
  test("director 要求顺序调度、限制规模并在中断后停止", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("## 连续多章批量写作")
    expect(prompt).toContain("单次批量最多 10 章")
    expect(prompt).toContain("每一轮只 dispatch 一次 @pipeline")
    expect(prompt).toContain("章号以 @pipeline 的推进结果为准")
    expect(prompt).toContain("review 模式进入待审核时，停止剩余章节")
    expect(prompt).toContain("不重复已完成章")
  })

  test("pipeline 保持单章边界并要求完整完成报告", () => {
    const prompt = pipelineAgentConfig.systemPrompt
    expect(prompt).toContain("## 批量边界")
    expect(prompt).toContain("不要自行循环到下一章")
    expect(prompt).toContain("把单章结果和推进状态交回 director")
    expect(prompt).toContain("新增候选")
    expect(prompt).toContain("冲突标注")
  })
})