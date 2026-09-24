/**
 * 阅读页面批注工具 — 纯函数
 *
 * 负责段落分段渲染、选区偏移量计算、区间重叠检测。
 * 偏移计算只依赖 Node 接口（nodeType / textContent / childNodes），测试中可用手工对象模拟。
 */

export type AnnotationLike = {
  id: string
  status: string
  paragraphIndex?: number | null | undefined
  startOffset?: number | null | undefined
  endOffset?: number | null | undefined
  endParagraphIndex?: number | null | undefined
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

/** (段落索引, 段内偏移) 字典序坐标构成的半开区间 */
export type AnchorInterval = {
  startParagraph: number
  start: number
  endParagraph: number
  end: number
}

/**
 * 把批注锚点归一化为字典序半开区间。
 * endParagraphIndex 为空或等于 paragraphIndex 时按单段处理；
 * 区间倒挂（结束段落小于起始段落）时退化到起始段单段（失稳语义，不报错）。
 * 锚点字段不完整时返回 null。
 */
export function annotationInterval(a: {
  paragraphIndex?: number | null | undefined
  startOffset?: number | null | undefined
  endOffset?: number | null | undefined
  endParagraphIndex?: number | null | undefined
}): AnchorInterval | null {
  if (a.paragraphIndex == null || a.startOffset == null || a.endOffset == null) return null
  const endParagraph = a.endParagraphIndex ?? a.paragraphIndex
  if (endParagraph < a.paragraphIndex) {
    return { startParagraph: a.paragraphIndex, start: a.startOffset, endParagraph: a.paragraphIndex, end: a.endOffset }
  }
  return { startParagraph: a.paragraphIndex, start: a.startOffset, endParagraph, end: a.endOffset }
}

/**
 * 计算单个段落上的有效批注装饰锚点（chapter-reader 与 world-reader 共用）。
 * 跨段批注按段落区间展开：起始段从 startOffset 到段尾、中间段整段、结束段从段首到 endOffset。
 * 结束段落索引越界时钳制到末段（失稳语义，不阻塞渲染）；
 * 段内偏移越界由 segmentParagraph 钳制到段长。
 */
export function paragraphDecorationAnnotations(
  paragraphIndex: number,
  paragraphLength: number,
  paragraphCount: number,
  annotations: readonly AnnotationLike[],
): AnnotationLike[] {
  const result: AnnotationLike[] = []
  for (const ann of annotations) {
    const interval = annotationInterval(ann)
    if (!interval) continue
    // 结束段被钳制时，钳制段装饰到段尾而不是原结束段偏移（原偏移对钳制段无意义）
    const clampedEnd = interval.endParagraph > paragraphCount - 1
    const endParagraph = clampedEnd ? paragraphCount - 1 : interval.endParagraph
    if (paragraphIndex < interval.startParagraph || paragraphIndex > endParagraph) continue
    result.push({
      ...ann,
      startOffset: paragraphIndex === interval.startParagraph ? interval.start : 0,
      endOffset: paragraphIndex === endParagraph && !clampedEnd ? interval.end : paragraphLength,
    })
  }
  return result
}

function compareAnchorPoint(aParagraph: number, aOffset: number, bParagraph: number, bOffset: number): number {
  if (aParagraph !== bParagraph) return aParagraph - bParagraph
  return aOffset - bOffset
}

/**
 * 检查两个 (段落索引, 段内偏移) 字典序半开区间是否重叠。
 * 边界相邻（一端终点恰好等于另一端起点）不算重叠。
 */
export function hasOverlap(a: AnchorInterval, b: AnchorInterval): boolean {
  return (
    compareAnchorPoint(b.startParagraph, b.start, a.endParagraph, a.end) < 0
    && compareAnchorPoint(a.startParagraph, a.start, b.endParagraph, b.end) < 0
  )
}

/**
 * 批注段落位置标签（从 1 起始的展示值）。
 * 单段返回 "3"，跨段返回 "1-3"，paragraphIndex 为空时返回 null；
 * 结束段落小于起始段落（倒挂）时按单段处理。
 */
export function annotationParagraphRangeLabel(a: {
  paragraphIndex?: number | null | undefined
  endParagraphIndex?: number | null | undefined
}): string | null {
  if (a.paragraphIndex == null) return null
  const start = a.paragraphIndex + 1
  const endIndex = a.endParagraphIndex ?? a.paragraphIndex
  const end = Math.max(endIndex, a.paragraphIndex) + 1
  if (end === start) return `${start}`
  return `${start}\u2013${end}`
}

// nodeType 常量：与 DOM Node.TEXT_NODE / Node.ELEMENT_NODE 相同，
// 这里用字面量以便测试用手工对象模拟节点。
const TEXT_NODE = 3

/**
 * 从 Range 边界节点向上找到带 data-paragraph-index 的段落元素。
 * 文本节点取父元素链，元素节点包含自身（选区端点落在 <p> 元素本身时也能命中）。
 */
export function closestParagraphElement(node: Node): HTMLElement | null {
  const el = node.nodeType === TEXT_NODE ? node.parentElement : (node as HTMLElement)
  return el?.closest<HTMLElement>("[data-paragraph-index]") ?? null
}

/**
 * 累加容器内位于边界点之前的文本长度。
 * 同时处理文本节点边界（offset 为字符偏移）与元素节点边界（offset 为子节点索引，
 * 选区终点恰好落在段落开头时浏览器可能给出后者，此时结果为 0）。
 * 只依赖 Node 接口，测试中可用手工对象模拟；边界不在容器子树内时返回 -1。
 */
function textOffsetBefore(container: Node, boundary: Node, boundaryOffset: number): number {
  let offset = 0
  const walk = (node: Node): boolean => {
    if (node === boundary) {
      if (node.nodeType === TEXT_NODE) {
        offset += Math.min(boundaryOffset, node.textContent?.length ?? 0)
      } else {
        const children = Array.from(node.childNodes)
        for (let i = 0; i < boundaryOffset && i < children.length; i++) {
          offset += children[i]?.textContent?.length ?? 0
        }
      }
      return true
    }
    if (node.nodeType === TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }
  return walk(container) ? offset : -1
}

/**
 * 从浏览器 Selection 提取批注锚点结构。
 * container / containerIndex 为选区起点所在段落 <p> 元素及其索引；
 * 跨段选区时额外传入终点段落 endContainer / endContainerIndex（索引不同才视为跨段）。
 * 单段选区行为与既有版本一致：startOffset / endOffset 均为该段内偏移，不输出 endParagraphIndex。
 */
export function getSelectionAnchor(
  container: Element,
  containerIndex: number,
  selection: Selection,
  endContainer?: Element,
  endContainerIndex?: number,
): {
  anchorType: "range"
  paragraphIndex: number
  startOffset: number
  endOffset: number
  endParagraphIndex?: number
  quote: string
} {
  const range = selection.getRangeAt(0)
  const startLength = container.textContent?.length ?? 0
  const rawStart = textOffsetBefore(container, range.startContainer, range.startOffset)
  const startOffset = rawStart < 0 ? 0 : Math.min(rawStart, startLength)

  if (endContainer == null || endContainerIndex == null || endContainerIndex === containerIndex) {
    const rawEnd = textOffsetBefore(container, range.endContainer, range.endOffset)
    const endOffset = rawEnd < 0 ? startLength : Math.min(rawEnd, startLength)
    return {
      anchorType: "range",
      paragraphIndex: containerIndex,
      startOffset,
      endOffset,
      quote: selection.toString(),
    }
  }

  const endLength = endContainer.textContent?.length ?? 0
  const rawEnd = textOffsetBefore(endContainer, range.endContainer, range.endOffset)
  const endOffset = rawEnd < 0 ? endLength : Math.min(rawEnd, endLength)
  return {
    anchorType: "range",
    paragraphIndex: containerIndex,
    startOffset,
    endOffset,
    endParagraphIndex: endContainerIndex,
    quote: selection.toString(),
  }
}