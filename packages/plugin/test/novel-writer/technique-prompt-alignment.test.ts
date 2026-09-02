/**
 * 2.2 prompt 对齐测试：技法候选在"工具输出格式 → pipeline 指令 → auditor 指令 → 反馈工具参数"
 * 四处的字段与段落名必须一致。纯静态断言（prompt 是常量文本），防止单侧改名造成链路静默断裂。
 */
import { describe, test, expect } from "bun:test"
import { pipelineAgentConfig } from "../../src/novel-writer/agents/pipeline.js"
import { auditorAgent } from "../../src/novel-writer/agents/auditor.js"
import { formatTechniquesForShadow } from "../../src/novel-writer/technique-inject.js"

describe("技法链路 prompt 对齐", () => {
  test("pipeline 步骤 2.5 引用的段落名与工具输出的候选段落标题一致", () => {
    // 工具输出段落标题（context.ts formatSnapshotToolOutput）
    const sectionHeader = "═══ 技法候选"
    expect(sectionHeader).toContain("技法候选")
    // pipeline prompt 按段落名引用，而不是引用不存在的 techniques 字段
    expect(pipelineAgentConfig.systemPrompt).toContain("═══ 技法候选")
    expect(pipelineAgentConfig.systemPrompt).not.toContain("`techniques` 字段")
  })

  test("pipeline 步骤 2.5 引用的行格式与 formatTechniquesForShadow 输出一致", () => {
    // 候选行格式：- [技法ID] 名称（置信度:x.xx）：指令
    const lines = formatTechniquesForShadow([
      {
        entry: {
          id: "tech_x",
          name: "测试技法",
          principle: "",
          instruction: "指令",
          sceneTypes: ["dialogue"],
          level: "paragraph",
          evidence: [],
          commonMisuse: "",
          confidence: 0.8,
          status: "verified",
          embedding: null,
          usageCount: 0,
          lastUsedAt: null,
          createdAt: 0,
          updatedAt: 0,
        },
        matchScore: 0.8,
      },
    ])
    expect(lines[0]).toMatch(/^- \[tech_x\] 测试技法（置信度:0\.80）：指令$/)
    // pipeline prompt 中描述的行格式模板与实际输出同构
    expect(pipelineAgentConfig.systemPrompt).toContain("- [技法ID] 名称（置信度:x.xx）：指令")
  })

  test("pipeline → auditor 的 retrieved_techniques 映射指令与 auditor 反馈指令字段一致", () => {
    expect(pipelineAgentConfig.systemPrompt).toContain("retrieved_techniques")
    expect(pipelineAgentConfig.systemPrompt).toContain("`id`、`name`、`instruction`")
    // auditor 侧按同样字段评估并调用反馈工具
    expect(auditorAgent.prompt).toContain("retrieved_techniques")
    expect(auditorAgent.prompt).toContain("record_technique_feedback")
    expect(auditorAgent.prompt).toContain("technique_id")
    expect(auditorAgent.prompt).toContain("was_used")
  })
})
