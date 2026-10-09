/**
 * 网文字数口径单测（countWords）。
 *
 * 口径：汉字逐字计数 + 英文/数字按词计数，不含标点、空白、换行。
 * 该口径是全仓 chapters/chapter_versions 表 word_count 的唯一事实源。
 */
import { describe, expect, test } from "bun:test"
import { countWords } from "../src/schema"

describe("countWords 网文字数口径", () => {
  test("纯汉字逐字计数", () => {
    expect(countWords("第一章正文内容")).toBe(7)
  })

  test("汉字夹标点不计标点", () => {
    expect(countWords("清晨，薄雾笼罩。")).toBe(6)
  })

  test("中英混排各计各的", () => {
    expect(countWords("abc中文123")).toBe(4)
  })

  test("全英文按词计数", () => {
    expect(countWords("hello world foo")).toBe(3)
  })

  test("空白与换行不计", () => {
    expect(countWords("段落一\n\n段落二")).toBe(6)
    expect(countWords("  hello \t world  ")).toBe(2)
  })

  test("空串为 0", () => {
    expect(countWords("")).toBe(0)
  })

  test("纯标点不计数", () => {
    expect(countWords("，。！？……")).toBe(0)
  })
})
