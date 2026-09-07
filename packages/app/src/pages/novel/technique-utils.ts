export type TechniqueEvidenceInput = {
  sourceTitle: string
  sourceLocation: string
  excerpt: string
  annotation: string
}

/** 将“来源 | 位置 | 摘录 | 注释”格式的文本解析为证据列表，空行会被忽略。 */
export function parseEvidenceText(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sourceTitle = "", sourceLocation = "", excerpt = "", annotation = ""] = line
        .split("|")
        .map((part) => part.trim())
      return { sourceTitle, sourceLocation, excerpt, annotation }
    })
    .filter((item) => item.sourceTitle.length > 0 || item.excerpt.length > 0)
}