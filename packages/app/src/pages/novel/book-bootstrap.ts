import type { ServerNovelDetailOutput } from "@opennovel-ai/client"

export type BootstrapBook = Pick<ServerNovelDetailOutput, "title" | "genre" | "synopsis">

export function shouldShowBootstrapSuggestion(input: {
  charactersLoaded: boolean
  worldEntriesLoaded: boolean
  characterCount: number
  worldEntryCount: number
}): boolean {
  return input.charactersLoaded && input.worldEntriesLoaded && input.characterCount === 0 && input.worldEntryCount === 0
}

export function buildBootstrapPrompt(book: BootstrapBook): string {
  return [
    "请初始化小说设定，生成故事圣经、题材规则书和开篇所需的核心设定，不要先写正文。",
    `书名：${book.title}`,
    `类型：${book.genre}`,
    `简介：${book.synopsis}`,
  ].join("\n")
}
