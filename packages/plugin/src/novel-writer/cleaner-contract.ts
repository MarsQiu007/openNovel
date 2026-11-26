/**
 * cleaner 清洗结论契约解析（narrative-unit-split 任务 3.2/3.4，design D4/D5）。
 *
 * cleaner（LLM）单读全章输出一个 JSON 对象；本函数做确定性契约解析与护栏校验
 * （修复对照逐字存在、字数偏差硬上限、结构清洗模式不改正文），非法输出一律抛错——
 * 「字数偏差超 10% 降级结构清洗重跑」与「解析失败重试」由编排层基于抛错实现。
 * 设定产出口径对齐 save_novel_settings（type/data），技法产出口径对齐 save_technique。
 */
import { countWords } from "@opennovel-ai/schema/schema"

/** 修复后章字数与原章偏差硬上限（design D4）：超限拒绝本次修复，降级结构清洗。 */
export const CLEAN_WORD_DEVIATION = 0.1

const SETTING_TYPES = ["character", "world_entry", "relationship", "plot_thread", "foreshadowing"] as const
const TECHNIQUE_LEVELS = ["paragraph", "sentence", "dialogue", "description", "transition"] as const
const TECHNIQUE_SCOPES = ["general", "adult"] as const

export interface CleanerFix {
  readonly original: string
  readonly fixed: string
  readonly reason: string
}

export interface CleanerSetting {
  readonly type: string
  readonly data: Record<string, unknown>
  readonly sufficient: boolean
  readonly sourceQuote: string
}

export interface CleanerTechniqueEvidence {
  readonly sourceTitle: string
  readonly sourceLocation: string
  readonly excerpt: string
  readonly annotation: string
}

export interface CleanerTechnique {
  readonly name: string
  readonly principle: string
  readonly instruction: string
  readonly sceneTypes: readonly string[]
  readonly level: string
  readonly evidence: readonly CleanerTechniqueEvidence[]
  readonly commonMisuse: string
  readonly scope: string
}

export interface CleanerOutput {
  readonly fixedText: string
  readonly fixes: readonly CleanerFix[]
  readonly structureOnly: boolean
  readonly settings: readonly CleanerSetting[]
  readonly techniques: readonly CleanerTechnique[]
  readonly reason: string
}

export interface CleanerParseInput {
  /** 原章字数（extract 元数据 raw_word_count，字数护栏基准） */
  readonly rawWordCount: number
  /** 原章文本（extract 元数据 chapter_text，修复对照与证据逐字校验基准） */
  readonly chapterText: string
  /** 清洗模式：编排降级重跑时传 structure_only */
  readonly mode: "full" | "structure_only"
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function requireString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0))
    throw new Error(label + " 缺失或为空")
  return value
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(label + " 必须是数组")
  return value
}

