/**
 * 书籍导入结构解析（book-import）：卷/章题模式族识别与卷章树构建。
 *
 * 纯函数无 IO。章题覆盖「第N章/回/节」「Chapter N」与序章/楔子/前言/尾声/番外，
 * 卷题覆盖「第N卷/部」「卷N」「Volume N」；N 支持阿拉伯数字（含全角）与中文数字。
 * 候选标题行须满足行独占性（去空白 ≤40 字符且不含句读标点），防正文误切。
 */
import { type HeadingMatch, looksLikeHeadingLine, matchHeading } from "@opennovel-ai/novel-store/heading"
export { looksLikeHeadingLine, matchHeading, parseChapterNumber } from "@opennovel-ai/novel-store/heading"
import { buildWordPrefix, findSentenceCut, makeQuoteTracker, positionAtWords, SENTENCE_CUT_CHARS } from "@opennovel-ai/novel-store/text-split"

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
  issues: { type: "sequence-gap" | "duplicate-number" | "order-mismatch" | "unrecognized-boundary" | "forced-cut"; message: string; chapterNumber?: number }[]
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
    return volumes[volumes.length - 1]
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
  const preamble = trimBlankEdges(lines.slice(0, headings[0].lineIndex))
  if (preamble.length > 0 && volumes.length > 0) {
    const first = volumes.find((volume) => volume.chapters.length > 0)?.chapters[0]
    if (first) {
      first.content = [preamble.join("\n"), first.content].filter((part) => part.length > 0).join("\n\n")
    }
  }

  for (let index = 1; index < chapterNumbers.length; index++) {
    const previous = chapterNumbers[index - 1]
    const current = chapterNumbers[index]
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
  while (end > start && lines[end - 1].trim().length === 0) end--
  return lines.slice(start, end)
}

/** 兜底分章默认目标字数范围（design D2）。 */
export const DEFAULT_SPLIT_RANGE = { min: 2000, max: 3000 }

/**
 * 未识别章节边界时的边界感知兜底分章：在目标字数范围内按
 * 「场景分隔线/段落边界 > 引号闭合句末 > 受限兜底」选切点；只决定章节边界，不修改正文。
 */
