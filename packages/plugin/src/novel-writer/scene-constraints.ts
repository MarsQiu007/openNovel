/**
 * 章纲场景硬约束清单编译器。
 *
 * 把章纲 markdown 的「## 关键场景」段确定性解析为逐场景清单文本，
 * 供写作快照和 read_outline 兜底路径注入 writer prompt，作为与字数、
 * 角色白名单同等级的硬约束。
 *
 * 解析对 LLM 填充的章纲保持容差：字段值为空或「（待填写）」时跳过该字段；
 * 一个场景段都切不出时返回 null，调用方不输出清单段（解析失败永不阻塞写作）。
 */

const SCENE_SECTION_HEADING = "## 关键场景"
const SCENE_HEADING_PREFIX = "### 场景"
const PLACEHOLDER_RE = /^(（待填写）|\(待填写\)|待填写)$/
const FIELD_RE = /^- \*\*(地点|时间|出场角色|场景概要|字数预估)\*\*[：:]\s*(.*?)\s*$/
type SceneField = "地点" | "时间" | "出场角色" | "场景概要" | "字数预估"

const FIELD_LABELS: Partial<Record<SceneField, string>> = { 场景概要: "必须发生" }

/**
 * 编译章纲 markdown 为场景硬约束清单文本；无章纲场景段时返回 null。
 * 调用方应只在结果非空时输出清单段。
 */
export function compileSceneChecklist(outlineMarkdown: string): string | null {
  const lines = outlineMarkdown.split("\n")
  const sectionStart = lines.findIndex((line) => line.trim() === SCENE_SECTION_HEADING)
  if (sectionStart < 0) return null

  // 场景段范围：从「## 关键场景」到下一个二级标题（不含）之间
  const sectionLines = lines.slice(sectionStart + 1)
  const nextHeadingIndex = sectionLines.findIndex((line) => line.startsWith("## "))
  const sceneLines = nextHeadingIndex < 0 ? sectionLines : sectionLines.slice(0, nextHeadingIndex)

  const segments: { heading: string; fields: string[] }[] = []
  let current: { heading: string; fields: string[] } | null = null
  for (const line of sceneLines) {
    if (line.startsWith(SCENE_HEADING_PREFIX)) {
      current = { heading: line.trim(), fields: [] }
      segments.push(current)
      continue
    }
    if (!current) continue
    const match = FIELD_RE.exec(line)
    if (!match) continue
    const rawValue = (match[2] ?? "").trim()
    if (rawValue.length === 0 || PLACEHOLDER_RE.test(rawValue)) continue
    const label = FIELD_LABELS[match[1] as SceneField] ?? match[1]
    current.fields.push(`- ${label}：${rawValue}`)
  }

  if (segments.length === 0) return null

  return segments
    .map((segment) => [segment.heading, ...segment.fields].join("\n"))
    .join("\n\n")
}