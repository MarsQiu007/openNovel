/**
 * 固定长度分章识别（fixed-split-restructure · design D5）。
 *
 * 标题模式是强信号（与导入兜底 splitFixedLength 的「第N部分」产出口径一致），
 * 均匀度排除手拟「第N部分」标题的正常书籍；末章允许为短余量，不参与均匀度判定。
 * 纯函数供 list_chapters 与导入整理分诊消费。
 */

/** 固定分章命名模式（与 splitFixedLength 产出口径一致）。 */
const FIXED_SPLIT_TITLE = /^第\d+部分$/

/** 长度均匀阈值：除末章外各章字数差上限（固定分章等长切分，正常创作章长度差异更大）。 */
const UNIFORM_WORD_RANGE = 1500

export interface FixedSplitChapter {
  title: string
  wordCount: number
}

export function detectFixedSplit(chapters: FixedSplitChapter[]): boolean {
  if (chapters.length === 0) return false
  if (!chapters.every((chapter) => FIXED_SPLIT_TITLE.test(chapter.title))) return false
  const settled = chapters.slice(0, -1).map((chapter) => chapter.wordCount)
  if (settled.length <= 1) return true
  return Math.max(...settled) - Math.min(...settled) <= UNIFORM_WORD_RANGE
}