/** 解析 cleaner 清洗结论：契约违规、护栏违规全部抛错，由编排层决定重试与降级。 */
export function parseCleanerOutput(raw: string, input: CleanerParseInput): CleanerOutput {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("cleaner 输出不是合法 JSON")
  }
  if (!isRecord(parsed)) throw new Error("cleaner 输出必须是 JSON 对象")
  const fixedText = requireString(parsed.fixed_text, "fixed_text")
  const structureOnly = parsed.structure_only === undefined ? false : parsed.structure_only
  if (typeof structureOnly !== "boolean") throw new Error("structure_only 必须是布尔值")
  // 字数护栏（design D4）：修复后字数与原章偏差超 10% 即修复失败
  const wordCount = countWords(fixedText)
  const deviation = Math.abs(wordCount - input.rawWordCount) / input.rawWordCount
  if (deviation > CLEAN_WORD_DEVIATION)
    throw new Error(
      "修复后字数偏差 " +
        (deviation * 100).toFixed(1) +
        "% 超过 10% 上限（原章约 " +
        input.rawWordCount +
        " 字，修复后约 " +
        wordCount +
        " 字），本次修复拒绝，编排层应以 structure_only 模式重跑",
    )
  // 结构清洗护栏：正文字符不得改动（去空白后逐字一致，段落与空白可调）
  if (input.mode === "structure_only" && fixedText.replace(/\s+/g, "") !== input.chapterText.replace(/\s+/g, ""))
    throw new Error("结构清洗模式不得改动正文字符：fixed_text 与原章去空白后不一致")
  const fixes = requireArray(parsed.fixes ?? [], "fixes").map((item) => {
    if (!isRecord(item)) throw new Error("fixes 项必须是对象")
    const original = requireString(item.original, "fixes.original")
    if (!input.chapterText.includes(original))
      throw new Error("fixes.original 不存在于章全文：" + original.slice(0, 30))
    const fixed = requireString(item.fixed, "fixes.fixed", true)
    const reason = requireString(item.reason, "fixes.reason")
    return { original, fixed, reason }
  })
  const settings = requireArray(parsed.settings ?? [], "settings").map((item) => {
    if (!isRecord(item)) throw new Error("settings 项必须是对象")
    const type = requireString(item.type, "settings.type")
    if (!(SETTING_TYPES as readonly string[]).includes(type))
      throw new Error("settings.type 非法：" + type + "（限定 " + SETTING_TYPES.join("/") + "）")
    if (!isRecord(item.data)) throw new Error("settings.data 必须是对象")
    const sufficient = item.sufficient === undefined ? true : item.sufficient
    if (typeof sufficient !== "boolean") throw new Error("settings.sufficient 必须是布尔值")
    const sourceQuote = item.source_quote === undefined ? "" : requireString(item.source_quote, "settings.source_quote", true)
    return { type, data: item.data, sufficient, sourceQuote }
  })
  const techniques = requireArray(parsed.techniques ?? [], "techniques").map((item) => {
    if (!isRecord(item)) throw new Error("techniques 项必须是对象")
    const name = requireString(item.name, "techniques.name")
    const principle = requireString(item.principle, "techniques.principle")
    const instruction = requireString(item.instruction, "techniques.instruction")
    const sceneTypes = requireArray(item.scene_types, "techniques.scene_types").map((scene) => {
      if (typeof scene !== "string") throw new Error("techniques.scene_types 项必须是字符串")
      return scene
    })
    if (sceneTypes.length === 0) throw new Error("techniques.scene_types 不能为空")
    const level = requireString(item.level, "techniques.level")
    if (!(TECHNIQUE_LEVELS as readonly string[]).includes(level))
      throw new Error("techniques.level 非法：" + level)
    const evidence = requireArray(item.evidence, "techniques.evidence").map((entry) => {
      if (!isRecord(entry)) throw new Error("techniques.evidence 项必须是对象")
      const excerpt = requireString(entry.excerpt, "techniques.evidence.excerpt")
      if (!input.chapterText.includes(excerpt))
        throw new Error("techniques.evidence.excerpt 不存在于章全文：" + excerpt.slice(0, 30))
      return {
        sourceTitle: entry.source_title === undefined ? "" : requireString(entry.source_title, "evidence.source_title", true),
        sourceLocation: entry.source_location === undefined ? "" : requireString(entry.source_location, "evidence.source_location", true),
        excerpt,
        annotation: requireString(entry.annotation, "techniques.evidence.annotation"),
      }
    })
    if (evidence.length === 0) throw new Error("techniques.evidence 至少一条")
    const commonMisuse = requireString(item.common_misuse, "techniques.common_misuse")
    const scope = requireString(item.scope, "techniques.scope")
    if (!(TECHNIQUE_SCOPES as readonly string[]).includes(scope))
      throw new Error("techniques.scope 非法：" + scope + "（限定 general/adult）")
    return { name, principle, instruction, sceneTypes, level, evidence, commonMisuse, scope }
  })
  const reason = parsed.reason === undefined ? "" : requireString(parsed.reason, "reason", true)
  return { fixedText, fixes, structureOnly, settings, techniques, reason }
}
