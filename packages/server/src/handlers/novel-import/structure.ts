/**
 * 书籍导入结构解析（book-import）：卷/章题模式族识别与卷章树构建。
 *
 * 纯函数无 IO。章题覆盖「第N章/回/节」「Chapter N」与序章/楔子/前言/尾声/番外，
 * 卷题覆盖「第N卷/部」「卷N」「Volume N」；N 支持阿拉伯数字（含全角）与中文数字。
 * 候选标题行须满足行独占性（去空白 ≤40 字符且不含句读标点），防正文误切。
 */

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

function toHalfWidthDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

/** 解析十百千段的数值（不含万级），如「一百二十三」→ 123、「十」→ 10。 */
function parseSegment(segment: string): number | null {
  let total = 0
  let section = 0
  for (const ch of segment) {
    const digit = CHINESE_DIGITS[ch]
    const unit = CHINESE_UNITS[ch]
    if (digit !== undefined) {
      section = digit
      continue
    }
    if (unit !== undefined) {
      section = (section === 0 ? 1 : section) * unit
      total += section
      section = 0
      continue
    }
    return null
  }
  return total + section
}

/** 阿拉伯（含全角）或中文数字 → 整数；无法解析返回 null。 */
export function parseChapterNumber(raw: string): number | null {
  const text = toHalfWidthDigits(raw)
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10)
  if (!/^[零一二两三四五六七八九十百千万]+$/.test(text)) return null
  const wanIndex = text.indexOf("万")
  if (wanIndex >= 0) {
    const high = parseSegment(text.slice(0, wanIndex))
    const low = parseSegment(text.slice(wanIndex + 1))
    if (high === null || low === null) return null
    return high * 10000 + low
  }
  return parseSegment(text)
}

/** 句读标点：标题行不得包含（正文行必然包含其一的概率极高），「：」因常作章题分隔符放行。 */
const PROSE_PUNCTUATION = /[。！？；，、…]/
const HEADING_MAX_LENGTH = 40

const NUMBER_SOURCE = "([0-9０-９]+|[零一二两三四五六七八九十百千万]+)"
const CHAPTER_HEADING = new RegExp(`^第${NUMBER_SOURCE}[章回节]\\s*[：:、.．\\-—]?\\s*(.*)$`)
const CHAPTER_HEADING_EN = /^[Cc]hapter\s+([0-9]+)\s*[.、．\-—]?\s*(.*)$/
const VOLUME_HEADING = new RegExp(`^第${NUMBER_SOURCE}[卷部]\\s*[：:、.．\\-—]?\\s*(.*)$`)
const VOLUME_HEADING_BARE = new RegExp(`^卷\\s*${NUMBER_SOURCE}\\s*[：:、.．\\-—]?\\s*(.*)$`)
const VOLUME_HEADING_EN = /^Volume\s+([0-9]+)\s*[.、．\-—]?\s*(.*)$/i
const PROLOGUE_HEADING = /^(序章|序言|楔子|前言|引言|序)$/
const EPILOGUE_HEADING = /^(尾声|后记|完结篇)$/
const EXTRA_HEADING = /^番外(?:篇|章|章节)?\s*[：:、.．]?\s*(.*)$/

export type HeadingMatch =
  | { kind: "volume"; number: number | null; title: string }
  | { kind: "chapter"; number: number | null; title: string; special: "prologue" | "epilogue" | "extra" | null }

/** 匹配单行是否为卷/章标题（入参须已 trim）。 */
export function matchHeading(trimmed: string): HeadingMatch | null {
  if (PROLOGUE_HEADING.test(trimmed)) return { kind: "chapter", number: null, title: trimmed, special: "prologue" }
  if (EPILOGUE_HEADING.test(trimmed)) return { kind: "chapter", number: null, title: trimmed, special: "epilogue" }
  const extra = EXTRA_HEADING.exec(trimmed)
  if (extra) return { kind: "chapter", number: null, title: trimmed, special: "extra" }
  const volume = VOLUME_HEADING.exec(trimmed) ?? VOLUME_HEADING_BARE.exec(trimmed) ?? VOLUME_HEADING_EN.exec(trimmed)
  if (volume) {
    return { kind: "volume", number: parseChapterNumber(volume[1] ?? ""), title: trimmed }
  }
  const chapter = CHAPTER_HEADING.exec(trimmed) ?? CHAPTER_HEADING_EN.exec(trimmed)
  if (chapter) {
    return { kind: "chapter", number: parseChapterNumber(chapter[1] ?? ""), title: trimmed, special: null }
  }
  return null
}

/** 行独占性校验：候选行去空白 ≤40 字符、不含句读标点且能命中模式。 */
export function looksLikeHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_LENGTH) return false
  if (PROSE_PUNCTUATION.test(trimmed)) return false
  return matchHeading(trimmed) !== null
}

