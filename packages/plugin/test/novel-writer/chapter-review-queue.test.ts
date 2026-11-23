import { describe, expect, test } from "bun:test"
import { directorAgent } from "../../src/novel-writer/agents/director.js"

// 全书逐章审查消费者契约（agent-work-continuation 5.1）：
// 建队列、逐章推进、恢复续跑的提示词面与 workrun 工具授权。
// 队列状态机与守卫语义由 core 侧测试覆盖（tool-workrun / work-run / session-runner）。
describe("全书逐章审查工作队列", () => {
  const prompt = directorAgent.prompt

  test("director 以 workrun 队列建队并逐章推进", () => {
    expect(prompt).toContain("## 全书逐章审查")
    // 建队列：先核对真实章节，每章一个审查单元，已有队列不重复 create
    expect(prompt).toContain('workrun(action="create"')
    expect(prompt).toContain("每章已有正文的章各声明一个审查单元")
    expect(prompt).toContain("list_chapters")
    expect(prompt).toContain("已有 active 队列时不要重复 create")
    // 逐章推进：claim 循环、完成标记、覆盖式进度笔记
    expect(prompt).toContain('workrun(action="claim")')
    expect(prompt).toContain('workrun(action="complete_item"')
    expect(prompt).toContain('workrun(action="progress"')
    expect(prompt).toContain("覆盖式更新进度笔记")
    // 受阻处理：记录原因后继续，不卡死在单章
    expect(prompt).toContain('workrun(action="block_item"')
  })

  test("director 恢复续跑不重建队列", () => {
    expect(prompt).toContain("不要重建队列")
    // 进行中单元先完成再领取（claim 对 in_progress 单元会拒绝）
    expect(prompt).toContain("先完成该单元")
    expect(prompt).toContain("不会重复审查")
    expect(prompt).toContain("等待用户恢复")
  })

  test("director 允许调用 workrun 工具", () => {
    expect(directorAgent.permission.workrun).toBe("allow")
  })

  // 终结与最终汇报（agent-work-continuation 5.2）：队列终结后守卫自动放行，
  // agent 产出全书审查总结（守卫谓词本体由 core session-runner 测试覆盖）。
  test("director 队列终结后产出全书审查总结", () => {
    // 终结触发：claim 返回没有待处理单元（全部完成或跳过）时 finish
    expect(prompt).toContain("claim 返回“没有待处理单元”")
    expect(prompt).toContain('workrun(action="finish")')
    expect(prompt).toContain("终结队列")
    // 最终汇报：全书审查总结内容要求
    expect(prompt).toContain("全书审查总结")
    expect(prompt).toContain("主要问题分布")
    // 守卫放行：终结后自动续跑约束解除，可正常停机
    expect(prompt).toContain("自动续跑约束解除")
  })
})
