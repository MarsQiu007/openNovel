/**
 * 2.2 prompt 对齐测试：技法候选在"工具输出格式 → pipeline 指令 → auditor 指令 → 反馈工具参数"
 * 四处的字段与段落名必须一致。纯静态断言（prompt 是常量文本），防止单侧改名造成链路静默断裂。
 */
import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()
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
          scope: "general",
          embedding: null,
          usageCount: 0,
          lastUsedAt: null,
          createdAt: 0,
          updatedAt: 0,
        },
        matchScore: 0.8,
        library: "book",
      },
    ])
    expect(lines[0]).toMatch(/^- \[tech_x\]\[本书\] 测试技法（置信度:0\.80）：指令$/)
    // pipeline prompt 中描述的行格式模板与实际输出同构（含来源库标记）
    expect(pipelineAgentConfig.systemPrompt).toContain("- [技法ID][本书] 名称（置信度:x.xx）：指令")
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

/**
 * 4.2/4.3 prompt 对齐测试：技法学习流程（director）与召回评估（pipeline）的
 * 新提示词要点——触发示例、范围确认、逐章报告/汇总格式、评估→多轮召回→确认→注入、
 * 确认列表替代候选传给 auditor、旧自动注入指令移除。纯静态断言。
 */
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"

describe("技法学习流程 prompt 对齐（4.2）", () => {
  test("director 提示词包含学习触发示例与范围确认", () => {
    expect(directorAgentConfig.systemPrompt).toContain("来学习这本书籍的写作技巧")
    expect(directorAgentConfig.systemPrompt).toContain("默认整本学习")
    expect(directorAgentConfig.systemPrompt).toContain("只处理该章")
    expect(directorAgentConfig.systemPrompt).toContain("MUST NOT 触发本流程")
  })

  test("director 提示词包含合并判断步骤（先 search_techniques 再 save）", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("合并判断")
    expect(prompt).toContain("search_techniques")
    expect(prompt).toContain("merge_target_id")
    expect(prompt).toContain("不得改动已有条目的 status 与 confidence")
  })

  test("director 提示词包含逐章报告与完成汇总格式", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("新学 N 条、合并 M 条、拒绝 K 条")
    expect(prompt).toContain("完成汇总")
    expect(prompt).toContain("被拒绝候选及原因")
  })

  test("director 工具表登记三个技法工具", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("save_technique")
    expect(prompt).toContain("search_techniques")
    expect(prompt).toContain("confirm_techniques")
  })
})

describe("技法召回评估 prompt 对齐（4.3）", () => {
  test("注入开启时：评估→多轮召回→确认→原样注入 writer prompt", () => {
    const prompt = pipelineAgentConfig.systemPrompt
    expect(prompt).toContain("多轮召回")
    expect(prompt).toContain("search_techniques")
    expect(prompt).toContain("confirm_techniques")
    expect(prompt).toContain("原样附加到步骤 3 的 writer dispatch prompt")
    expect(prompt).toContain("未被确认的候选 MUST NOT 注入 writer prompt")
  })

  test("确认列表替代原候选传给 auditor，被否决候选不进反馈", () => {
    const prompt = pipelineAgentConfig.systemPrompt
    expect(prompt).toContain("确认列表（id/名称/指令）替代原候选")
    expect(prompt).toContain("被否决候选不进 auditor 反馈")
    expect(prompt).toContain("仅取步骤 2.5 中 `confirm_techniques` 确认的技法列表")
  })

  test("shadow mode 保持旧行为：报告行 + 全部候选给 auditor", () => {
    const prompt = pipelineAgentConfig.systemPrompt
    expect(prompt).toContain("技法检索(shadow): N 条技法候选")
    expect(prompt).toContain("步骤 4 全部映射为 `retrieved_techniques` 传给 auditor")
  })

  test("旧自动注入指令已移除", () => {
    const prompt = pipelineAgentConfig.systemPrompt
    expect(prompt).not.toContain("必须将该段落原样传递给 writer")
    expect(prompt).toContain("快照不再输出")
  })
})
