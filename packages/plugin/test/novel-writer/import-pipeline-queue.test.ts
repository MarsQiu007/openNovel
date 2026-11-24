/**
 * 导入整理工作队列消费者契约（book-import-pipeline）：
 * director 路由段的建队结构、单读三产出、各阶段边界（纠错禁直改/设定禁旁路/
 * 技法 unverified 同口径）、会话冲突处理与判据单一事实源。
 * 队列状态机与守卫语义由 core 侧测试覆盖（tool-workrun / work-run / session-runner）。
 */
import { describe, expect, test } from "bun:test"
import { directorAgent } from "../../src/novel-writer/agents/director.js"

describe("导入整理工作队列", () => {
  const prompt = directorAgent.prompt
  const section = prompt.slice(prompt.indexOf("## 导入整理（工作队列）"), prompt.indexOf("## 路由策略"))

  test("director 建队结构：分章校验打头 + 每章一单元 + 简介与汇总殿后", () => {
    expect(section).toContain("## 导入整理（工作队列）")
    expect(section).toContain('workrun(action="create"')
    expect(section).toContain("分章结构校验")
    expect(section).toContain("每章已有正文的章各一个「章节整理」单元")
    expect(section).toContain("书籍简介生成")
    expect(section).toContain("汇总汇报")
    expect(section).toContain("共 N+3 个")
    expect(section).toContain("list_chapters")
  })

  test("director 逐章推进：单读三产出，写库归编排会话", () => {
    // 单读：子代理只通读一次该章正文，三阶段共享本次阅读
    expect(section).toContain("只通读一次该章正文")
    expect(section).toContain("纠错")
    expect(section).toContain("设定")
    expect(section).toContain("技法")
    // 子代理只读与抽取不写库，写库动作归编排会话
    expect(section).toContain("子代理只读与抽取，**不写库**")
    expect(section).toContain("由你（编排会话）执行写库")
    // 领取-完成-进度笔记循环
    expect(section).toContain('workrun(action="claim")')
    expect(section).toContain('workrun(action="complete_item"')
    expect(section).toContain('workrun(action="progress"')
    expect(section).toContain("覆盖式更新进度笔记")
  })

  test("director 纠错阶段禁止直改正文", () => {
    expect(section).toContain("原文/建议对照")
    expect(section).toContain("**禁止直改章节正文**")
    expect(section).toContain("章节审批流")
  })

  test("director 设定阶段禁止旁路改正式设定", () => {
    expect(section).toContain("organize_settings")
    expect(section).toContain("设定审阅收件箱")
    expect(section).toContain("禁止 update_setting/delete_setting 旁路")
  })

  test("director 技法阶段 unverified 入库且合并不降级", () => {
    expect(section).toContain("save_technique")
    expect(section).toContain("unverified 初始状态")
    expect(section).toContain("同名合并保留既有 status 与 confidence 不降级")
  })

  test("director 技法判据引用单一事实源而非改写", () => {
    // 层级判据指向「技法学习流程」节同一份（其内嵌 LEVEL_CRITERIA 常量），
    // 导入路由段自身不得内联判据文本（防漂移）
    expect(section).toContain("层级判据与「技法学习流程」节同一份")
    expect(section).not.toContain('层级回答"技法作用的最小文本单元"')
  })

  test("director 会话冲突处理：已有 active 队列不抢占", () => {
    expect(section).toContain("已有 active 队列时不要重复 create")
    expect(section).toContain("先完成或挂起既有队列")
  })

  test("director 简介与汇总收尾", () => {
    expect(section).toContain("update_novel")
    expect(section).toContain("synopsis")
    expect(section).toContain("纠错建议分布与条数")
    expect(section).toContain("设定候选待审数")
    expect(section).toContain("技法新学/合并/拒绝清单")
    expect(section).toContain('workrun(action="finish")')
  })

  test("director 分章校验只汇报不重切", () => {
    expect(section).toContain("只汇报不重切")
    expect(section).toContain("不得修改卷章结构")
  })

  test("director 恢复续跑不重建队列", () => {
    expect(section).toContain("不要重建队列")
    expect(section).toContain("已完成单元由队列语义自动跳过")
    expect(section).toContain("等待用户恢复")
  })

  test("director 允许调用 workrun 与 update_novel 工具", () => {
    expect(directorAgent.permission.workrun).toBe("allow")
    expect(directorAgent.permission.update_novel).toBe("allow")
  })
})
