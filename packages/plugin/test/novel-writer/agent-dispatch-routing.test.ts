/**
 * director 路由与调度一致性静态校验。
 *
 * 固化 proposal/design（agent-dispatch-routing）审查结论：章节大纲必须经 @outliner 产线、
 * 创意发散按意图判定、新设定与既有设定分流、director 章纲落库权限 deny、工具描述职责中性。
 * 提示词或权限表回退到代劳写法时本文件必须失败。
 */
import { describe, expect, test } from "bun:test"
import { directorAgent } from "../../src/novel-writer/agents/director.js"
import { ideatorAgent } from "../../src/novel-writer/agents/ideator.js"
import { outlinerAgent } from "../../src/novel-writer/agents/outliner.js"
import { createWritingTools } from "./runtime-assembly-helpers.js"

describe("agent dispatch routing", () => {
  test("director 大纲路由调度 @outliner 且不再自撰内容", () => {
    const prompt = directorAgent.prompt
    expect(prompt).toContain('dispatch @outliner 子 agent（agent: "outliner"）')
    expect(prompt).toContain("由它组装上下文快照、编写完整章纲并调用 generate_chapter_outline 落库")
    expect(prompt).toContain("prompt 传入 novel_id、chapter_number 和【用户反馈原文】")
    expect(prompt).toContain("按章节序号幂等更新原记录")
    expect(prompt).toContain("逐章 dispatch @outliner")
    expect(prompt).toContain("generate_chapter_outline 对你已禁用")
    expect(prompt).toContain("被拒绝时改为 dispatch @outliner")
    expect(prompt).toContain("卷大纲是显式例外")
    expect(prompt).not.toContain("你先生成实际的章节大纲内容")
    expect(prompt).not.toContain("不要直接调用工具生成空模板")
    expect(prompt).not.toContain("| generate_chapter_outline |")
  })

  test("创意路由按意图判定且不含关键词闸门旧写法", () => {
    const prompt = directorAgent.prompt
    expect(prompt).toContain("按意图判定")
    expect(prompt).toContain("无论措辞")
    for (const mode of ["mode: book_pitch", "mode: plot_spark", "mode: character_spark", "mode: material_spark"]) {
      expect(prompt).toContain(mode)
    }
    expect(prompt).not.toContain("只有用户明确请求")
    expect(prompt).not.toContain("不要自动调用")
    expect(prompt).not.toContain("除非用户明确要求")
  })

  test("新设定分流：新增走 @architect、既有修改由 director 直改", () => {
    const prompt = directorAgent.prompt
    expect(prompt).toContain("库中不存在（无中生有、成批生成内容）→ dispatch @architect 生成内容并落库")
    expect(prompt).toContain("已存在的实体修改 → 你直接改")
    expect(prompt).toContain("新增设定（库中不存在的新实体）→ dispatch @architect 生成内容并落库")
    expect(prompt).toContain("修改既有设定条目 → 你定位后直接修改")
  })

  test("权限表：director 章纲落库 deny、outliner allow、卷/整体大纲保留 allow", () => {
    const permission = directorAgent.permission
    expect(permission.generate_chapter_outline).toBe("deny")
    // 精确 deny 必须位于通配 "*" 之后（fromConfig 按对象键插入顺序展开、findLast 取最后匹配）
    expect(Object.keys(permission).indexOf("generate_chapter_outline")).toBeGreaterThan(Object.keys(permission).indexOf("*"))
    expect(permission.generate_volume_outline).toBe("allow")
    expect(permission.generate_master_outline).toBe("allow")
    expect(outlinerAgent.permission.generate_chapter_outline).toBe("allow")
  })

  test("章纲落库工具描述职责中性、不归属 director", () => {
    const description = createWritingTools().generate_chapter_outline.description
    expect(description).toContain("由大纲 agent 生成完整章纲")
    expect(description).not.toContain("director 根据小说设定生成")
  })

  test("风格路由：director 直改落库、不派 @architect、规范写约定路径", () => {
    const prompt = directorAgent.prompt
    expect(prompt).toContain("### 写作风格路由（生成 / 更新风格必走）")
    // 路由归属：显式排除 @architect，覆盖调度表「卷纲等」的含糊措辞
    expect(prompt).toContain("不 dispatch @architect")
    // 触发词
    expect(prompt).toContain("写作风格 / 文风 / 叙事规范")
    // 前置读取：主动查询兜底，不依赖被动快照注入
    expect(prompt).toContain('check_novel_settings(novel_id, scope="all")')
    // 落库交付判据：未落库视为未完成
    expect(prompt).toContain("落库完成才算交付")
    // 规范文件路径约定
    expect(prompt).toContain(".novel/instructions/book.md")
    expect(prompt).toContain("不会被协写作消费")
  })

  test("风格落库权限：director allow、ideator deny", () => {
    expect(directorAgent.permission.save_novel_settings).toBe("allow")
    expect(directorAgent.permission.check_novel_settings).toBe("allow")
    expect(ideatorAgent.permission.save_novel_settings).toBe("deny")
  })
})
