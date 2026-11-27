/**
 * 卷/章标题行检测原语（narrative-unit-split 任务 2.4 下沉）。
 *
 * 章题模式族识别的单一事实源：server 的导入结构解析（novel-import/structure.ts）
 * 与 plugin 的 AI 组章执行器共用同一实现——执行器以章题行为强边界组窗口，
 * 保证「完整连续章题」判定与快速拆章完全一致。
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

/** 行独占性校验 + 模式命中：候选行去空白 ≤40 字符、不含句读标点且能命中模式时返回卷/章匹配结果。 */
export function matchHeadingLine(line: string): HeadingMatch | null {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_LENGTH) return null
  if (PROSE_PUNCTUATION.test(trimmed)) return null
  return matchHeading(trimmed)
}

/** 行独占性校验：候选行去空白 ≤40 字符、不含句读标点且能命中模式。 */
export function looksLikeHeadingLine(line: string): boolean {
  return matchHeadingLine(line) !== null
}
