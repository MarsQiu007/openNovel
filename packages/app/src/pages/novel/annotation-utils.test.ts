/**
 * annotation-utils 纯函数测试
 */
import { describe, test, expect } from "bun:test"
import { segmentParagraph, hasOverlap, annotationInterval, getSelectionAnchor, type AnnotationLike } from "./annotation-utils"

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

describe("hasOverlap（字典序区间）", () => {
  const iv = (startParagraph: number, start: number, endParagraph: number, end: number) => ({
    startParagraph, start, endParagraph, end,
  })

  test("单段完全不重叠", () => {
    expect(hasOverlap(iv(0, 0, 0, 3), iv(0, 5, 0, 8))).toBe(false)
  })

  test("单段相邻但不重叠", () => {
    expect(hasOverlap(iv(0, 0, 0, 3), iv(0, 3, 0, 6))).toBe(false)
  })

  test("单段部分交叉", () => {
    expect(hasOverlap(iv(0, 0, 0, 5), iv(0, 3, 0, 8))).toBe(true)
  })

  test("单段完全包含", () => {
    expect(hasOverlap(iv(0, 0, 0, 10), iv(0, 2, 0, 5))).toBe(true)
  })

  test("单段相同区间", () => {
    expect(hasOverlap(iv(0, 2, 0, 5), iv(0, 2, 0, 5))).toBe(true)
  })

  test("跨段×单段相交（单段落在跨段覆盖的中间段）", () => {
    expect(hasOverlap(iv(0, 3, 2, 1), iv(1, 0, 1, 5))).toBe(true)
  })

  test("跨段×单段：单段在跨段终点段内且与终点偏移相交", () => {
    expect(hasOverlap(iv(0, 3, 2, 5), iv(2, 0, 2, 3))).toBe(true)
  })

  test("跨段×单段：边界相邻不算重叠", () => {
    expect(hasOverlap(iv(0, 3, 2, 1), iv(2, 1, 2, 8))).toBe(false)
  })

  test("跨段×单段：单段完全在跨段之前", () => {
    expect(hasOverlap(iv(2, 3, 4, 1), iv(0, 0, 0, 5))).toBe(false)
  })

  test("跨段×跨段相交", () => {
    expect(hasOverlap(iv(0, 3, 3, 2), iv(2, 0, 4, 1))).toBe(true)
  })

  test("跨段×跨段不相交", () => {
    expect(hasOverlap(iv(0, 3, 1, 2), iv(2, 0, 3, 1))).toBe(false)
  })

  test("跨段区间终点偏移为 0 时与终点段开头批注不算重叠", () => {
    // A 覆盖第 0 段尾部到第 1 段开头（不含第 1 段任何字符）
    expect(hasOverlap(iv(0, 3, 1, 0), iv(1, 0, 1, 4))).toBe(false)
  })
})

describe("annotationInterval", () => {
  test("锚点字段不完整时返回 null", () => {
    expect(annotationInterval({ paragraphIndex: null, startOffset: 0, endOffset: 1 })).toBeNull()
    expect(annotationInterval({ paragraphIndex: 0, startOffset: null, endOffset: 1 })).toBeNull()
  })

  test("endParagraphIndex 为空按单段处理", () => {
    expect(annotationInterval({ paragraphIndex: 1, startOffset: 2, endOffset: 5 })).toEqual({
      startParagraph: 1, start: 2, endParagraph: 1, end: 5,
    })
  })

  test("跨段锚点保留结束段落索引", () => {
    expect(annotationInterval({ paragraphIndex: 0, startOffset: 3, endOffset: 2, endParagraphIndex: 3 })).toEqual({
      startParagraph: 0, start: 3, endParagraph: 3, end: 2,
    })
  })

  test("区间倒挂时退化到起始段单段", () => {
    expect(annotationInterval({ paragraphIndex: 2, startOffset: 1, endOffset: 4, endParagraphIndex: 0 })).toEqual({
      startParagraph: 2, start: 1, endParagraph: 2, end: 4,
    })
  })
})

