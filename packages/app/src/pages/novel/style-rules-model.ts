/**
 * 风格指南编辑器的规则模型纯函数（style-editor-structure / chapter-length-range）。
 *
 * 规则行是自由规则键的编辑态事实源：回填（库 → 行）、分区分组（行 → 视图）、
 * 校验（空键 / 重复键 / 保留键）与序列化（行 → 库）全部为纯函数。字数下限与
 * 上限由常驻字段独占承载（chapter_length / chapter_length_max）：回填排除两键、
 * 序列化按字段值混入、行内出现两键属保留键冲突；读取侧口径见 design D2
 * （trim 空串先判、Number + isFinite + > 0 + floor、下限非法回落 2500、上限
 * 非法或 ≤ 下限降级不设上限），保存侧校验比读取侧严格（trim 后 /^\d+$/）。
 */

export type StyleRuleRow = { key: string; value: string }

/** 字数下限由常驻字段独占承载，规则行不得占用 */
export const CHAPTER_LENGTH_KEY = "chapter_length"

/** 字数上限由常驻字段独占承载（空串 = 不设上限），规则行不得占用 */
export const CHAPTER_LENGTH_MAX_KEY = "chapter_length_max"

/** 字数下限缺省值，与读取侧（守卫 getTargetWordCount / 快照组装）对齐 */
export const DEFAULT_CHAPTER_LENGTH = "2500"

/** 语义分区：标题硬编码中文（沿用界面内既有文案先例），keys 为键名建议表 */
export const STYLE_RULE_SECTIONS: readonly { title: string; keys: readonly string[] }[] = [
  { title: "叙事节奏", keys: ["pacing", "节奏", "rhythm", "hook", "钩子", "悬念节奏"] },
  { title: "对话与描写", keys: ["dialogue_ratio", "对话比例", "description_ratio", "描写比例", "对话风格", "show_don_tell"] },
  { title: "章节结构", keys: ["chapter_structure", "章节结构", "章节结尾", "scenes_per_chapter"] },
  { title: "语言偏好", keys: ["pov", "人称", "sentence_style", "句式", "词汇", "用语习惯"] },
] as const

export const OTHER_SECTION_TITLE = "其他"

export function sectionTitles(): string[] {
  return [...STYLE_RULE_SECTIONS.map((s) => s.title), OTHER_SECTION_TITLE]
}

function sectionOfKey(key: string): string {
  const matched = STYLE_RULE_SECTIONS.find((section) => section.keys.includes(key))
  return matched ? matched.title : OTHER_SECTION_TITLE
}

/** 分区视图：行数组按键名精确匹配建议表归组，未匹配键落「其他」，内容不丢失 */
export function groupRowsBySection(rows: readonly StyleRuleRow[]): { title: string; rows: StyleRuleRow[] }[] {
  const grouped = sectionTitles().map((title) => ({ title, rows: [] as StyleRuleRow[] }))
  const byTitle = new Map(grouped.map((group) => [group.title, group]))
  for (const row of rows) {
    byTitle.get(sectionOfKey(row.key))?.rows.push(row)
  }
  return grouped.filter((group) => (group.rows.length > 0 || group.title === OTHER_SECTION_TITLE))
}

/**
 * 读取侧正整数解析（与 plugin D2 契约同源）：trim 空串先判、Number + isFinite +
 * > 0 + floor。非法或非正数返回 null，由调用方按缺省口径回显。
 */
function parsePositiveInt(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/**
 * 回填字数上下限字段：按读取侧口径解析库值，非法存量值不直接摆上输入框——
 * 下限非法回显缺省 2500，上限非法或 ≤ 下限回显空串（= 不设上限）。
 */
export function parseLengthFields(rules: Record<string, string> | undefined): { lower: string; upper: string } {
  const lower = parsePositiveInt(rules?.[CHAPTER_LENGTH_KEY]) ?? Number(DEFAULT_CHAPTER_LENGTH)
  const upper = parsePositiveInt(rules?.[CHAPTER_LENGTH_MAX_KEY])
  return {
    lower: String(lower),
    upper: upper != null && upper > lower ? String(upper) : "",
  }
}

/** 回填：库中扁平映射 → 规则行数组；字数上下限两键由常驻字段承载，不进编辑行 */
export function rowsFromRecord(rules: Record<string, string> | undefined): StyleRuleRow[] {
  return Object.entries(rules ?? {})
    .filter(([key]) => key !== CHAPTER_LENGTH_KEY && key !== CHAPTER_LENGTH_MAX_KEY)
    .map(([key, value]) => ({ key, value }))
}

export type RowIssue = "empty_key" | "duplicate_key" | "reserved_key"

/** 校验：键为空 / 与其他行重复 / 与常驻字数字段冲突。返回 行下标 → 问题类型；值允许为空串（清空值是合法意图） */
export function validateRows(rows: readonly StyleRuleRow[]): Map<number, RowIssue> {
  const issues = new Map<number, RowIssue>()
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    const key = row.key.trim()
    if (key.length === 0) {
      issues.set(index, "empty_key")
      return
    }
    if (key === CHAPTER_LENGTH_KEY || key === CHAPTER_LENGTH_MAX_KEY) {
      issues.set(index, "reserved_key")
      return
    }
    const first = seen.get(key)
    if (first !== undefined) {
      issues.set(index, "duplicate_key")
      return
    }
    seen.set(key, index)
  })
  return issues
}

/** 字段级校验错误：invalid_number（非正整数十进制）与 below_lower（上限小于下限） */
export type LengthFieldIssue = "invalid_number" | "below_lower"

export type LengthFieldIssues = { lower?: LengthFieldIssue; upper?: LengthFieldIssue }

/**
 * 字数上下限保存侧校验（比读取侧严格）：trim 后须匹配 /^\d+$/ 且数值 > 0
 * （"2e3"、全角数字、"0"、"-3" 均拦截）。下限必填（空串即 invalid_number）；
 * 上限可空串 = 不设上限；上限小于下限标 below_lower 拦截保存，等于下限允许
 * （读取侧按不设上限降级）。全合法返回 {}。
 */
export function validateLengthFields(lower: string, upper: string): LengthFieldIssues {
  const issues: LengthFieldIssues = {}
  const lowerTrimmed = lower.trim()
  const lowerValid = lowerTrimmed !== "" && /^\d+$/.test(lowerTrimmed) && Number(lowerTrimmed) > 0
  if (!lowerValid) issues.lower = "invalid_number"
  const upperTrimmed = upper.trim()
  if (upperTrimmed !== "") {
    if (!/^\d+$/.test(upperTrimmed) || Number(upperTrimmed) <= 0) issues.upper = "invalid_number"
    else if (lowerValid && Number(upperTrimmed) < Number(lowerTrimmed)) issues.upper = "below_lower"
  }
  return issues
}

/**
 * 序列化：规则行数组 + 字数上下限字段 → 库中扁平映射。调用前须先通过
 * validateRows 与 validateLengthFields；两键在自由行展开之后混入——即使自由行
 * 携带同名键（保存前已被 validateRows 拦截），常驻字段值仍然胜出，序列化不受自由行影响。
 */
export function rowsToRecord(
  rows: readonly StyleRuleRow[],
  lengthLower: string,
  lengthUpper: string,
): Record<string, string> {
  return {
    ...Object.fromEntries(rows.map((row) => [row.key.trim(), row.value])),
    [CHAPTER_LENGTH_KEY]: lengthLower.trim(),
    [CHAPTER_LENGTH_MAX_KEY]: lengthUpper.trim(),
  }
}
