/**
 * 同步错误分类器（upgrade-reliability）。
 *
 * 把 worker 消费时的原始错误分类为瞬时（可自动恢复）或终态（需人工干预），
 * 并输出人话说明与行动建议。恢复时间从 provider 错误文本中解析。
 */

/** 失败分类。 */
export type FailureClass =
  | "transient_quota"
  | "transient_rate"
  | "transient_network"
  | "terminal_parse"
  | "terminal_model"
  | "terminal_unknown"

/** 失败分类结果。 */
export interface FailureClassification {
  kind: "transient" | "terminal"
  failureClass: FailureClass
  /** 从错误文本解析出的恢复时间戳（毫秒）；未知为 null。 */
  resumeAt: number | null
  /** 人话说明（简体中文）。 */
  message: string
  /** 行动建议（简体中文）。 */
  action: string
}

/** 从错误文本解析恢复时间戳。支持「YYYY-MM-DD HH:mm(:ss)」与「HH:mm」两种模式。 */
function parseResumeAt(text: string): number | null {
  // 完整日期时间：2026-10-16 20:51:41 或 2026-10-16T20:51
  const fullMatch = text.match(/(\d{4}-\d{2}-\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (fullMatch) {
    const [, datePart, hh, mm, ss] = fullMatch
    const d = new Date(`${datePart}T${hh}:${mm}:${ss ?? "00"}`)
    return isNaN(d.getTime()) ? null : d.getTime()
  }
  // 仅时间：将于 20:51 可用 / 将于20:51可用
  const timeMatch = text.match(/将于\s*(\d{1,2}):(\d{2})/)
  if (timeMatch) {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(timeMatch[1]), Number(timeMatch[2]))
    // 若目标时间已过，推至次日
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
    return target.getTime()
  }
  return null
}

/** 提取错误文本（兼容 Error 与字符串）。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 分类同步错误。 */
export function classifySyncError(error: unknown): FailureClassification {
  const text = errorText(error)
  const lower = text.toLowerCase()

  // provider 配额 / 用量上限
  if (lower.includes("quota") || lower.includes("上限") || lower.includes("额度") || lower.includes("usage limit")) {
    const resumeAt = parseResumeAt(text)
    return {
      kind: "transient",
      failureClass: "transient_quota",
      resumeAt,
      message: resumeAt
        ? `模型额度已用尽，预计 ${new Date(resumeAt).toLocaleTimeString()} 自动恢复`
        : "模型额度已用尽",
      action: "等待自动恢复，或升级套餐后点击重试",
    }
  }

  // 限流 / RPM
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return {
      kind: "transient",
      failureClass: "transient_rate",
      resumeAt: null,
      message: "请求过于频繁，被 provider 限流",
      action: "稍后自动重试，或降低并发后点击重试",
    }
  }

  // 网络超时 / 连接错误
  if (
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("网络") ||
    lower.includes("connection")
  ) {
    return {
      kind: "transient",
      failureClass: "transient_network",
      resumeAt: null,
      message: "网络连接失败，无法访问模型服务",
      action: "检查网络连接后点击重试",
    }
  }

  // 模型不可用 / 未配置
  if (lower.includes("model not found") || lower.includes("model unavailable") || lower.includes("未配置") || lower.includes("模型")) {
    return {
      kind: "terminal",
      failureClass: "terminal_model",
      resumeAt: null,
      message: "模型不可用或未配置",
      action: "请在设置中配置默认模型后重试",
    }
  }

  // 内容无法解析
  if (lower.includes("parse") || lower.includes("json") || lower.includes("解析")) {
    return {
      kind: "terminal",
      failureClass: "terminal_parse",
      resumeAt: null,
      message: "模型返回内容无法解析",
      action: "请重试；若多次失败请检查模型输出格式",
    }
  }

  return {
    kind: "terminal",
    failureClass: "terminal_unknown",
    resumeAt: null,
    message: "未知错误",
    action: "请查看原始错误详情或重试",
  }
}

/**
 * 指数退避计算（upgrade-reliability）。
 *
 * 1min 起步、上限 30min，±20% 随机抖动避免多章同时重试。
 */
export function computeBackoffMs(attempts: number): number {
  const base = Math.min(Math.pow(2, attempts) * 60_000, 30 * 60_000)
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}

/** 瞬时失败最大尝试次数：超过后转 terminal。 */
export const MAX_ATTEMPTS = 5
