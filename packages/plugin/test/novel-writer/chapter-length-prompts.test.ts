/**
 * 章节字数上下限 — 提示词契约测试
 *
 * writer / pipeline / reviser 提示词与 architect / director 的 style_guide 落库指令
 * 必须表达显式上下限两态语义（下限常驻 / 区间双向拒绝 / 无上限长章自由），
 * 防止提示词与字数门禁单侧改动造成语义断裂。
 */
import { describe, test, expect } from "bun:test"
import { writerAgent } from "../../src/novel-writer/agents/writer.js"
import { pipelineAgent } from "../../src/novel-writer/agents/pipeline.js"
import { reviserAgent } from "../../src/novel-writer/agents/reviser.js"
import { architectAgent } from "../../src/novel-writer/agents/architect.js"
import { directorAgent } from "../../src/novel-writer/agents/director.js"

describe("章节字数上下限提示词契约", () => {
  test("writer 系统提示词表达两态语义且无 ±15% 残留", () => {
    const prompt = writerAgent.prompt
    // 下限常驻
    expect(prompt).toContain("下限是常驻硬性要求")
    expect(prompt).toContain("低于下限会被 write_chapter 直接拒绝")
    // 区间双向拒绝
    expect(prompt).toContain("下限 N / 上限 M 字")
    expect(prompt).toContain("正文必须落在 N–M 字区间内")
    expect(prompt).toContain("超过上限同样会被直接拒绝")
    // 无上限长章自由
    expect(prompt).toContain("不设上限")
    expect(prompt).toContain("不要为了卡字数而截断正在推进的剧情")
    // 旧开关语义零残留
    expect(prompt).not.toContain("±15%")
    expect(prompt).not.toContain("篇幅限制已启用")
  })

  test("pipeline dispatch 指示表达两态语义且无 ±15% 残留", () => {
    const prompt = pipelineAgent.prompt
    expect(prompt).toContain("下限常驻")
    expect(prompt).toContain("正文必须落在 N–M 字区间内")
    expect(prompt).toContain("快照注明\"不设上限\"时超出无需精简")
    expect(prompt).not.toContain("±15%")
    expect(prompt).not.toContain("篇幅限制")
  })

  test("reviser 提示词约束下限与上限", () => {
    const prompt = reviserAgent.prompt
    expect(prompt).toContain("不得低于快照下限")
    expect(prompt).toContain("快照注明上限时同样不得超出上限")
    expect(prompt).not.toContain("±15%")
  })

  test("architect 落库指令要求读回并带回字数上下限", () => {
    const prompt = architectAgent.prompt
    expect(prompt).toContain("整行覆盖写")
    expect(prompt).toContain("原样带回既有 chapter_length 与 chapter_length_max")
  })

  test("director 风格路由落库指令要求读回并带回字数上下限", () => {
    const prompt = directorAgent.prompt
    expect(prompt).toContain("整行覆盖写")
    expect(prompt).toContain("原样带回既有 chapter_length 与 chapter_length_max")
  })
})
