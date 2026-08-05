/**
 * 章节长度校验模块
 *
 * 根据各平台字数规则，检查章节长度是否在规定范围内。
 * 每个平台有不同的字数下限和上限，章节内容需符合所选平台的规则。
 *
 * 导出：
 * - PLATFORM_LENGTHS — 平台长度预设常量
 * - PlatformLengthRule — 平台长度规则类型
 * - ChapterLengthResult — 章节长度校验结果类型
 * - checkChapterLength(text, platform) — 校验章节长度
 * - getTargetLength(platform) — 获取平台目标长度
 */

// ─── 类型定义 ───

/** 平台长度规则 */
export interface PlatformLengthRule {
  /** 平台中文名称 */
  name: string
  /** 最低字数 */
  min: number
  /** 最高字数 */
  max: number
  /** 目标字数（取中间值） */
  target: number
}

/** 章节长度校验结果 */
export interface ChapterLengthResult {
  /** 章节当前字数 */
  length: number
  /** 校验状态：ok=符合要求，too_short=字数不足，too_long=字数超限 */
  status: "ok" | "too_short" | "too_long"
  /** 中文提示消息 */
  message: string
}

// ─── 常量 ───

/** 各平台长度预设 */
export const PLATFORM_LENGTHS: Record<string, PlatformLengthRule> = {
  /** 起点中文网：2000-3000字 */
  qidian: {
    name: "起点中文网",
    min: 2000,
    max: 3000,
    target: 2500,
  },
  /** 番茄小说：2000-4000字 */
  fanqie: {
    name: "番茄小说",
    min: 2000,
    max: 4000,
    target: 3000,
  },
  /** 网页阅读：1500-3500字 */
  web: {
    name: "网页阅读",
    min: 1500,
    max: 3500,
    target: 2500,
  },
  /** 短篇：1000-2000字 */
  short: {
    name: "短篇",
    min: 1000,
    max: 2000,
    target: 1500,
  },
}

// ─── 核心函数 ───

/**
 * 校验章节长度是否符合平台规则。
 *
 * 根据平台的最小和最大字数限制，检查章节文本长度是否在范围内。
 * 返回校验结果，包含当前字数、状态和中文提示消息。
 *
 * @param text - 章节文本内容
 * @param platform - 平台标识（qidian/fanqie/web/short）
 * @returns 校验结果，包含字数、状态和提示消息
 */
export function checkChapterLength(text: string, platform: string): ChapterLengthResult {
  const rule = PLATFORM_LENGTHS[platform]
  const length = text.length

  // 未知平台，返回 ok（不阻塞）
  if (!rule) {
    return {
      length,
      status: "ok",
      message: `未知平台 "${platform}"，跳过长度校验`,
    }
  }

  if (length < rule.min) {
    return {
      length,
      status: "too_short",
      message: `字数不足：当前 ${length} 字，${rule.name}要求至少 ${rule.min} 字，还需 ${rule.min - length} 字`,
    }
  }

  if (length > rule.max) {
    return {
      length,
      status: "too_long",
      message: `字数超限：当前 ${length} 字，${rule.name}要求最多 ${rule.max} 字，超出 ${length - rule.max} 字`,
    }
  }

  return {
    length,
    status: "ok",
    message: `字数合格：${length} 字，符合${rule.name} ${rule.min}-${rule.max} 字要求`,
  }
}

/**
 * 获取平台的目标长度。
 *
 * 目标长度为平台字数范围的中间值（向下取整），
 * 可作为章节写作时的参考字数。
 *
 * @param platform - 平台标识（qidian/fanqie/web/short）
 * @returns 目标长度，未知平台返回 0
 */
export function getTargetLength(platform: string): number {
  const rule = PLATFORM_LENGTHS[platform]
  return rule ? rule.target : 0
}
