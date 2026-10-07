import { getBookContentNature } from "./session-store.js"

/**
 * 书级内容性质：读 novels 表 content_nature 显式列（默认 general，唯一判定来源）。
 * 任何失败按从紧回落 general（adult 候选不出现），不中断写作主流程。
 */
export async function resolveBookContentNature(directory?: string | null): Promise<"adult" | "general"> {
  try {
    return await getBookContentNature(directory)
  } catch {
    return "general"
  }
}

/** 章节级内容性质：调用方 agent 经工具参数给出；缺失/非法按 general（从紧）。 */
export function resolveChapterContentNature(param?: unknown): "adult" | "general" {
  return param === "adult" ? "adult" : "general"
}
