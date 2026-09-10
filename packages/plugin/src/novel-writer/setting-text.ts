/**
 * 设定长文本统一使用纯文本 + 空行分段。
 *
 * 设定批注后续会按段落索引和文本偏移量锚定内容；Markdown 渲染会引入嵌套 DOM，
 * 导致锚点和原始 content 不再一一对应，因此这里在写入端直接拦截常见语法。
 */

export const SETTING_TEXT_FORMAT_RULE =
  "长文本必须使用纯文本：禁止 Markdown 标题、加粗、斜体、列表、链接、引用和代码块（如 ##、**、-、1.、[文本](链接)、>、三个反引号）；用自然句子表达层级；换行表示段落边界，超过 200 字必须分段，写入时会统一规范化为 \\n\\n。"

const MARKDOWN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Markdown 标题", pattern: /(^|\n)[ \t]{0,3}#{1,6}[ \t]+\S/ },
  { label: "Markdown 无序列表", pattern: /(^|\n)[ \t]{0,3}[-*+][ \t]+\S/ },
  { label: "Markdown 有序列表", pattern: /(^|\n)[ \t]{0,3}\d+\.[ \t]+\S/ },
  { label: "Markdown 加粗", pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
  { label: "Markdown 链接", pattern: /\[[^\]\n]+\]\([^)\n]+\)/ },
  { label: "Markdown 引用", pattern: /(^|\n)[ \t]{0,3}>[ \t]+\S/ },
  { label: "Markdown 代码块", pattern: /```|`[^`\n]+`/ },
]

export function plainTextFormatError(value: string): string | null {
  const text = value.trim()
  if (!text) return null

  for (const { label, pattern } of MARKDOWN_PATTERNS) {
    if (pattern.test(text)) {
      return `${label}不是纯文本格式。${SETTING_TEXT_FORMAT_RULE}`
    }
  }
  return null
}

export function normalizeSettingText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n")
}

export function paragraphFormatError(value: string): string | null {
  const text = value.trim()
  if (text.length <= 200 || /\n/.test(text)) return null
  return `长内容（${text.length} 字）没有换行分段；超过 200 字必须分段，写入时会规范化为 \\n\\n。`
}

export function settingTextFormatError(
  value: unknown,
  entityType: string,
  field: string,
): string | null {
  if (typeof value !== "string") return null
  const error = plainTextFormatError(value) ?? paragraphFormatError(value)
  if (!error) return null
  return `${entityType}.${field}：${error}`
}
