/**
 * 风格规则归一化 — 写入侧与读取侧共用的唯一事实源。
 *
 * 规范形态是"扁平字符串映射"：键为规则名（嵌套对象按 `父.子` 展平、
 * 数组按索引展平），值为字符串（数字/布尔转字符串）。读取历史数据时
 * 容忍嵌套对象、数组与 JSON 字符串形态；写入时同一规则保证落库形态统一。
 */

/** 风格规则格式说明（错误信息与工具描述共用的文案）。 */
export const STYLE_RULES_FORMAT_HINT =
  "规则需为扁平字符串映射：值需为标量（数字/布尔转字符串）；嵌套对象按 父.子 展平、数组按索引展平；也支持 JSON 字符串或每行 键: 值 文本"

export interface StyleRulesNormalization {
  rules: Record<string, string>
  /** 输入非空但无法得到任何规则条目（写入侧应拒绝而非静默清空）。 */
  unnormalizable: boolean
}

/**
 * 将任意形态的 rules 归一化为扁平字符串映射。
 *
 * - 字符串输入：先按 JSON 解析（对象/数组），失败再按每行 `键: 值` 解析；
 *   任一非空行无法解析时整体判为无法归一化。
 * - 嵌套对象按 `父.子` 键递归展平；数组按索引展平（顶层为 `0`、`1`…）。
 * - 叶子值：字符串保持；数字与布尔 String()；null、undefined 与空容器不产生条目。
 * - 显式空对象、空数组、空串视为"清空"，不算失败。
 */
export function normalizeStyleRules(input: unknown): StyleRulesNormalization {
  if (typeof input === "string") return normalizeStringRules(input)
  const rules = flattenRules(input)
  return { rules, unnormalizable: hasRulesContent(input) && Object.keys(rules).length === 0 }
}

/** 归一化 rules；非空且无法归一化时抛错（写入边界据此整体拒绝）。 */
export function requireNormalizedStyleRules(input: unknown): Record<string, string> {
  const { rules, unnormalizable } = normalizeStyleRules(input)
  if (unnormalizable) throw new Error(`风格规则无法归一化。${STYLE_RULES_FORMAT_HINT}`)
  return rules
}

function normalizeStringRules(input: string): StyleRulesNormalization {
  const trimmed = input.trim()
  if (trimmed === "") return { rules: {}, unnormalizable: false }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === "object") {
      const rules = flattenRules(parsed)
      return { rules, unnormalizable: hasRulesContent(parsed) && Object.keys(rules).length === 0 }
    }
    if (typeof parsed === "string" && parsed !== input) return normalizeStringRules(parsed)
  } catch {
    // 非 JSON：继续按行文本解析
  }
  const rules: Record<string, string> = {}
  for (const line of trimmed.split(/\r?\n/)) {
    const content = line.trim()
    if (content === "") continue
    const idx = content.search(/[:：]/)
    const key = idx > 0 ? content.slice(0, idx).trim() : ""
    if (key === "") return { rules: {}, unnormalizable: true }
    rules[key] = content.slice(idx + 1).trim()
  }
  return { rules, unnormalizable: false }
}

/** 判断输入是否"有内容"（有键/有元素/非空串）；空值返回 false。 */
function hasRulesContent(input: unknown): boolean {
  if (input == null) return false
  if (typeof input === "string") return input.trim() !== ""
  if (Array.isArray(input)) return input.length > 0
  if (typeof input === "object") return Object.keys(input).length > 0
  return true
}

/** 递归展平为 `父.子` / 索引键的扁平映射。 */
function flattenRules(value: unknown, prefix: string = "", out: Record<string, string> = {}): Record<string, string> {
  if (value == null) return out
  if (typeof value === "string") {
    if (prefix !== "") out[prefix] = value
    return out
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (prefix !== "") out[prefix] = String(value)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenRules(item, prefix === "" ? String(index) : `${prefix}.${index}`, out))
    return out
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenRules(child, prefix === "" ? key : `${prefix}.${key}`, out)
    }
  }
  return out
}
