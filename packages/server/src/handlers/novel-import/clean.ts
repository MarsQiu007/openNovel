/**
 * 书籍导入确定性清洗（book-import）：六项可逆规范化规则，逐项计数供预览摘要。
 *
 * 规则顺序：行空白裁剪 → 空行折叠 → 全半角标点归一 → 逐行机械重复清除 →
 * 广告行清除 → 误断行合并。去重与广告必须先于合并执行（否则短行被并进前段
 * 后特征丢失）；合并跳过候选标题行（当前与上一行），防章题被并入正文。
 * 纯函数无 IO。
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
  /最新网址|请记住本书|笔趣阁|顶点小说|章节目录|收藏本站|手机用户|请下载|APP阅读|app阅读|本章完|小说网|无弹窗|免费阅读|更新最快|章节内容慢|屏蔽广告|浏览器设置|设置护眼/
const AD_LINE_MAX_LENGTH = 40

/** 句末判定：以此结尾的行不与下一行合并。 */
const SENTENCE_ENDING = /[。！？…」』）》]$/

export function cleanText(raw: string): { text: string; summary: CleanSummary } {
  const summary: CleanSummary = {
    whitespaceTrimmed: 0,
    blankLinesCollapsed: 0,
    punctuationNormalized: 0,
    linesMerged: 0,
    adsRemoved: 0,
    duplicatesRemoved: 0,
  }

  const rawLines = raw.split(/\r?\n/)
  const lines: string[] = []

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (trimmed.length !== line.length) summary.whitespaceTrimmed++
    lines.push(trimmed)
  }

  const collapsed: string[] = []
  for (const line of lines) {
    if (line.length === 0 && collapsed[collapsed.length - 1] === "") {
      summary.blankLinesCollapsed++
      continue
    }
    collapsed.push(line)
  }
  while (collapsed.length > 0 && collapsed[0] === "") collapsed.shift()
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") collapsed.pop()

  const normalized = collapsed.map((line) => {
    let out = ""
    let replaced = 0
    for (const char of line) {
      const target = HALF_TO_FULL[char]
      if (target === undefined) out += char
      else {
        out += target
        replaced++
      }
    }
    summary.punctuationNormalized += replaced
    return out
  })

  const deduped: string[] = []
  let lastKept = ""
  for (const line of normalized) {
    if (line !== "" && line === lastKept) {
      summary.duplicatesRemoved++
      continue
    }
    deduped.push(line)
    if (line !== "") lastKept = line
  }

  const withoutAds = deduped.filter((line) => {
    if (line.length > 0 && line.length <= AD_LINE_MAX_LENGTH && AD_LINE_PATTERN.test(line)) {
      summary.adsRemoved++
      return false
    }
    return true
  })

  const merged: string[] = []
  for (const line of withoutAds) {
    const previous = merged[merged.length - 1]
    // 跨空行不合并；标题行不合并也不被并入
    if (
      previous !== undefined &&
      previous !== "" &&
      line !== "" &&
      !SENTENCE_ENDING.test(previous) &&
      !looksLikeHeadingLine(previous) &&
      !looksLikeHeadingLine(line)
    ) {
      merged[merged.length - 1] = previous + line
      summary.linesMerged++
      continue
    }
    merged.push(line)
  }

  return { text: merged.join("\n"), summary }
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
