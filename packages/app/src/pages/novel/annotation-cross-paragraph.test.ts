/**
 * 跨段批注端到端集成验收
 *
 * 串联选区映射 → 锚点持久化形态 → 区间装饰渲染 → 重叠拦截 → 执行 prompt，
 * 以及正文编辑后的失稳语义（钳制、倒挂退化）。
 */
import { describe, test, expect } from "bun:test"
import {
  annotationInterval,
  getSelectionAnchor,
  hasOverlap,
  paragraphDecorationAnnotations,
  segmentParagraph,
  type AnnotationLike,
} from "./annotation-utils"
import { buildAnnotationsSnapshot, formatExecutionPrompt } from "./annotation-execution"

const PARAGRAPHS = ["第一段文字内容。", "第二段文字内容。", "第三段文字内容。"]

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

/** 模拟用户从第 1 段第 3 字选到第 3 段第 3 字 */
function makeCrossParagraphSelection() {
  const start = textNode(PARAGRAPHS[0])
  const p0 = paragraph(start)
  const end = textNode(PARAGRAPHS[2])
  const p2 = paragraph(end)
  const quote = `${PARAGRAPHS[0].slice(3)}\n${PARAGRAPHS[1]}\n${PARAGRAPHS[2].slice(0, 3)}`
  const sel = mockSelection(start, 3, end, 3, quote)
  return getSelectionAnchor(p0, 0, sel, p2, 2)
}

describe("端到端：跨段批注全流程", () => {
  const anchor = makeCrossParagraphSelection()

  test("选区映射输出完整跨段锚点", () => {
    expect(anchor.paragraphIndex).toBe(0)
    expect(anchor.startOffset).toBe(3)
    expect(anchor.endParagraphIndex).toBe(2)
    expect(anchor.endOffset).toBe(3)
    expect(anchor.quote).toContain("第二段文字内容。")
  })

  const stored: AnnotationLike = {
    id: "ann-cross",
    status: "open",
    paragraphIndex: anchor.paragraphIndex,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    endParagraphIndex: anchor.endParagraphIndex,
    quote: anchor.quote,
    comment: "三段节奏拖沓",
  }

  test("区间装饰渲染：起始段到段尾、中间段整段、结束段到偏移", () => {
    const rendered = PARAGRAPHS.map((text, idx) =>
      segmentParagraph(text, paragraphDecorationAnnotations(idx, text.length, PARAGRAPHS.length, [stored])),
    )
    expect(rendered[0]).toEqual([
      { text: "第一段", annotation: null },
      { text: "文字内容。", annotation: expect.objectContaining({ id: "ann-cross" }) },
    ])
    expect(rendered[1]).toEqual([
      { text: "第二段文字内容。", annotation: expect.objectContaining({ id: "ann-cross" }) },
    ])
    expect(rendered[2]).toEqual([
      { text: "第三段", annotation: expect.objectContaining({ id: "ann-cross" }) },
      { text: "文字内容。", annotation: null },
    ])
  })

  test("重叠拦截：跨段×单段相交被拒绝", () => {
    const storedInterval = annotationInterval(stored)!
    // 新选区落在跨段覆盖的中间段内
    const middle = annotationInterval({ paragraphIndex: 1, startOffset: 1, endOffset: 4 })!
    expect(hasOverlap(middle, storedInterval)).toBe(true)
    // 新选区与结束段偏移相交
    const tailHit = annotationInterval({ paragraphIndex: 2, startOffset: 0, endOffset: 3 })!
    expect(hasOverlap(tailHit, storedInterval)).toBe(true)
  })

  test("重叠拦截：边界相邻放行", () => {
    const storedInterval = annotationInterval(stored)!
    // 紧接结束偏移之后的新选区（半开区间，不算重叠）
    const adjacent = annotationInterval({ paragraphIndex: 2, startOffset: 3, endOffset: 6 })!
    expect(hasOverlap(adjacent, storedInterval)).toBe(false)
    // 起始段偏移之前的选区
    const before = annotationInterval({ paragraphIndex: 0, startOffset: 0, endOffset: 3 })!
    expect(hasOverlap(before, storedInterval)).toBe(false)
  })

  test("执行 prompt 完整传递结束段落索引", () => {
    const prompt = formatExecutionPrompt({
      roundID: "round-1",
      chapterID: "ch-1",
      chapterTitle: "第一章",
      paragraphs: PARAGRAPHS,
      annotations: [{ ...stored, status: "resolved" as const, suggestedReplacement: null }],
    })
    expect(prompt).toContain("- paragraph_index: 1")
    expect(prompt).toContain("- end_paragraph_index: 3")
    expect(prompt).toContain("- start_offset: 3")
    expect(prompt).toContain("- end_offset: 3")
    expect(prompt).toContain("annotation_id: ann-cross")
    const snapshot = buildAnnotationsSnapshot([{ ...stored, status: "resolved" as const, suggestedReplacement: null }])
    expect(snapshot[0].endParagraphIndex).toBe(2)
  })
})

