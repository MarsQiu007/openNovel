/**
 * 风格指南编辑器的规则模型纯函数（style-editor-structure）。
 *
 * 规则行是编辑态的唯一事实源：回填（库 → 行）、分区分组（行 → 视图）、校验
 * （空键 / 重复键 / 保留键）与序列化（行 → 库）全部为纯函数，行状态由编辑器
 * 以 createStore 持有，分组是派生视图。chapter_length_limit 由篇幅限制复选框
 * 独占承载：回填排除、序列化按复选框混入、行内出现该键属校验失败。
 */

export type StyleRuleRow = { key: string; value: string }

/** chapter_length_limit 由复选框独占承载，规则行不得占用 */
export const LENGTH_LIMIT_KEY = "chapter_length_limit"

/** 语义分区：标题硬编码中文（沿用界面内既有文案先例），keys 为键名建议表 */
export const STYLE_RULE_SECTIONS: readonly { title: string; keys: readonly string[] }[] = [
  { title: "叙事节奏", keys: ["pacing", "节奏", "rhythm", "hook", "钩子", "悬念节奏"] },
  { title: "对话与描写", keys: ["dialogue_ratio", "对话比例", "description_ratio", "描写比例", "对话风格", "show_don_tell"] },
  { title: "章节结构", keys: ["chapter_length", "章节字数", "chapter_structure", "章节结构", "章节结尾", "scenes_per_chapter"] },
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
  return grouped.filter((group) => group.rows.length > 0 || group.title === OTHER_SECTION_TITLE)
}

/** 回填：库中扁平映射 → 规则行数组；保留键由复选框承载，不进编辑行 */
export function rowsFromRecord(rules: Record<string, string> | undefined): StyleRuleRow[] {
  return Object.entries(rules ?? {})
    .filter(([key]) => key !== LENGTH_LIMIT_KEY)
    .map(([key, value]) => ({ key, value }))
}

export type RowIssue = "empty_key" | "duplicate_key" | "reserved_key"

/** 校验：键为空 / 与其他行重复 / 保留键。返回 行下标 → 问题类型；值允许为空串（清空值是合法意图） */
export function validateRows(rows: readonly StyleRuleRow[]): Map<number, RowIssue> {
  const issues = new Map<number, RowIssue>()
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    const key = row.key.trim()
    if (key.length === 0) {
      issues.set(index, "empty_key")
      return
    }
    if (key === LENGTH_LIMIT_KEY) {
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

/** 序列化：规则行数组 → 库中扁平映射；篇幅限制按复选框状态混入保留键。调用前须先通过 validateRows */
export function rowsToRecord(rows: readonly StyleRuleRow[], lengthLimit: boolean): Record<string, string> {
  return {
    [LENGTH_LIMIT_KEY]: lengthLimit ? "true" : "false",
    ...Object.fromEntries(rows.map((row) => [row.key.trim(), row.value])),
  }
}
