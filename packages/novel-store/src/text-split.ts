/**
 * 章节文本切分原语（narrative-unit-split 任务 2.3）。
 *
 * 句末标点集合与引号配对为「句流切分」的单一事实源：server 的导入结构解析
 * （novel-import/structure.ts）与 plugin 的 AI 组章执行器共用同一实现，
 * 保证规则粗切与 LLM 组章对「句末 + 引号闭合」的判定完全一致。
 */

/** 句末切点字符：句末标点与右引号（对话结束）。 */
export const SENTENCE_CUT_CHARS = new Set(["。", "！", "？", "…", "》", "）", "”", "’", "」", "』"])

export const QUOTE_PAIRS: [string, string][] = [
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
]

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
  const balances = QUOTE_PAIRS.map(() => 0)
  let lastCut: number | null = null
  for (let index = chapterStart; index < to; index++) {
    const char = body[index]
    for (let pair = 0; pair < QUOTE_PAIRS.length; pair++) {
      if (char === QUOTE_PAIRS[pair][0]) balances[pair]++
      if (char === QUOTE_PAIRS[pair][1]) balances[pair]--
    }
    if (index + 1 < from || !SENTENCE_CUT_CHARS.has(char)) continue
    if (!balances.every((balance) => balance === 0)) continue
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
  const balances = QUOTE_PAIRS.map(() => 0)
  for (let index = start; index < end; index++) {
    const char = text[index]
    for (let pair = 0; pair < QUOTE_PAIRS.length; pair++) {
      if (char === QUOTE_PAIRS[pair][0]) balances[pair]++
      if (char === QUOTE_PAIRS[pair][1]) balances[pair]--
    }
  }
  return balances.every((balance) => balance === 0)
}