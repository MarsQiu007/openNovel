/**
 * 原文驱动导入队列消费者契约（source-driven-import + book-import-pipeline）：
 * director 新路由段的建队（校准第 1 章起步）、逐章结算（校准期追加下一单元）、
 * 首次计划 replan、收尾追加、四类受限尾部重规划、硬预算受阻与恢复续跑约束。
 * source_import 工具行为见 import-source.test.ts；队列状态机语义由 core 侧测试覆盖。
 */
import { describe, expect, test } from "bun:test"
import { directorAgent } from "../../src/novel-writer/agents/director.js"

describe("原文驱动导入队列", () => {
  const prompt = directorAgent.prompt
  const section = prompt.slice(prompt.indexOf("## 原文驱动导入"), prompt.indexOf("## 路由策略"))

  test("director 以校准第 1 章建队，校准期逐章结算", () => {
    expect(section).toContain("## 原文驱动导入（source_import + workrun）")
    expect(section).toContain('workrun(action="create"')
    expect(section).toContain("校准第 1 章")
    expect(section).toContain("25% 且至少 3 章")
    expect(section).toContain("校准期逐章结算")
    expect(section).toContain("校准第 N+1 章")
  })

  test("director 首步读持久化状态而非凭记忆", () => {
    expect(section).toContain('source_import(action="status")')
    expect(section).toContain("不要凭对话记忆判断进度")
  })

  test("director 单章循环：read 扩展阅读包含未提交段落，commit 仅结构化操作", () => {
    expect(section).toContain('source_import(action="read"')
    expect(section).toContain("扩展阅读必须重新包含未提交段落")
    expect(section).toContain('source_import(action="commit"')
    expect(section).toContain("keep/merge/split/replace/exclude")
    expect(section).toContain("禁止为凑预算硬切")
  })

  test("director 校准达标后先 first_plan 再 replan，不因单章偏差重算", () => {
    expect(section).toContain("calibration_reached=true")
    expect(section).toContain('reason="first_plan"')
    expect(section).toContain('workrun(action="replan"')
    expect(section).toContain("MUST NOT 因单章长短或改题重算计划")
  })

  test("director 原文耗尽先追加收尾任务再完成当前章", () => {
    expect(section).toContain("source_exhausted=true")
    expect(section).toContain('reason="source_exhausted"')
    expect(section).toContain("书籍简介生成")
    expect(section).toContain("「汇总汇报」")
    expect(section).toContain("再 complete_item")
  })

  test("director 单轮三产出复用 organize_settings 与 save_technique 并 mark_stage", () => {
    expect(section).toContain("organize_settings")
    expect(section).toContain("save_technique")
    expect(section).toContain("unverified 初始状态")
    expect(section).toContain('source_import(action="mark_stage"')
  })

  test("director 硬预算耗尽受阻且禁固定字数硬切", () => {
    expect(section).toContain("hard-budget-exhausted")
    expect(section).toContain('workrun(action="block_item"')
    expect(section).toContain("MUST NOT 固定字数硬切")
  })

  test("director 收尾：简介走 update_novel，finalize 后 finish", () => {
    expect(section).toContain("update_novel")
    expect(section).toContain("synopsis")
    expect(section).toContain('source_import(action="finalize"')
    expect(section).toContain('workrun(action="finish")')
  })

  test("director 恢复续跑不重复提交不推进游标", () => {
    expect(section).toContain("禁止重复 commit")
    expect(section).toContain("禁止推进游标")
  })

  test("director 尾部重规划仅限四类证据", () => {
    expect(section).toContain("source_exhausted / work_remaining / structure_invalidated")
    expect(section).toContain("options_changed")
    expect(section).toContain("必须携带具体证据")
    expect(section).toContain("只替换未开始尾部")
  })

  test("director 允许调用 workrun、source_import 与 update_novel", () => {
    expect(directorAgent.permission.workrun).toBe("allow")
    expect(directorAgent.permission.source_import).toBe("allow")
    expect(directorAgent.permission.update_novel).toBe("allow")
  })
})