export interface ParsedChapter {
  title: string
  content: string
  special: "prologue" | "epilogue" | "extra" | null
  /** 题面解析出的章号（特殊章与无法解析时为 null） */
  number: number | null
}

export interface ParsedVolume {
  /** 卷标题；无卷题文件为 null（默认单卷） */
  title: string | null
  chapters: ParsedChapter[]
}

export interface ParsedStructure {
  volumes: ParsedVolume[]
  issues: { type: "sequence-gap" | "duplicate-number" | "order-mismatch" | "unrecognized-boundary"; message: string; chapterNumber?: number }[]
  /** 命中章题数；为 0 表示未识别到章节边界 */
  chapterHeadingCount: number
}

interface HeadingIndex {
  lineIndex: number
  match: HeadingMatch
}

/** 拆分卷章结构；无章节边界时 issues 携带 unrecognized-boundary 且 volumes 为空。 */
export function parseStructure(text: string): ParsedStructure {
  const lines = text.split(/\r?\n/)
  const headings: HeadingIndex[] = []
  lines.forEach((line, index) => {
    if (!looksLikeHeadingLine(line)) return
    const match = matchHeading(line.trim())
    if (match) headings.push({ lineIndex: index, match })
  })
  const chapterHeadings = headings.filter((heading) => heading.match.kind === "chapter")
  if (chapterHeadings.length === 0) {
    return {
      volumes: [],
      chapterHeadingCount: 0,
      issues: [{ type: "unrecognized-boundary", message: "未识别到章节边界" }],
    }
  }

  const volumes: ParsedVolume[] = []
  // 懒创建默认卷：首个卷题之前出现章题时才需要它
  const currentVolume = () => {
    if (volumes.length === 0) volumes.push({ title: null, chapters: [] })
    return volumes[volumes.length - 1]!
  }
  const issues: ParsedStructure["issues"] = []
  const chapterNumbers: { number: number; lineIndex: number }[] = []

  headings.forEach((heading, position) => {
    if (heading.match.kind === "volume") {
      volumes.push({ title: heading.match.title, chapters: [] })
      return
    }
    const next = headings[position + 1]
    const body = lines.slice(heading.lineIndex + 1, next?.lineIndex ?? lines.length)
    const content = trimBlankEdges(body).join("\n")
    const chapter: ParsedChapter = {
      title: heading.match.title,
      content,
      special: heading.match.special,
      number: heading.match.number,
    }
    currentVolume().chapters.push(chapter)
    if (heading.match.number !== null) chapterNumbers.push({ number: heading.match.number, lineIndex: heading.lineIndex })
  })

  // 首个章题前的卷前言并入第一章，避免内容丢失
  const preamble = trimBlankEdges(lines.slice(0, headings[0]!.lineIndex))
  if (preamble.length > 0 && volumes.length > 0) {
    const first = volumes.find((volume) => volume.chapters.length > 0)?.chapters[0]
    if (first) {
      first.content = [preamble.join("\n"), first.content].filter((part) => part.length > 0).join("\n\n")
    }
  }

  for (let index = 1; index < chapterNumbers.length; index++) {
    const previous = chapterNumbers[index - 1]!
    const current = chapterNumbers[index]!
    if (current.number === previous.number) {
      issues.push({ type: "duplicate-number", message: `第 ${current.number} 章编号重复`, chapterNumber: current.number })
      continue
    }
    if (current.number < previous.number) {
      issues.push({ type: "order-mismatch", message: `第 ${current.number} 章排在第 ${previous.number} 章之前`, chapterNumber: current.number })
      continue
    }
    if (current.number > previous.number + 1) {
      issues.push({ type: "sequence-gap", message: `第 ${previous.number} 章后跳至第 ${current.number} 章`, chapterNumber: current.number })
    }
  }

  return { volumes, issues, chapterHeadingCount: chapterHeadings.length }
}

function trimBlankEdges(lines: string[]): string[] {
  const start = lines.findIndex((line) => line.trim().length > 0)
  if (start === -1) return []
  let end = lines.length
  while (end > start && lines[end - 1]!.trim().length === 0) end--
  return lines.slice(start, end)
}

/** 未识别章节边界时的显式兜底：按固定字数等长分章（默认 3000 字/章）。 */
export function splitFixedLength(text: string, size = 3000): ParsedVolume[] {
  const body = text.trim()
  if (body.length === 0) return [{ title: null, chapters: [] }]
  const chapters: ParsedChapter[] = []
  for (let start = 0; start < body.length; start += size) {
    const index = chapters.length + 1
    chapters.push({
      title: `第${index}部分`,
      content: body.slice(start, start + size),
      special: null,
      number: index,
    })
  }
  return [{ title: null, chapters }]
}
