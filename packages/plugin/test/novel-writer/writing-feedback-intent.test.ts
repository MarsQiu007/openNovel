import { describe, expect, test } from "bun:test"
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"
import { pipelineAgentConfig } from "../../src/novel-writer/agents/pipeline.js"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"
import { reviserAgent } from "../../src/novel-writer/agents/reviser.js"
import { auditorAgent } from "../../src/novel-writer/agents/auditor.js"

const dispatcherPrompt = directorAgentConfig.systemPrompt
const pipelinePrompt = pipelineAgentConfig.systemPrompt
const writerPrompt = writerAgentConfig.systemPrompt
const reviserPrompt = reviserAgent.prompt
const auditorPrompt = auditorAgent.prompt

describe("写作反馈意图协议", () => {
  test("调度方提示词包含完整结构化字段", () => {
    const fields = [
      "意图编号",
      "反馈编号",
      "意图类型",
      "目标引用",
      "禁止断言",
      "期望状态",
      "保留内容",
      "允许正文否定",
      "原始反馈",
      "澄清问题",
    ]

    for (const prompt of [dispatcherPrompt, pipelinePrompt]) {
      for (const field of fields) {
        expect(prompt).toContain(field)
      }
    }
  })

  test("调度方提示词包含五类转换规则和关键示例", () => {
    const intentTypes = [
      "remove_assertion",
      "replace_assertion",
      "constrain_future",
      "narrative_fact",
      "unclear",
    ]

    for (const prompt of [dispatcherPrompt, pipelinePrompt]) {
      for (const intentType of intentTypes) {
        expect(prompt).toContain(intentType)
      }
      expect(prompt).toContain("不要 X")
      expect(prompt).toContain("把 X 改成 Y")
      expect(prompt).toContain("他没有带伞")
      expect(prompt).toContain("初次生成")
      expect(prompt).toContain("目标断言")
    }
  })

  test("多意图编号可追溯且模糊项只阻断相关意图", () => {
    for (const prompt of [dispatcherPrompt, pipelinePrompt]) {
      expect(prompt).toContain("F1-1")
      expect(prompt).toContain("F1-2")
      expect(prompt).toContain("共同反馈编号")
      expect(prompt).toContain("模糊意图只阻断依赖或冲突于它的意图")
      expect(prompt).toContain("与模糊项无关的明确意图")
    }
  })

  test("原始反馈、结果追溯和正文隔离同时存在", () => {
    expect(dispatcherPrompt).toContain("必须原样保留用户原始反馈")
    expect(dispatcherPrompt).toContain("结果说明必须包含意图编号、反馈编号和原始反馈")
    expect(dispatcherPrompt).toContain("正文不得包含")
    expect(writerPrompt).toContain("原始用户反馈只用于追溯")
    expect(reviserPrompt).toContain("原始用户反馈只用于追溯")
  })
})

describe("写作反馈意图路径", () => {
  test("初次生成路径保留用户原话并在派发前编译", () => {
    expect(dispatcherPrompt).toContain("用户生成约束必须原样放入")
    expect(pipelinePrompt).toContain("从任务中的【用户反馈原文】提取写作反馈或用户生成约束")
    expect(pipelinePrompt).toContain("dispatch 前先执行反馈编译")
    expect(pipelinePrompt).toContain("`write_chapter` 拒绝后的每次 writer 重试都必须保留同一意图块")
  })

  test("驳回重写路径不直接派发批注并把摘要传给审计", () => {
    expect(pipelinePrompt).toContain("先基于原章节正文和【用户反馈原文】编译修订意图")
    expect(pipelinePrompt).toContain("不要直接派发原始批注")
    expect(pipelinePrompt).toContain("完整跑 audit（附带同一意图摘要）")
  })

  test("director 直接修订保留原话并传递意图摘要", () => {
    expect(dispatcherPrompt).toContain("先原样保留用户原话并编译【写作反馈意图（控制层，禁止写入正文）】")
    expect(dispatcherPrompt).toContain("dispatch @auditor 时附【写作反馈意图摘要】")
    expect(dispatcherPrompt).toContain("不要用转述替代用户原话")
  })

  test("模糊反馈返回澄清且不进入执行块", () => {
    for (const prompt of [dispatcherPrompt, pipelinePrompt]) {
      expect(prompt).toContain("不猜测执行，返回具体澄清问题")
      expect(prompt).toContain("不进入 `@writer` / `@reviser` 执行块")
    }
    expect(pipelinePrompt).toContain("整体没有可执行意图时停止流水线并返回澄清问题")
  })
})

describe("故事层输出协议", () => {
  test("writer 把纠正型否定转换为编辑动作", () => {
    expect(writerPrompt).toContain("纠正型否定只能导致删除、替换、场景重写或后续约束")
    expect(writerPrompt).toContain("不要写“主角的心情不会很低落”")
    expect(writerPrompt).toContain("【写作反馈意图（控制层，禁止写入正文）】")
  })

  test("reviser 固定夹具要求最小修订并禁止元否定", () => {
    expect(reviserPrompt).toContain("先按“目标引用”定位受影响断言")
    expect(reviserPrompt).toContain("删除“心情很低落”")
    expect(reviserPrompt).toContain("不要写“主角的心情不会很低落”")
    expect(reviserPrompt).toContain("保留无关情节、称谓、时间线和风格")
  })

  test("执行者按显式标志区分正反否定场景", () => {
    for (const prompt of [writerPrompt, reviserPrompt]) {
      expect(prompt).toContain("允许正文否定：true")
      expect(prompt).toContain("他没有带伞")
      expect(prompt).toContain("纠正型否定默认禁止")
    }
  })
})

describe("审计意图感知", () => {
  test("auditor 识别泄漏、缺失上下文和无反馈场景", () => {
    expect(auditorPrompt).toContain("控制层泄漏")
    expect(auditorPrompt).toContain("违反意图的否定句")
    expect(auditorPrompt).toContain("缺少反馈上下文")
    expect(auditorPrompt).toContain("不因缺少反馈意图报告异常")
  })

  test("合法剧情否定按显式标志判定", () => {
    expect(auditorPrompt).toContain("对照“允许正文否定”判定合法否定")
    expect(auditorPrompt).toContain("不要机械匹配否定词")
  })

  test("PASS 聚焦审计不新增审批轮次", () => {
    expect(pipelinePrompt).toContain("mode: feedback_focus")
    expect(auditorPrompt).toContain("mode: feedback_focus")
    expect(auditorPrompt).toContain("不调用 `submit_chapter_review`")
    expect(dispatcherPrompt).toContain("mode: feedback_focus")
  })

  test("关键路径回归都要求反馈隔离", () => {
    expect(pipelinePrompt).toContain("禁止在正文复述控制层语言")
    expect(writerPrompt).toContain("不能直接改写成正文事实、旁白说明或角色内心独白")
    expect(reviserPrompt).toContain("不能直接改写成正文事实、旁白说明或角色内心独白")
    expect(pipelinePrompt).toContain("有反馈时列出意图编号、反馈编号和原始反馈")
  })
})
