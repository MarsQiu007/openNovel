import type { TechniqueEntry } from "./technique.js"

export interface TextSegment {
  title: string
  text: string
  startOffset: number
  endOffset: number
}

export interface SegmentOptions {
  chunkSize?: number
  overlap?: number
}

export type LLMFunction = (prompt: string) => Promise<string>

export interface Highlight {
  segment: TextSegment
  reason: string
  sceneType: string
  level: string
}

/** 提取结果统一携带解析失败计数，避免 LLM 输出格式漂移时静默归零 */
export interface ExtractionResult<T> {
  items: T[]
  parseFailures: number
}

const HIGHLIGHTER_PROMPT = `你是一个专业的小说写作技法分析师。请阅读以下文本片段，标记出包含值得提取的写作技法的段落。

技法包括：对话张力、环境情绪外化、节奏控制、视角运用、悬念铺设、描写技巧、句式节奏、修辞手法等。

只标记技法密集或技法效果显著的段落，平庸段落不要标记。如果整段都没有值得提取的技法，返回空的 highlights 数组。

请以 JSON 格式返回：
{"highlights": [{"reason": "技法说明", "sceneType": "dialogue|emotion_shift|action|description|transition|suspense|general", "level": "paragraph|sentence|dialogue|description|transition"}]}

文本片段：
{{TEXT}}`

export async function highlightTechniques(
  segments: TextSegment[],
  llm: LLMFunction,
): Promise<ExtractionResult<Highlight>> {
  const allHighlights: Highlight[] = []
  let parseFailures = 0

  for (const segment of segments) {
    const prompt = HIGHLIGHTER_PROMPT.replace("{{TEXT}}", segment.text.slice(0, 3000))
    const response = await llm(prompt)
    const parsed = extractJsonValue(response)
    if (parsed === null) {
      parseFailures++
      continue
    }
    const highlights = isRecord(parsed) ? parsed.highlights : undefined
    if (!Array.isArray(highlights)) continue
    for (const h of highlights) {
      if (!isRecord(h)) continue
      allHighlights.push({
        segment,
        reason: typeof h.reason === "string" ? h.reason : "",
        sceneType: typeof h.sceneType === "string" ? h.sceneType : "general",
        level: typeof h.level === "string" ? h.level : "paragraph",
      })
    }
  }

  return { items: allHighlights, parseFailures }
}

const DISTILLER_PROMPT = `你是一个专业的小说写作技法提炼师。请从以下被标记的段落中提炼出结构化的写作技法条目。

要求：principle 是对技法本质的抽象概括；instruction 是可以直接给 AI 写作模型的操作指令；evidence 包含原文片段和技法标注；commonMisuse 描述最常见的误用方式。只提炼真正可复用的技法，不要硬凑。

请以 JSON 格式返回：
{"techniques": [{"name": "技法名", "principle": "抽象原则", "instruction": "操作指令", "sceneTypes": ["dialogue"], "level": "paragraph", "evidence": [{"sourceTitle": "书名", "sourceLocation": "位置", "excerpt": "原文片段", "annotation": "技法标注"}], "commonMisuse": "常见误用"}]}

标记段落：
{{HIGHLIGHTS}}`

export async function distillTechniques(
  highlights: Highlight[],
  llm: LLMFunction,
): Promise<ExtractionResult<Partial<TechniqueEntry>>> {
  if (highlights.length === 0) return { items: [], parseFailures: 0 }

  const highlightTexts = highlights
    .map((h) => `[来源: ${h.segment.title}] [场景: ${h.sceneType}] [标记原因: ${h.reason}]\n${h.segment.text}`)
    .join("\n\n---\n\n")

  const prompt = DISTILLER_PROMPT.replace("{{HIGHLIGHTS}}", highlightTexts.slice(0, 8000))
  const response = await llm(prompt)

  const parsed = extractJsonValue(response)
  if (parsed === null) return { items: [], parseFailures: 1 }
  const techniques = isRecord(parsed) ? parsed.techniques : undefined
  if (!Array.isArray(techniques)) return { items: [], parseFailures: 0 }
  return { items: techniques.filter(isTechniqueLike), parseFailures: 0 }
}

/** 蒸馏候选的最低门槛：必须是对象且有字符串 name，其余字段由下游 normalize 兜底 */
function isTechniqueLike(value: unknown): value is Partial<TechniqueEntry> {
  return isRecord(value) && typeof value.name === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * 容错解析 LLM 输出：剥离 markdown 围栏后提取首个平衡 JSON 对象。
 * LLM 常在 JSON 外包裹 ```json 围栏或解释性文字，裸 JSON.parse 会整体失败。
 */
export function extractJsonValue(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*\r?\n?([\s\S]*?)```/)
  const cleaned = (fence ? fence[1] : text).trim()
  const candidate = extractBalancedObject(cleaned)
  if (candidate === null) return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString && ch === "\\") {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth++
    if (ch === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const VAGUE_PATTERNS = [/要注意/, /需要注意/, /避免过度/, /保持.*平衡/, /提升.*质量/, /增强.*效果/]

export function filterTechniques(entries: Partial<TechniqueEntry>[]): Partial<TechniqueEntry>[] {
  const withEvidence = entries.filter((e) => e.evidence && e.evidence.length > 0)
  const concrete = withEvidence.filter((e) => {
    const instruction = e.instruction ?? ""
    return instruction.length > 10 && !VAGUE_PATTERNS.some((p) => p.test(instruction))
  })

  const merged = new Map<string, Partial<TechniqueEntry>>()
  for (const entry of concrete) {
    const key = entry.name ?? ""
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, entry)
    } else {
      existing.evidence = [...(existing.evidence ?? []), ...(entry.evidence ?? [])]
    }
  }

  return [...merged.values()]
}

export function segmentText(input: string, options?: SegmentOptions): TextSegment[] {
  const chunkSize = options?.chunkSize ?? 3000
  const overlap = options?.overlap ?? 500

  const chapterPattern = /^(第[一二三四五六七八九十百千\d]+[章卷节回]|Chapter\s+\d+)/gm
  const positions: { start: number; title: string }[] = []
  let match: RegExpExecArray | null

  while ((match = chapterPattern.exec(input)) !== null) {
    const lineEnd = input.indexOf("\n", match.index)
    const title =
      lineEnd === -1 ? input.slice(match.index, match.index + 50) : input.slice(match.index, lineEnd)
    positions.push({ start: match.index, title: title.trim() })
  }

  if (positions.length > 0) {
    const result: TextSegment[] = []
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].start
      const end = i + 1 < positions.length ? positions[i + 1].start : input.length
      const text = input.slice(start, end).trim()
      if (text.length > chunkSize) {
        result.push(...chunkSegment(text, positions[i].title, chunkSize, overlap, start))
      } else if (text.length > 0) {
        result.push({ title: positions[i].title, text, startOffset: start, endOffset: end })
      }
    }
    return result
  }

  return chunkSegment(input, "全文", chunkSize, overlap, 0)
}

function chunkSegment(
  text: string,
  title: string,
  chunkSize: number,
  overlap: number,
  baseOffset: number,
): TextSegment[] {
  const chunks: TextSegment[] = []
  let offset = 0
  let index = 0

  while (offset < text.length) {
    const end = Math.min(offset + chunkSize, text.length)
    chunks.push({
      title: `${title} [块${index + 1}]`,
      text: text.slice(offset, end),
      startOffset: baseOffset + offset,
      endOffset: baseOffset + end,
    })
    offset = end === text.length ? end : end - overlap
    index++
  }

  return chunks
}
