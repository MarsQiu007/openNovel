import { describe, test, expect } from "bun:test"
import { applyBudget } from "../../src/novel-writer/budget.js"
import { formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import type { ContextPacket, StyleGuideInfo } from "../../src/novel-writer/context.js"

function makePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    novelTitle: "测试小说",
    genre: "玄幻",
    synopsis: "一个测试故事",
    storySpine: null,
    chapterOutline: null,
    activeCharacters: [],
    departedCharacters: [],
    volumeSummary: null,
    recentChapterSummaries: [],
    segmentSummaries: [],
    plotThreads: [],
    foreshadowing: [],
    activeArcs: [],
    styleGuide: null,
    styleGuideTruncated: false,
    genreRules: [],
    worldEntries: [],
    worldEntryIndex: [],
    volumeList: [],
    relationships: [],
    protectedRelationships: [],
    relationshipContextTruncated: false,
    recalledHistory: [],
    prevChapterTail: null,
    targetWordCount: null,
    chapterLengthLimit: false,
    techniques: [],
    ...overrides,
  }
}

const estimate = (text: string) => Math.ceil(text.length / 1.5)

describe("applyBudget P4 风格指南", () => {
  test("预算充足时规则全量保留、不设截断标记，genreRules 正常保留", () => {
    const styleGuide: StyleGuideInfo = {
      rules: { 异能体系: "等级严格", 禁用手法: "总结式收尾" },
      tone: "冷峻",
      pov: "第三人称",
      tense: "过去时",
    }
    const result = applyBudget(makePacket({ styleGuide, genreRules: ["规则A", "规则B"] }))
    expect(result.styleGuide!.rules).toEqual({ 异能体系: "等级严格", 禁用手法: "总结式收尾" })
    expect(result.styleGuideTruncated).toBe(false)
    expect(result.genreRules).toEqual(["规则A", "规则B"])

    const output = formatSnapshotToolOutput(result as never, { hooks: [] }).output
    expect(output).toContain("- 异能体系: 等级严格")
    expect(output).not.toContain("完整规则可通过")
  })

  test("规则超长时按顺序截断其余、基调视角时态保留并附查询提示", () => {
    const longRule = "这是一条非常长的风格规则内容".repeat(12)
    const rules: Record<string, string> = { 首条: "保留" }
    for (let i = 0; i < 30; i++) rules[`规则${i}`] = longRule
    const styleGuide: StyleGuideInfo = { rules, tone: "冷峻", pov: "第三人称", tense: "过去时" }

    const result = applyBudget(makePacket({ styleGuide, genreRules: ["规则A"] }))

    expect(result.styleGuide).not.toBeNull()
    expect(result.styleGuideTruncated).toBe(true)
    expect(result.styleGuide!.tone).toBe("冷峻")
    expect(result.styleGuide!.pov).toBe("第三人称")
    expect(result.styleGuide!.tense).toBe("过去时")
    const keptKeys = Object.keys(result.styleGuide!.rules)
    expect(keptKeys.length).toBeGreaterThan(0)
    expect(keptKeys.length).toBeLessThan(31)
    expect(keptKeys[0]).toBe("首条")

    // 预算口径：固定行 + 表头 + 保留规则行 + genreRules 合计不超过 1000 token
    const fixed = estimate("风格：基调=冷峻 视角=第三人称 时态=过去时")
    const header = estimate("风格规则：")
    const kept = Object.entries(result.styleGuide!.rules).reduce((sum, [key, value]) => sum + estimate(`- ${key}: ${value}`), 0)
    const genreTokens = result.genreRules.reduce((sum, r) => sum + estimate(r), 0)
    expect(fixed + header + kept + genreTokens).toBeLessThanOrEqual(1000)

    const output = formatSnapshotToolOutput(result as never, { hooks: [] }).output
    expect(output).toContain("风格规则：")
    expect(output).toContain("- 首条: 保留")
    expect(output).toContain("- 规则0: ")
    expect(output).not.toContain("- 规则29: ")
    expect(output).toContain("完整规则可通过 check_novel_settings")
  })
})