export function splitByRange(
  text: string,
  range: { min: number; max: number } = DEFAULT_SPLIT_RANGE,
): { volumes: ParsedVolume[]; issues: ParsedStructure["issues"] } {
  const body = text.trim()
  if (body.length === 0) return { volumes: [{ title: null, chapters: [] }], issues: [] }

  // 字数口径与产品章节字数显示一致（countWords：CJK 逐字 + ASCII 词，不含标点空白）
  const prefix = buildWordPrefix(body)
  const totalWords = prefix[body.length]

  // 块间边界（候选切点）：reflow 后段落为单行、空行分段，切点取后续内容块的起点
  const boundaries: number[] = []
  let offset = 0
  let seenContent = false
  for (const line of body.split("\n")) {
    if (line.trim().length > 0) {
      if (seenContent) boundaries.push(offset)
      seenContent = true
    }
    offset += line.length + 1
  }

  const issues: ParsedStructure["issues"] = []
  const chapters: ParsedChapter[] = []
  const pushChapter = (content: string) => {
    const index = chapters.length + 1
    chapters.push({ title: `第${index}部分`, content: content.trim(), special: null, number: index })
  }

  // 全局均分：在 [ceil(W/max), floor(W/min)] 内取使每章字数最接近区间中值的章数，
  // 避免贪心切到末章只剩零头；无解（范围相对总字数过窄）时退化为最近章数并标注。
  const target = (range.min + range.max) / 2
  const nMin = Math.max(1, Math.ceil(totalWords / range.max))
  const nMax = Math.max(1, Math.floor(totalWords / range.min))
  let chapterCount = nMin
  if (nMin <= nMax) {
    let best = Number.POSITIVE_INFINITY
    for (let n = nMin; n <= nMax; n++) {
      const distance = Math.abs(totalWords / n - target)
      if (distance < best) {
        best = distance
        chapterCount = n
      }
    }
  } else {
    chapterCount = Math.max(1, Math.round(totalWords / target))
    issues.push({ type: "forced-cut", message: "总字数无法均分到目标范围，末章可能超出上限", chapterNumber: chapterCount })
  }

  let cur = 0
  for (let k = 1; k < chapterCount; k++) {
    const chapterBase = prefix[cur]
    // 动态均分目标：剩余字数 / 剩余章数——前章切点的偏差在后续章自动摊回，末章不吃过量误差
    const goal = chapterBase + (totalWords - chapterBase) / (chapterCount - k + 1)
    const windowStart = positionAtWords(prefix, chapterBase + range.min, cur, body.length)
    const windowEnd = positionAtWords(prefix, chapterBase + range.max, cur, body.length)
    // 切点可行性：切后剩余字数须能由剩余章数在目标范围内装下（防末章越界）
    const remainingChapters = chapterCount - k
    const feasibleLo = totalWords - remainingChapters * range.max
    const feasibleHi = totalWords - remainingChapters * range.min
    // 窗口内最接近动态均分目标的可行切点：段落边界优先，其次引号闭合句末；无可行切点再放宽
    const cut =
      nearestInRange(boundaries, prefix, goal, windowStart, windowEnd, feasibleLo, feasibleHi) ??
      nearestSentenceCut(body, cur, prefix, goal, windowStart, windowEnd, feasibleLo, feasibleHi) ??
      nearestInRange(boundaries, prefix, goal, windowStart, windowEnd) ??
      nearestSentenceCut(body, cur, prefix, goal, windowStart, windowEnd)
    if (cut !== null) {
      pushChapter(body.slice(cur, cut))
      cur = cut
      continue
    }
    // 受限兜底：硬上限（max + min/2，字数口径）内就近取第一个引号闭合句末，并标注问题清单
    const hardEnd = Math.min(positionAtWords(prefix, chapterBase + range.max + Math.floor(range.min / 2), cur, body.length), body.length)
    const extendedCut = findSentenceCut(body, cur, windowEnd, hardEnd, "first")
    if (extendedCut !== null) {
      pushChapter(body.slice(cur, extendedCut))
      issues.push({ type: "forced-cut", message: `第 ${chapters.length} 部分在目标范围外就近取句末切点`, chapterNumber: chapters.length })
      cur = extendedCut
      continue
    }
    pushChapter(body.slice(cur, windowEnd))
    issues.push({ type: "forced-cut", message: `第 ${chapters.length} 部分无合法切点，按上限硬切`, chapterNumber: chapters.length })
    cur = windowEnd
  }
  pushChapter(body.slice(cur))

  return { volumes: [{ title: null, chapters }], issues }
}

/** 候选位置中「prefix 字数最接近 goal」且字符位置落入 [from, to]、prefix 值落入可行区间的点。 */
function nearestInRange(
  candidates: number[],
  prefix: number[],
  goal: number,
  from: number,
  to: number,
  feasibleLo = Number.NEGATIVE_INFINITY,
  feasibleHi = Number.POSITIVE_INFINITY,
): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const position of candidates) {
    if (position < from) continue
    if (position > to) break
    if (prefix[position] < feasibleLo || prefix[position] > feasibleHi) continue
    const distance = Math.abs(prefix[position] - goal)
    if (distance < bestDistance) {
      bestDistance = distance
      best = position
    }
  }
  return best
}

/** [from, to] 内「prefix 字数最接近 goal」的引号闭合句末切点，prefix 值须落入可行区间。 */
function nearestSentenceCut(
  body: string,
  chapterStart: number,
  prefix: number[],
  goal: number,
  from: number,
  to: number,
  feasibleLo = Number.NEGATIVE_INFINITY,
  feasibleHi = Number.POSITIVE_INFINITY,
): number | null {
  const tracker = makeQuoteTracker()
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = chapterStart; index < to; index++) {
    const char = body[index]
    tracker.feed(char)
    if (index + 1 < from || !SENTENCE_CUT_CHARS.has(char)) continue
    if (!tracker.balanced()) continue
    if (prefix[index + 1] < feasibleLo || prefix[index + 1] > feasibleHi) continue
    const distance = Math.abs(prefix[index + 1] - goal)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index + 1
    }
  }
  return best
}
