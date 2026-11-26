/**
 * AI 拆章 director 编排指令测试（narrative-unit-split 任务 4.5，design D6）
 *
 * 覆盖：建队形态（N+1 恒定与预估口径）、逐章四步闭环、熔断暂停与恢复、
 * MUST NOT 静默降级、跳过与吸收、无存档书入口不可用、设定/技法自动入库口径；
 * 游标续跑不重复组章由 import_split_commit 游标单调与 window 耗尽测试覆盖。
 */
import { describe, test, expect } from "bun:test"
import { directorAgent } from "../../src/novel-writer/agents/director.js"

describe("director AI 拆章编排指令（任务 4.5）", () => {
  const prompt = directorAgent.prompt

  test("建队形态：N+1 恒定与预估口径", () => {
    expect(prompt).toContain("## AI 拆章（工作队列）")
    expect(prompt).toContain("共 N+1")
    expect(prompt).toContain("archive_word_count")
    expect(prompt).toContain("除以 2500")
  })

  test("逐章四步闭环：组章 → 清洗 → 落章 → 入库", () => {
    expect(prompt).toContain("import_split_window")
    expect(prompt).toContain("@cutter")
    expect(prompt).toContain("import_split_extract")
    expect(prompt).toContain("@cleaner")
    expect(prompt).toContain("import_split_commit")
    expect(prompt).toContain("save_novel_settings")
    expect(prompt).toContain("save_technique")
  })

  test("章题强边界与结构清洗降级语义", () => {
    expect(prompt).toContain("章题行前一句")
    expect(prompt).toContain("structure_only")
  })

  test("熔断暂停与恢复语义", () => {
    expect(prompt).toContain("连续 5 章失败")
    expect(prompt).toContain("block_item")
    expect(prompt).toContain("reset_item")
    expect(prompt).toContain("**不要 finish**")
  })

  test("MUST NOT 静默降级", () => {
    expect(prompt).toContain("MUST NOT 用规则拆分静默替代")
    expect(prompt).toContain("禁止把失败章退回规则拆分")
  })

  test("跳过与吸收", () => {
    expect(prompt).toContain("skip_item")
    expect(prompt).toContain("全书已拆完")
    expect(prompt).toContain("预估不足")
  })

  test("无存档书 AI 拆章入口不可用", () => {
    expect(prompt).toContain("没有原文存档")
    expect(prompt).toContain("AI 拆章入口不可用")
  })

  test("设定自动入库不走审阅收件箱，技法沿用 save_technique 口径", () => {
    expect(prompt).toContain("不走审阅收件箱")
    expect(prompt).toContain("unverified 初始状态")
  })

  test("游标续跑：已完成章绝不重复组章", () => {
    expect(prompt).toContain("绝不重复组章")
  })

  test("导入整理段保持原口径（快速模式零变化）", () => {
    expect(prompt).toContain("## 导入整理（工作队列）")
    expect(prompt).toContain("入设定审阅收件箱")
  })
})
