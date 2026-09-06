/**
 * annotation-utils 纯函数测试
 */
import { describe, test, expect } from "bun:test"
import { segmentParagraph, hasOverlap, type AnnotationLike } from "./annotation-utils"

function ann(overrides: Partial<AnnotationLike> & { id: string }): AnnotationLike {
  return {
    status: "open",
    paragraphIndex: 0,
    startOffset: null,
    endOffset: null,
    quote: "",
    comment: "",
    ...overrides,
  }
}

describe("segmentParagraph", () => {
  test("无批注时返回纯文本片段", () => {
    const result = segmentParagraph("这是一段正文", [])
    expect(result).toEqual([{ text: "这是一段正文", annotation: null }])
  })

  test("单个 open 批注在中间", () => {
    const a = ann({ id: "a1", startOffset: 3, endOffset: 6 })
    const result = segmentParagraph("春风吹过湖面柳絮飘", [a])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ text: "春风吹", annotation: null })
    expect(result[1].text).toBe("过湖面")
    expect(result[1].annotation?.id).toBe("a1")
    expect(result[2]).toEqual({ text: "柳絮飘", annotation: null })
  })

  test("批注在开头", () => {
    const a = ann({ id: "a1", startOffset: 0, endOffset: 3 })
    const result = segmentParagraph("春风吹过", [a])
    expect(result).toHaveLength(2)
    expect(result[0].annotation?.id).toBe("a1")
    expect(result[0].text).toBe("春风吹")
    expect(result[1]).toEqual({ text: "过", annotation: null })
  })

  test("批注在末尾", () => {
    const a = ann({ id: "a1", startOffset: 2, endOffset: 4 })
    const result = segmentParagraph("春风吹过", [a])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ text: "春风", annotation: null })
    expect(result[1].text).toBe("吹过")
  })

  test("多个不重叠批注", () => {
    const a1 = ann({ id: "a1", startOffset: 0, endOffset: 2 })
    const a2 = ann({ id: "a2", startOffset: 4, endOffset: 6 })
    const result = segmentParagraph("春风吹过湖面", [a1, a2])
    expect(result).toHaveLength(3)
    expect(result[0].annotation?.id).toBe("a1")
    expect(result[1]).toEqual({ text: "吹过", annotation: null })
    expect(result[2].annotation?.id).toBe("a2")
  })

  test("open 和非 open 混合", () => {
    const a1 = ann({ id: "a1", status: "open", startOffset: 0, endOffset: 2 })
    const a2 = ann({ id: "a2", status: "resolved", startOffset: 4, endOffset: 6 })
    const result = segmentParagraph("春风吹过湖面", [a1, a2])
    expect(result[0].annotation?.status).toBe("open")
    expect(result[2].annotation?.status).toBe("resolved")
  })

  test("偏移超出文本长度时截取", () => {
    const a = ann({ id: "a1", startOffset: 2, endOffset: 100 })
    const result = segmentParagraph("春风", [a])
    expect(result[0].text).toBe("春风")
  })
})

describe("hasOverlap", () => {
  test("完全不重叠", () => {
    expect(hasOverlap({ start: 0, end: 3 }, { start: 5, end: 8 })).toBe(false)
  })

  test("相邻但不重叠", () => {
    expect(hasOverlap({ start: 0, end: 3 }, { start: 3, end: 6 })).toBe(false)
  })

  test("部分交叉", () => {
    expect(hasOverlap({ start: 0, end: 5 }, { start: 3, end: 8 })).toBe(true)
  })

  test("完全包含", () => {
    expect(hasOverlap({ start: 0, end: 10 }, { start: 2, end: 5 })).toBe(true)
  })

  test("相同区间", () => {
    expect(hasOverlap({ start: 2, end: 5 }, { start: 2, end: 5 })).toBe(true)
  })
})