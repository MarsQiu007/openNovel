/**
 * cutter 组章结论契约解析（narrative-unit-split 任务 2.4/2.5，design D3）。
 *
 * cutter（LLM）只输出一个 JSON 对象；本函数做确定性契约解析与越界校验，
 * 非法输出一律抛错——「解析失败重试一次、仍失败计该单元失败」由编排层
 * （director AI 拆章队列）基于本函数的抛错实现。
 */

export interface CutterOutput {
  /** 章末句号（相对句流窗口，1 起） */
  readonly endSentence: number
  readonly title: string
  /** 章内新段落起始句号列表（升序，不含 1） */
  readonly segments: readonly number[]
  readonly reason: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** 解析 cutter 组章结论：非 JSON、字段缺失、句号越界、分段乱序全部拒绝。 */
export function parseCutterOutput(raw: string, sentenceCount: number): CutterOutput {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("cutter 输出不是合法 JSON")
  }
  if (!isRecord(parsed)) throw new Error("cutter 输出必须是 JSON 对象")
  const record = parsed
  const endSentence = record.endSentence
  if (typeof endSentence !== "number" || !Number.isInteger(endSentence) || endSentence < 1 || endSentence > sentenceCount)
    throw new Error("endSentence 非法：" + String(endSentence) + "（须为 1-" + sentenceCount + " 的整数）")
  const title = record.title
  if (typeof title !== "string" || title.trim().length === 0) throw new Error("title 缺失或为空")
  const segmentsRaw = record.segments ?? []
  if (!Array.isArray(segmentsRaw)) throw new Error("segments 必须是数组")
  let previous = 0
  const segments = segmentsRaw.map((item) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 2 || item > endSentence)
      throw new Error("segments 项非法：" + String(item) + "（须为 2-" + endSentence + " 的整数）")
    if (item <= previous) throw new Error("segments 须严格递增：" + String(item))
    previous = item
    return item
  })
  const reason = record.reason
  if (reason !== undefined && typeof reason !== "string") throw new Error("reason 必须是字符串")
  return { endSentence, title: title.trim(), segments, reason: typeof reason === "string" ? reason.trim() : "" }
}
