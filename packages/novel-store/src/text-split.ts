/**
 * 章节文本切分原语（narrative-unit-split 任务 2.3）。
 *
 * 句末标点集合与引号配对为「句流切分」的单一事实源：server 的导入结构解析
 * （novel-import/structure.ts）与 plugin 的 AI 组章执行器共用同一实现，
 * 保证规则粗切与 LLM 组章对「句末 + 引号闭合」的判定完全一致。
 */

/** 句末切点字符：句末标点与右引号（对话结束）。 */
export const SENTENCE_CUT_CHARS = new Set(["。", "！", "？", "…", "》", "）", "”", "’", "」", "』", '"', "＂"])

/** 异形引号对（开闭不同字符）：计数配平。 */
export const QUOTE_PAIRS: [string, string][] = [
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
  ["«", "»"],
  ["‹", "›"],
]

/** 同形直引号（开闭同字符）：无法用计数配平，用奇偶翻转判定。 */
export const STRAIGHT_QUOTES = new Set(['"', "'", "＂", "＇"])

/** 引号最长开放字符数：单句不可能超过 500 字，左引号开放超过该长度即判定为丢失右引号的错字并自动闭合。 */
export const QUOTE_MAX_OPEN_CHARS = 500

/**
 * 引号配平状态机：异形对计数 + 同形直引号奇偶翻转。
 * 配平从创建时（或上一平衡切点）起算；配对计数下限钳到 0——无左引号配对的
 * 孤儿右引号忽略不传染后续判定（容错采集重叠残段/缺左引号错字）；
 * 左引号开放超过 QUOTE_MAX_OPEN_CHARS 判定为丢失右引号的错字并自动闭合，
 * 引号内句末恢复切点资格；其余左引号未闭合（计数停正）仍判不平衡。
 */
export function makeQuoteTracker() {
  const balances = QUOTE_PAIRS.map(() => 0)
  const openedAt = QUOTE_PAIRS.map(() => -1)
  const straight = new Map<string, number>()
  let fed = 0
  return {
    feed(char: string) {
      fed++
      for (let pair = 0; pair < QUOTE_PAIRS.length; pair++) {
        if (char === QUOTE_PAIRS[pair][0]) balances[pair]++
        if (char === QUOTE_PAIRS[pair][1]) balances[pair] = Math.max(0, balances[pair] - 1)
        if (balances[pair] === 0) openedAt[pair] = -1
        else {
          if (openedAt[pair] < 0) openedAt[pair] = fed
          if (fed - openedAt[pair] >= QUOTE_MAX_OPEN_CHARS) {
            balances[pair] = 0
            openedAt[pair] = -1
          }
        }
      }
      if (STRAIGHT_QUOTES.has(char)) {
        if (straight.has(char)) straight.delete(char)
        else straight.set(char, fed)
      }
      for (const [quote, at] of straight) if (fed - at >= QUOTE_MAX_OPEN_CHARS) straight.delete(quote)
    },
    balanced() {
      return balances.every((balance) => balance === 0) && straight.size === 0
    },
  }
}

/**
 * [chapterStart, to) 内引号闭合的句末切点（切点在句末字符之后）；pick 控制取首个或最后一个。
 *
 * 引号配平从 chapterStart 起算：调用方以「上一处平衡切点」作为 chapterStart 传参即可
 * 保证跨句配平连续（切点只在全部配对归零处产生，故切点处配平恒为零）。
 */
export function findSentenceCut(
  body: string,
  chapterStart: number,
  from: number,
  to: number,
  pick: "first" | "last",
): number | null {
  const tracker = makeQuoteTracker()
  let lastCut: number | null = null
  for (let index = chapterStart; index < to; index++) {
    const char = body[index]
    tracker.feed(char)
    if (index + 1 < from || !SENTENCE_CUT_CHARS.has(char)) continue
    if (!tracker.balanced()) continue
    if (pick === "first") return index + 1
    lastCut = index + 1
  }
  return lastCut
}

/** countWords 口径的前缀字数表：prefix[i] = body[0..i) 的字数（CJK 逐字 + ASCII 词），与产品章节字数显示同口径。 */
export function buildWordPrefix(body: string): number[] {
  const prefix = Array.from({ length: body.length + 1 }, () => 0)
  let previousAlnum = false
  for (let index = 0; index < body.length; index++) {
    const char = body[index]
    const han = /\p{Script=Han}/u.test(char)
    const alnum = /[a-zA-Z0-9]/.test(char)
    prefix[index + 1] = prefix[index] + (han ? 1 : 0) + (alnum && !previousAlnum ? 1 : 0)
    previousAlnum = alnum
  }
  return prefix
}

/** 前缀字数表中第一个使 prefix[i] >= words 的位置（单调不减，二分）。 */
export function positionAtWords(prefix: number[], words: number, lo: number, hi: number): number {
  let low = lo
  let high = hi
  while (low < high) {
    const mid = (low + high) >> 1
    if (prefix[mid] < words) low = mid + 1
    else high = mid
  }
  return low
}

/** 句子跨度（archive 文本字符偏移，左闭右开）。 */
export interface SentenceSpan {
  readonly start: number
  readonly end: number
}

/**
 * 将文本切分为句流跨度（句末标点 + 引号闭合；无句末标点的尾部余量并入最后一句）。
 *
 * 组章执行器基于句流提取窗口与章文本：每个跨度以平衡切点收尾，
 * 因此「章末句 = 某跨度」天然满足切点硬校验（句末 + 引号闭合）。
 */
export function splitSentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  let start = 0
  while (start < text.length) {
    const cut = findSentenceCut(text, start, start + 1, text.length, "first")
    if (cut === null) {
      spans.push({ start, end: text.length })
      break
    }
    spans.push({ start, end: cut })
    start = cut
  }
  return spans
}

/** [start, end) 区间内三组引号是否全部闭合。 */
export function isQuoteBalanced(text: string, start: number, end: number): boolean {
  const tracker = makeQuoteTracker()
  for (let index = start; index < end; index++) tracker.feed(text[index])
  return tracker.balanced()
}