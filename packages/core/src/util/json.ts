export * as Json from "./json"

/**
 * 未受信 JSON 文本的安全解析入口：解析失败或非对象结果一律返回 undefined，
 * 由调用方决定降级语义（缺省配置、空登记、明确报错），避免 SyntaxError 冒泡。
 */
export function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}
