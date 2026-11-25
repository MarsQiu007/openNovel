/**
 * 书籍导入确定性清洗（book-import）：规范化规则 + 段落重组（reflow），逐项计数供预览摘要。
 *
 * 规则顺序：行空白裁剪（trim 前记录段首缩进标记）→ 空行折叠 → 全半角标点归一 →
 * 逐行机械重复清除 → 广告行清除 → 段落重组。去重与广告必须先于重组执行
 * （否则短行被并进前段后特征丢失）；候选标题行与场景分隔线不合并也不被并入，
 * 防章题在章题识别前被并入正文。重组依据段落信号：段首缩进与空行为首要判据，
 * 句末标点与右引号为辅助判据；仅当信号占比落在有效区间才启用「段内句间聚合」，
 * 避免把无信号书并成一段、或把诗歌/剧本等逐行版式误判。纯函数无 IO。
 */
import { looksLikeHeadingLine } from "./structure"

export interface CleanSummary {
  whitespaceTrimmed: number
  blankLinesCollapsed: number
  punctuationNormalized: number
  linesMerged: number
  adsRemoved: number
  duplicatesRemoved: number
}

/** 保守半角→全角映射：不含引号（开闭歧义）与小数点/省略号场景的点号。 */
const HALF_TO_FULL: Record<string, string> = {
  ",": "，",
  ";": "；",
  "!": "！",
  "?": "？",
  ":": "：",
  "(": "（",
  ")": "）",
}

/** 行级广告/站点噪声特征（限短行命中，避免误伤正文提及）。 */
const AD_LINE_PATTERN =
  /最新网址|请记住本书|笔趣阁|顶点小说|章节目录|收藏本站|手机用户|请下载|APP阅读|app阅读|本章完|小说网|无弹窗|免费阅读|更新最快|章节内容慢|屏蔽广告|浏览器设置|设置护眼|搜书吧/

/** 网址行特征（限短行命中）：书源站广告常见形态。 */
const AD_URL_PATTERN = /(https?:\/\/|www\.|[a-z0-9-]+\.(?:com|cn|net|cc|io|me|tv|xyz|top|vip)\b)/i
const AD_LINE_MAX_LENGTH = 40

/** 句末判定：右引号由对话段保护规则先行拦截，不在此集合。 */
const SENTENCE_ENDING = /[。！？…》）]$/

/** 对话段保护：以右引号结尾的行为完整段落，不与下一行合并。 */
const RIGHT_QUOTE_ENDING = /[”’」』]$/

/** 场景分隔线：独占一行的装饰分隔，自身独立成段且作为拆分边界。 */
const SCENE_BREAK = /^[-=*~～—_]{3,}$/

/** 段落信号有效区间（占非空行/含空行比例）：过低不足为据，过高多为诗歌/剧本逐行版式。 */
const SIGNAL_RATIO_MIN = 0.15
const SIGNAL_RATIO_MAX = 0.75

interface CleanLine {
  text: string
  /** trim 前行首空白宽度 ≥2（半角空格计 1，tab 与全角空格计 2） */
  indented: boolean
}

function leadingIndentWidth(line: string): number {
  const leading = line.match(/^[ \t　]*/)?.[0] ?? ""
  let width = 0
  for (const ch of leading) width += ch === " " ? 1 : 2
  return width
}

/** 段落合并连接：前行尾与后行首均为 ASCII 字母/数字时补单个空格（防英文粘词），中文空串直连。 */
function joinParagraphLines(previous: string, line: string): string {
  if (/[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(line)) return `${previous} ${line}`
  return previous + line
}

/** 合并决策：标题行与场景分隔线双向保护；缩进新段；右引号对话段保护；句内断行合并；段内句间聚合受护栏控制。 */
function shouldMerge(previous: CleanLine, line: CleanLine, sentenceGapMergeEnabled: boolean): boolean {
  if (looksLikeHeadingLine(previous.text) || looksLikeHeadingLine(line.text)) return false
  if (SCENE_BREAK.test(previous.text) || SCENE_BREAK.test(line.text)) return false
  if (line.indented) return false
  if (RIGHT_QUOTE_ENDING.test(previous.text)) return false
  if (!SENTENCE_ENDING.test(previous.text)) return true
  return sentenceGapMergeEnabled
}

export function cleanText(raw: string): { text: string; summary: CleanSummary } {
  const summary: CleanSummary = {
    whitespaceTrimmed: 0,
    blankLinesCollapsed: 0,
    punctuationNormalized: 0,
    linesMerged: 0,
    adsRemoved: 0,
    duplicatesRemoved: 0,
  }

  const lines: CleanLine[] = raw.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (trimmed.length !== line.length) summary.whitespaceTrimmed++
    return { text: trimmed, indented: leadingIndentWidth(line) >= 2 }
  })

  const collapsed: CleanLine[] = []
  for (const line of lines) {
    if (line.text.length === 0 && collapsed[collapsed.length - 1]?.text === "") {
      summary.blankLinesCollapsed++
      continue
    }
    collapsed.push(line)
  }
  while (collapsed.length > 0 && collapsed[0].text === "") collapsed.shift()
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].text === "") collapsed.pop()

  const normalized = collapsed.map((line) => {
    let out = ""
    let replaced = 0
    for (const char of line.text) {
      const target = HALF_TO_FULL[char]
      if (target === undefined) out += char
      else {
        out += target
        replaced++
      }
    }
    summary.punctuationNormalized += replaced
    return { text: out, indented: line.indented }
  })

  const deduped: CleanLine[] = []
  let lastKept = ""
  for (const line of normalized) {
    if (line.text !== "" && line.text === lastKept) {
      summary.duplicatesRemoved++
      continue
    }
    deduped.push(line)
    if (line.text !== "") lastKept = line.text
  }

  const withoutAds = deduped.filter((line) => {
    if (
      line.text.length > 0 &&
      line.text.length <= AD_LINE_MAX_LENGTH &&
      (AD_LINE_PATTERN.test(line.text) || AD_URL_PATTERN.test(line.text))
    ) {
      summary.adsRemoved++
      return false
    }
    return true
  })

  // 段落信号统计（合并前）：缩进占比与空行占比任一落在有效区间，即启用段内句间聚合
  const contentCount = withoutAds.filter((line) => line.text.length > 0).length
  const indentedCount = withoutAds.filter((line) => line.text.length > 0 && line.indented).length
  const blankCount = withoutAds.length - contentCount
  const inRange = (ratio: number) => ratio >= SIGNAL_RATIO_MIN && ratio <= SIGNAL_RATIO_MAX
  const sentenceGapMergeEnabled =
    contentCount > 0 && (inRange(indentedCount / contentCount) || inRange(blankCount / contentCount))

  const merged: CleanLine[] = []
  for (const line of withoutAds) {
    const previous = merged[merged.length - 1]
    if (previous === undefined || previous.text === "" || line.text === "" || !shouldMerge(previous, line, sentenceGapMergeEnabled)) {
      merged.push(line)
      continue
    }
    merged[merged.length - 1] = { text: joinParagraphLines(previous.text, line.text), indented: previous.indented }
    summary.linesMerged++
  }

  return { text: merged.map((line) => line.text).join("\n"), summary }
}

export function emptyCleanSummary(): CleanSummary {
  return {
    whitespaceTrimmed: 0,
    blankLinesCollapsed: 0,
    punctuationNormalized: 0,
    linesMerged: 0,
    adsRemoved: 0,
    duplicatesRemoved: 0,
  }
}