import { bookHasAdultTechniques } from "./session-store.js"

/**
 * 书级内容性质：被动信号确定性判定（书库存在 adult 技法则 adult，否则 general），无人工标记入口。
 * 任何失败按从紧回落 general（adult 候选不出现），不中断写作主流程。
 */
export async function resolveBookContentNature(directory?: string | null): Promise<"adult" | "general"> {
  try {
    return (await bookHasAdultTechniques(directory)) ? "adult" : "general"
  } catch {
    return "general"
  }
}

/** 章节级内容性质：调用方 agent 经工具参数给出；缺失/非法按 general（从紧）。 */
export function resolveChapterContentNature(param?: unknown): "adult" | "general" {
  return param === "adult" ? "adult" : "general"
}
