/**
 * 章节长度归一化模块
 *
 * 将章节文本长度归一化到目标长度附近。如果文本长度在目标长度 ±15% 范围内，
 * 直接返回原文。如果超长，在句子边界处裁剪到 target+100 字符以内。
 * 最多执行一次归一化（不递归裁剪）。
 *
 * 导出：
 * - NormalizeResult — 归一化结果类型
 * - normalizeChapter(text, targetLength) — 执行长度归一化
 */

// ─── 类型定义 ───

export interface NormalizeResult {
  /** 归一化后的文本（超长时裁剪，在范围内时不变） */
  text: string
  /** 是否发生了归一化（true=被裁剪，false=原文不变） */
  normalized: boolean
  /** 原始文本长度 */
  originalLength: number
  /** 归一化后文本长度 */
  newLength: number
}

// ─── 常量 ───

/** 中文句子结束标点 */
const CHINESE_SENTENCE_END = /[。！？]/g

/** 英文句子结束标点 */
const ENGLISH_SENTENCE_END = /[.!?]/g

// ─── 核心函数 ───

/**
 * 归一化章节文本长度。
 *
 * 逻辑：
 * 1. 如果文本长度在 targetLength 的 ±15% 范围内，直接返回原文（normalized=false）
 * 2. 如果文本太短，直接返回原文（不填充——由 writer 处理）
 * 3. 如果文本超长，在句子边界处裁剪到 targetLength+100 字符以内
 * 4. 最多执行一次裁剪，不递归
 *
 * @param text - 原始章节文本
 * @param targetLength - 目标长度（字符数）
 * @returns 归一化结果
 */
export function normalizeChapter(text: string, targetLength: number): NormalizeResult {
  const originalLength = text.length

  // 计算可接受范围：target ±15%
  const lowerBound = Math.floor(targetLength * 0.85)
  const upperBound = Math.ceil(targetLength * 1.15)

  // 在范围内或太短，直接返回原文
  if (originalLength <= upperBound) {
    return {
      text,
      normalized: false,
      originalLength,
      newLength: originalLength,
    }
  }

  // 超长：裁剪到 targetLength+100 字符以内
  // 最多一次裁剪，不递归
  const cutPoint = targetLength + 100
  const trimmed = trimAtSentenceBoundary(text, cutPoint)

  return {
    text: trimmed,
    normalized: true,
    originalLength,
    newLength: trimmed.length,
  }
}

// ─── 辅助函数 ───

/**
 * 在句子边界处裁剪文本。
 *
 * 从 cutPoint 位置向前查找最近的句子结束标点（优先中文 。！？，其次英文 .!?），
 * 在该标点后裁剪。如果裁剪后文本长度小于 cutPoint 的一半（即找不到合适的句子边界），
 * 则在 cutPoint 处硬截断。
 *
 * @param text - 待裁剪文本
 * @param cutPoint - 最大允许字符数
 * @returns 裁剪后的文本
 */
function trimAtSentenceBoundary(text: string, cutPoint: number): string {
  // 如果文本本身就不超过 cutPoint，直接返回
  if (text.length <= cutPoint) {
    return text
  }

  const candidate = text.slice(0, cutPoint)

  // 在 cutPoint 前的文本中查找句子边界
  // 优先匹配中文句子结束标点，再匹配英文
  let lastBoundary = -1

  // 查找中文句子结束标点
  let match: RegExpExecArray | null
  // 重置正则的 lastIndex
  CHINESE_SENTENCE_END.lastIndex = 0
  while ((match = CHINESE_SENTENCE_END.exec(candidate)) !== null) {
    lastBoundary = match.index
  }

  // 如果没有找到中文边界，查英文
  if (lastBoundary === -1) {
    ENGLISH_SENTENCE_END.lastIndex = 0
    while ((match = ENGLISH_SENTENCE_END.exec(candidate)) !== null) {
      lastBoundary = match.index
    }
  }

  // 如果找到了句子边界，在边界后裁剪（包含标点）
  if (lastBoundary !== -1) {
    const trimmed = text.slice(0, lastBoundary + 1)
    // 确保裁剪后不太短（至少保留 cutPoint 的一半），否则硬截断
    if (trimmed.length >= Math.floor(cutPoint / 2)) {
      return trimmed
    }
  }

  // 没有合适的句子边界，在 cutPoint 处硬截断
  return candidate
}