describe("getSelectionAnchor", () => {
  function textNode(text: string) {
    return { nodeType: 3, textContent: text, childNodes: [] } as unknown as Node
  }

  function paragraph(...children: Node[]) {
    return {
      nodeType: 1,
      childNodes: children,
      textContent: children.map((c) => c.textContent ?? "").join(""),
    } as unknown as Element
  }

  function mockSelection(
    startNode: Node, startOffset: number, endNode: Node, endOffset: number, quote: string,
  ): Selection {
    return {
      getRangeAt: () => ({ startContainer: startNode, startOffset, endContainer: endNode, endOffset }),
      toString: () => quote,
    } as unknown as Selection
  }

  test("单段选区：输出段内偏移且不包含 endParagraphIndex", () => {
    const text = textNode("春风吹过湖面")
    const p = paragraph(text)
    const sel = mockSelection(text, 2, text, 5, "吹过湖")
    const anchor = getSelectionAnchor(p, 3, sel)
    expect(anchor).toEqual({
      anchorType: "range", paragraphIndex: 3, startOffset: 2, endOffset: 5, quote: "吹过湖",
    })
    expect(anchor.endParagraphIndex).toBeUndefined()
  })

  test("单段多文本节点：偏移跨节点累加", () => {
    const a = textNode("春风")
    const b = textNode("吹过湖面")
    const p = paragraph(a, b)
    const sel = mockSelection(a, 1, b, 2, "风吹过")
    const anchor = getSelectionAnchor(p, 0, sel)
    expect(anchor.startOffset).toBe(1)
    expect(anchor.endOffset).toBe(4)
  })

  test("跨段选区：终点段计算 endOffset 并输出 endParagraphIndex", () => {
    const start = textNode("第一段文字内容。")
    const p0 = paragraph(start)
    const end = textNode("第三段文字内容。")
    const p2 = paragraph(end)
    const sel = mockSelection(start, 3, end, 3, "文字内容。第二段文字内容。第三段")
    const anchor = getSelectionAnchor(p0, 0, sel, p2, 2)
    expect(anchor.paragraphIndex).toBe(0)
    expect(anchor.startOffset).toBe(3)
    expect(anchor.endParagraphIndex).toBe(2)
    expect(anchor.endOffset).toBe(3)
  })

  test("选区终点恰好落在段落开头（文本节点偏移 0）", () => {
    const start = textNode("第一段")
    const p0 = paragraph(start)
    const end = textNode("第二段")
    const p1 = paragraph(end)
    const sel = mockSelection(start, 1, end, 0, "一段")
    const anchor = getSelectionAnchor(p0, 0, sel, p1, 1)
    expect(anchor.endParagraphIndex).toBe(1)
    expect(anchor.endOffset).toBe(0)
  })

  test("选区终点恰好落在段落开头（元素节点边界）", () => {
    const start = textNode("第一段")
    const p0 = paragraph(start)
    const end = textNode("第二段")
    const p1 = paragraph(end)
    // 浏览器可能把终点表示为 <p> 元素的子节点索引 0
    const sel = mockSelection(start, 1, p1 as unknown as Node, 0, "一段")
    const anchor = getSelectionAnchor(p0, 0, sel, p1, 1)
    expect(anchor.endParagraphIndex).toBe(1)
    expect(anchor.endOffset).toBe(0)
  })

  test("选区终点为元素节点边界且子节点索引覆盖全段", () => {
    const start = textNode("第一段")
    const p0 = paragraph(start)
    const end = textNode("第二段")
    const p1 = paragraph(end)
    const sel = mockSelection(start, 1, p1 as unknown as Node, 1, "一段第二段")
    const anchor = getSelectionAnchor(p0, 0, sel, p1, 1)
    expect(anchor.endOffset).toBe(3)
  })

  test("显式传入同段终点时按单段处理", () => {
    const text = textNode("春风吹过")
    const p = paragraph(text)
    const sel = mockSelection(text, 0, text, 2, "春风")
    const anchor = getSelectionAnchor(p, 2, sel, p, 2)
    expect(anchor.endParagraphIndex).toBeUndefined()
    expect(anchor.endOffset).toBe(2)
  })
})