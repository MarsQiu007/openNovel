import { bookHasAdultTechniques, readContentNatureOverride } from "./session-store.js"

export type BookContentNature = {
  value: "adult" | "general"
  source: "override" | "passive"
}

/**
 * 书级内容性质：人工覆盖 ?? 被动信号（书库存在 adult 技法则 adult，否则 general）。
 * 任何失败按从紧回落 general（adult 候选不出现），不中断写作主流程。
 */
export async function resolveBookContentNature(directory?: string | null): Promise<BookContentNature> {
  try {
    const override = readContentNatureOverride(directory)
    if (override) return { value: override, source: "override" }
    const hasAdult = await bookHasAdultTechniques(directory)
    return { value: hasAdult ? "adult" : "general", source: "passive" }
  } catch {
    return { value: "general", source: "passive" }
  }
}

/** 章节级内容性质：调用方 agent 经工具参数给出；缺失/非法按 general（从紧）。 */
export function resolveChapterContentNature(param?: unknown): "adult" | "general" {
  return param === "adult" ? "adult" : "general"
}