describe("失稳语义：正文编辑后阅读与执行不报错", () => {
  test("删除区间内段落后锚点钳制到末段", () => {
    const stored: AnnotationLike = {
      id: "ann-clamp",
      status: "open",
      paragraphIndex: 0,
      startOffset: 3,
      endOffset: 3,
      endParagraphIndex: 2,
      quote: "跨段引用",
      comment: "评论",
    }
    // 正文只剩 1 段
    const remaining = ["第一段文字内容。"]
    const rendered = remaining.map((text, idx) =>
      segmentParagraph(text, paragraphDecorationAnnotations(idx, text.length, remaining.length, [stored])),
    )
    // 起始段从 startOffset 装饰到段尾，不报错
    expect(rendered[0]).toEqual([
      { text: "第一段", annotation: null },
      { text: "文字内容。", annotation: expect.objectContaining({ id: "ann-clamp" }) },
    ])
  })

  test("区间倒挂时退化到起始段单段，阅读与 prompt 均不输出跨段信息", () => {
    const inverted: AnnotationLike = {
      id: "ann-inverted",
      status: "open",
      paragraphIndex: 2,
      startOffset: 1,
      endOffset: 4,
      endParagraphIndex: 0,
      quote: "倒挂引用",
      comment: "评论",
    }
    // annotationInterval 退化为单段
    expect(annotationInterval(inverted)).toEqual({
      startParagraph: 2, start: 1, endParagraph: 2, end: 4,
    })
    // 装饰只落在起始段
    const rendered = PARAGRAPHS.map((text, idx) =>
      segmentParagraph(text, paragraphDecorationAnnotations(idx, text.length, PARAGRAPHS.length, [inverted])),
    )
    expect(rendered[0]).toEqual([{ text: PARAGRAPHS[0], annotation: null }])
    expect(rendered[1]).toEqual([{ text: PARAGRAPHS[1], annotation: null }])
    expect(rendered[2]).toEqual([
      { text: "第", annotation: null },
      { text: "三段文", annotation: expect.objectContaining({ id: "ann-inverted" }) },
      { text: "字内容。", annotation: null },
    ])
    // 执行 prompt 不输出 end_paragraph_index（倒挂按单段处理）
    const prompt = formatExecutionPrompt({
      roundID: "round-1",
      chapterID: "ch-1",
      chapterTitle: "第一章",
      paragraphs: PARAGRAPHS,
      annotations: [{ ...inverted, status: "resolved" as const, suggestedReplacement: null }],
    })
    expect(prompt).not.toContain("end_paragraph_index")
  })

  test("结束段索引远超段落数时 prompt 不报错", () => {
    const prompt = formatExecutionPrompt({
      roundID: "round-1",
      chapterID: "ch-1",
      chapterTitle: "第一章",
      paragraphs: ["唯一一段"],
      annotations: [{
        id: "ann-beyond",
        status: "resolved" as const,
        paragraphIndex: 0,
        startOffset: 0,
        endOffset: 2,
        endParagraphIndex: 99,
        quote: "引用",
        comment: "评论",
        suggestedReplacement: null,
      }],
    })
    expect(prompt).toContain("- end_paragraph_index: 100")
  })
})
