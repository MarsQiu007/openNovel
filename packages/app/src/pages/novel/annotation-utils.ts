/**
 * 阅读页面批注工具 — 纯函数
 *
 * 负责段落分段渲染、选区偏移量计算、区间重叠检测。
 * 不依赖 DOM（偏移计算通过容器 textContent 长度做 mock 兜底）。
 */

export type AnnotationLike = {
  id: string
  status: string
  paragraphIndex?: number | null | undefined
  startOffset?: number | null | undefined
  endOffset?: number | null | undefined
  quote: string
  comment: string
}

export type ParagraphSegment = {
  text: string
  annotation: AnnotationLike | null
}

/**
 * 将段落纯文本和该段落的批注列表合并为渲染片段数组。
 * 无批注时返回单元素纯文本片段；有批注时按偏移量切分并标记。
 */
export function segmentParagraph(text: string, annotations: readonly AnnotationLike[]): ParagraphSegment[] {
  if (annotations.length === 0 || !text) return [{ text, annotation: null }]

  const sorted = [...annotations]
    .filter((a) => a.startOffset != null && a.endOffset != null && a.startOffset < a.endOffset)
    .sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0))

  if (sorted.length === 0) return [{ text, annotation: null }]

  const segments: ParagraphSegment[] = []
  let cursor = 0

  for (const ann of sorted) {
    const start = ann.startOffset ?? 0
    const end = Math.min(ann.endOffset ?? text.length, text.length)
    if (start < cursor) continue // 跳过与前一个批注重叠的（安全兜底）
    if (start > cursor) segments.push({ text: text.slice(cursor, start), annotation: null })
    segments.push({ text: text.slice(start, end), annotation: ann })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), annotation: null })

  return segments
}

/**
 * 检查两个区间是否重叠（半开区间 [start, end)）。
 */
export function hasOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * 从 DOM Range 计算段内纯文本偏移量。
 * 遍历 container 内的文本节点，累加 Range 起点之前的文本长度得到 startOffset，
 * 同理得到 endOffset。跨段选区时 endOffset 截取到 container 文本末尾。
 */
export function computeTextOffsets(container: Element, range: Range): { start: number; end: number } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let start = -1
  let end = -1
  let offset = 0

  while (walker.nextNode()) {
    const node = walker.currentNode
    const len = node.textContent?.length ?? 0

    if (node === range.startContainer) start = offset + range.startOffset
    if (node === range.endContainer) end = offset + range.endOffset

    if (start < 0 && range.comparePoint(node, 0) === -1) {
      // node 在 range 前面
    }
    offset += len

    if (start >= 0 && end >= 0) break
  }

  if (start < 0) start = 0
  if (end < 0) end = container.textContent?.length ?? 0
  return { start, end }
}

/**
 * 从浏览器 Selection 提取批注锚点结构。
 * 需要 container 是段落 <p> 元素，selection 的 Range 需在 container 内。
 * 跨段选区时 endOffset 截取到该段末尾。
 */
export function getSelectionAnchor(
  container: Element,
  containerIndex: number,
  selection: Selection,
): {
  anchorType: "range"
  paragraphIndex: number
  startOffset: number
  endOffset: number
  quote: string
} {
  const range = selection.getRangeAt(0)
  const { start, end } = computeTextOffsets(container, range)
  const textLength = container.textContent?.length ?? 0
  const endClamped = Math.min(end, textLength)
  return {
    anchorType: "range",
    paragraphIndex: containerIndex,
    startOffset: start,
    endOffset: endClamped,
    quote: selection.toString(),
  }
}