/**
 * annotation.ts 段落批注与润色纯逻辑测试
 */
import { describe, test, expect } from "bun:test"
import {
  splitParagraphs,
  validateAnchor,
  canTransition,
  canApplyAnnotation,
  applySuggestion,
  formatExecutionPrompt,
} from "../../src/novel-writer/annotation.js"

describe("splitParagraphs", () => {
  test("按双换行切分", () => {
    const result = splitParagraphs("第一段\n\n第二段\n\n第三段")
    expect(result).toEqual(["第一段", "第二段", "第三段"])
  })

  test("空字符串返回空数组", () => {
    expect(splitParagraphs("")).toEqual([])
  })

  test("单段返回单元素", () => {
    expect(splitParagraphs("只有一段")).toEqual(["只有一段"])
  })

  test("处理 Windows 换行", () => {
    expect(splitParagraphs("第一段\r\n\r\n第二段")).toEqual(["第一段", "第二段"])
  })
})

describe("validateAnchor", () => {
  const content = "段落一内容\n\n段落二内容\n\n段落三内容"

  test("有效段落和 quote 返回 not stale", () => {
    const result = validateAnchor(content, { paragraphIndex: 0, startOffset: null, endOffset: null, quote: "段落一" })
    expect(result.stale).toBe(false)
  })

  test("段落索引越界返回 stale", () => {
    const result = validateAnchor(content, { paragraphIndex: 10, startOffset: null, endOffset: null, quote: "x" })
    expect(result.stale).toBe(true)
    expect(result.reason).toBe("paragraph_missing")
  })

  test("quote 不匹配返回 stale 和 actualQuote", () => {
    const result = validateAnchor(content, { paragraphIndex: 0, startOffset: null, endOffset: null, quote: "不存在的文本" })
    expect(result.stale).toBe(true)
    expect(result.reason).toBe("quote_mismatch")
    expect(result.actualQuote).toBe("段落一内容")
  })

  test("精确 offset 匹配", () => {
    const result = validateAnchor(content, { paragraphIndex: 1, startOffset: 0, endOffset: 3, quote: "段落二" })
    expect(result.stale).toBe(false)
  })
})

describe("canTransition", () => {
  test("open 可以转到 resolved/wontfix/applied", () => {
    expect(canTransition("open", "resolved")).toBe(true)
    expect(canTransition("open", "wontfix")).toBe(true)
    expect(canTransition("open", "applied")).toBe(true)
  })

  test("applied 可以回退到 open（重新激活），但不能再转 resolved/wontfix", () => {
    expect(canTransition("applied", "open")).toBe(true)
    expect(canTransition("applied", "resolved")).toBe(false)
    expect(canTransition("applied", "wontfix")).toBe(false)
  })

  test("resolved 可以重新打开", () => {
    expect(canTransition("resolved", "open")).toBe(true)
  })
})

describe("canApplyAnnotation", () => {
  test("open 且有 suggested_replacement 可以采纳", () => {
    expect(canApplyAnnotation({ status: "open", suggested_replacement: "改写" })).toBe(true)
  })

  test("open 但无 suggested_replacement 不能采纳", () => {
    expect(canApplyAnnotation({ status: "open", suggested_replacement: null })).toBe(false)
    expect(canApplyAnnotation({ status: "open", suggested_replacement: "" })).toBe(false)
  })

  test("非 open 状态不能采纳", () => {
    expect(canApplyAnnotation({ status: "resolved", suggested_replacement: "改写" })).toBe(false)
  })
})

describe("applySuggestion", () => {
  const content = "段落一原文\n\n段落二原文\n\n段落三原文"

  test("按 quote 替换段落内容", () => {
    const result = applySuggestion(
      content,
      { paragraphIndex: 0, startOffset: null, endOffset: null, quote: "段落一原文" },
      "段落一改写",
    )
    expect(result).toBe("段落一改写\n\n段落二原文\n\n段落三原文")
  })

  test("按 offset 精确替换", () => {
    const result = applySuggestion(
      content,
      { paragraphIndex: 1, startOffset: 0, endOffset: 3, quote: "段落二" },
      "第二章",
    )
    expect(result).toBe("段落一原文\n\n第二章原文\n\n段落三原文")
  })

  test("stale 锚点返回 null", () => {
    const result = applySuggestion(
      content,
      { paragraphIndex: 0, startOffset: null, endOffset: null, quote: "不存在" },
      "改写",
    )
    expect(result).toBeNull()
  })

  test("无 quote 时整段替换", () => {
    const result = applySuggestion(
      content,
      { paragraphIndex: 2, startOffset: null, endOffset: null, quote: "" },
      "全新第三段",
    )
    expect(result).toBe("段落一原文\n\n段落二原文\n\n全新第三段")
  })
})


describe("formatExecutionPrompt", () => {
  const chapterTitle = "第一章"

  test("包含采纳/解决/不修三个分组", () => {
    const prompt = formatExecutionPrompt(
      [
        { id: "a1", status: "applied", paragraph_index: 2, quote: "原文", comment: "", suggested_replacement: "改写后" },
        { id: "a2", status: "resolved", paragraph_index: 4, quote: "", comment: "加强冲突", suggested_replacement: null },
        { id: "a3", status: "wontfix", paragraph_index: 6, quote: "", comment: "", suggested_replacement: null },
      ],
      chapterTitle,
    )
    expect(prompt).toContain("需要应用替换的段落")
    expect(prompt).toContain("段落 3")
    expect(prompt).toContain("改写后")
    expect(prompt).toContain("需要根据意见改写的段落")
    expect(prompt).toContain("加强冲突")
    expect(prompt).toContain("需要跳过的段落")
    expect(prompt).toContain("段落 7")
  })

  test("段落索引从 1 开始展示", () => {
    const prompt = formatExecutionPrompt(
      [{ id: "a1", status: "applied", paragraph_index: 0, quote: "", comment: "", suggested_replacement: "新文本" }],
      chapterTitle,
    )
    expect(prompt).toContain("段落 1")
  })

  test("无批注时返回空指令", () => {
    const prompt = formatExecutionPrompt([], chapterTitle)
    expect(prompt).toContain("请按以下批注修改")
  })
})
