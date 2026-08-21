/**
 * 段落批注与润色 — 纯逻辑模块
 *
 * 负责段落切分、quote 校验、批注锚点定位和润色建议状态转换。
 * 不访问数据库，不依赖 LLM。
 */

export type AnnotationStatus = "open" | "resolved" | "wontfix" | "applied"

export type AnnotationAnchor = {
  paragraphIndex: number | null
  startOffset: number | null
  endOffset: number | null
  quote: string
}

export type StaleResult = {
  stale: boolean
  reason?: "paragraph_missing" | "quote_mismatch"
  actualQuote?: string
}

/**
 * 按双换行切分段落，保留段落索引。
 */
export function splitParagraphs(content: string): string[] {
  if (!content) return []
  return content.split(/\r?\n\r?\n/).map((p) => p.trim())
}

/**
 * 校验批注锚点：段落索引是否存在，quote 是否与段落内容匹配。
 *
 * 返回 stale 状态供前端显示但不自动删除批注。
 */
export function validateAnchor(content: string, anchor: AnnotationAnchor): StaleResult {
  const paragraphs = splitParagraphs(content)
  if (anchor.paragraphIndex == null) {
    return anchor.quote ? { stale: false } : { stale: false }
  }
  if (anchor.paragraphIndex < 0 || anchor.paragraphIndex >= paragraphs.length) {
    return { stale: true, reason: "paragraph_missing" }
  }
  const paragraph = paragraphs[anchor.paragraphIndex]
  if (!anchor.quote) return { stale: false }
  if (anchor.startOffset != null && anchor.endOffset != null) {
    const slice = paragraph.slice(anchor.startOffset, anchor.endOffset)
    if (slice === anchor.quote) return { stale: false }
    return { stale: true, reason: "quote_mismatch", actualQuote: slice }
  }
  if (paragraph.includes(anchor.quote)) return { stale: false }
  return { stale: true, reason: "quote_mismatch", actualQuote: paragraph }
}

/**
 * 合法的批注状态转换。
 */
const VALID_TRANSITIONS: Record<AnnotationStatus, AnnotationStatus[]> = {
  open: ["resolved", "wontfix", "applied"],
  resolved: ["open"],
  wontfix: ["open"],
  applied: [],
}

/**
 * 检查状态转换是否合法。
 */
export function canTransition(from: AnnotationStatus, to: AnnotationStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * 润色建议只有在 open 状态且带 suggested_replacement 时才能采纳。
 */
export function canApplyAnnotation(ann: {
  status: AnnotationStatus
  suggested_replacement: string | null
}): boolean {
  return ann.status === "open" && ann.suggested_replacement != null && ann.suggested_replacement !== ""
}

/**
 * 将润色建议应用到章节内容。
 * 返回新的章节内容；如果锚点无效则返回 null。
 */
export function applySuggestion(
  content: string,
  anchor: AnnotationAnchor,
  replacement: string,
): string | null {
  const validation = validateAnchor(content, anchor)
  if (validation.stale) return null
  const paragraphs = splitParagraphs(content)
  if (anchor.paragraphIndex == null) return null
  const idx = anchor.paragraphIndex
  if (anchor.startOffset != null && anchor.endOffset != null) {
    const original = paragraphs[idx]
    paragraphs[idx] = original.slice(0, anchor.startOffset) + replacement + original.slice(anchor.endOffset)
  } else if (anchor.quote) {
    paragraphs[idx] = paragraphs[idx].replace(anchor.quote, replacement)
  } else {
    paragraphs[idx] = replacement
  }
  return paragraphs.join("\n\n")
}