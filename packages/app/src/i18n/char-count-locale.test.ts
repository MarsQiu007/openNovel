/**
 * 章节编辑器字数词条占位符契约（chapter-length-range）。
 *
 * 不受 parity 套件 skipIf(CI) 约束的 micro 用例：charCount（区间）与
 * charCountMin（仅下限）两词条在 zh/zht/en 三 locale 必须存在且占位符清单一致，
 * 防止单 locale 缺占位符时模板按字面量原样输出。
 */
import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

const CHAR_COUNT_PLACEHOLDERS = ["count", "min", "max"]
const CHAR_COUNT_MIN_PLACEHOLDERS = ["count", "min"]

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])
}

describe("charCount 词条占位符契约", () => {
  const locales = { zh, zht, en } as const

  test("charCount（区间词条）三 locale 存在且占位符一致", () => {
    for (const [name, dict] of Object.entries(locales)) {
      const template = dict["novel.editor.charCount"]
      expect(template, `${name} 缺 novel.editor.charCount`).toBeString()
      expect(placeholders(template), `${name} charCount 占位符`).toEqual(CHAR_COUNT_PLACEHOLDERS)
    }
  })

  test("charCountMin（仅下限词条）三 locale 存在且占位符一致", () => {
    for (const [name, dict] of Object.entries(locales)) {
      const template = dict["novel.editor.charCountMin"]
      expect(template, `${name} 缺 novel.editor.charCountMin`).toBeString()
      expect(placeholders(template), `${name} charCountMin 占位符`).toEqual(CHAR_COUNT_MIN_PLACEHOLDERS)
    }
  })

  test("旧 target 占位符词条与孤儿键不残留", () => {
    for (const dict of Object.values(locales)) {
      expect(dict["novel.editor.charCount"]).not.toContain("{{target}}")
      // 字面量类型 dict 不再含有孤儿键，用 in 判存在性（索引会类型报错）
      expect("novel.editor.target" in dict).toBe(false)
      expect("novel.editor.wordCount" in dict).toBe(false)
    }
  })
})
