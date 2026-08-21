export interface TextSegment {
  title: string
  text: string
  startOffset: number
  endOffset: number
}

export interface SegmentOptions {
  chunkSize?: number
  overlap?: number
}

export function segmentText(input: string, options?: SegmentOptions): TextSegment[] {
  const chunkSize = options?.chunkSize ?? 3000
  const overlap = options?.overlap ?? 500

  const chapterPattern = /^(第[一二三四五六七八九十百千\d]+[章卷节回]|Chapter\s+\d+)/gm
  const positions: { start: number; title: string }[] = []
  let match: RegExpExecArray | null

  while ((match = chapterPattern.exec(input)) !== null) {
    const lineEnd = input.indexOf("\n", match.index)
    const title =
      lineEnd === -1 ? input.slice(match.index, match.index + 50) : input.slice(match.index, lineEnd)
    positions.push({ start: match.index, title: title.trim() })
  }

  if (positions.length > 0) {
    const result: TextSegment[] = []
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].start
      const end = i + 1 < positions.length ? positions[i + 1].start : input.length
      const text = input.slice(start, end).trim()
      if (text.length > chunkSize) {
        result.push(...chunkSegment(text, positions[i].title, chunkSize, overlap, start))
      } else if (text.length > 0) {
        result.push({ title: positions[i].title, text, startOffset: start, endOffset: end })
      }
    }
    return result
  }

  return chunkSegment(input, "全文", chunkSize, overlap, 0)
}

function chunkSegment(
  text: string,
  title: string,
  chunkSize: number,
  overlap: number,
  baseOffset: number,
): TextSegment[] {
  const chunks: TextSegment[] = []
  let offset = 0
  let index = 0

  while (offset < text.length) {
    const end = Math.min(offset + chunkSize, text.length)
    chunks.push({
      title: `${title} [块${index + 1}]`,
      text: text.slice(offset, end),
      startOffset: baseOffset + offset,
      endOffset: baseOffset + end,
    })
    offset = end === text.length ? end : end - overlap
    index++
  }

  return chunks
}
