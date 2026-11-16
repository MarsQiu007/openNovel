/**
 * chapter-length-bounds 纯函数单测。
 *
 * 覆盖 D2 读取口径（trim 先判 / Number 同源 / 下限缺省 2500 / 上限 ≤ 下限降级）
 * 与状态判定（退化态永不判 long）、i18n 选键前提（上限非数值按无上限）。
 */
import { describe, expect, test } from "bun:test"
import { DEFAULT_CHAPTER_LOWER, lengthProgressState, parseChapterLengthBounds } from "./chapter-length-bounds"

describe("parseChapterLengthBounds 读取口径", () => {
  test("合法区间原样解析", () => {
    expect(parseChapterLengthBounds({ chapter_length: "2000", chapter_length_max: "5000" })).toEqual({
      lower: 2000,
      upper: 5000,
    })
  })

  test("下限非法按 2500 缺省（abc/空串/纯空白/0/-3）", () => {
    for (const value of ["abc", "", "   ", "0", "-3"]) {
      expect(parseChapterLengthBounds({ chapter_length: value })).toEqual({ lower: DEFAULT_CHAPTER_LOWER, upper: null })
    }
    expect(parseChapterLengthBounds(undefined)).toEqual({ lower: DEFAULT_CHAPTER_LOWER, upper: null })
  })

  test("下限浮点按 floor", () => {
    expect(parseChapterLengthBounds({ chapter_length: "2500.7" }).lower).toBe(2500)
  })

  test("上限非法或 ≤ 下限降级 null（不设上限）", () => {
    const bounds = { chapter_length: "2000" }
    expect(parseChapterLengthBounds({ ...bounds, chapter_length_max: "abc" }).upper).toBeNull()
    expect(parseChapterLengthBounds({ ...bounds, chapter_length_max: "" }).upper).toBeNull()
    expect(parseChapterLengthBounds({ ...bounds, chapter_length_max: "   " }).upper).toBeNull()
    expect(parseChapterLengthBounds({ ...bounds, chapter_length_max: "1500" }).upper).toBeNull()
    expect(parseChapterLengthBounds({ ...bounds, chapter_length_max: "2000" }).upper).toBeNull()
  })

  test("空白包夹与浮点上限按数值生效", () => {
    expect(parseChapterLengthBounds({ chapter_length: "2000", chapter_length_max: " 5000 " }).upper).toBe(5000)
    expect(parseChapterLengthBounds({ chapter_length: "2000", chapter_length_max: "5000.9" }).upper).toBe(5000)
  })
})

describe("lengthProgressState 状态判定", () => {
  test("区间模式三态", () => {
    expect(lengthProgressState(1500, 2000, 5000)).toBe("short")
    expect(lengthProgressState(3500, 2000, 5000)).toBe("good")
    expect(lengthProgressState(5200, 2000, 5000)).toBe("long")
  })

  test("无上限退化态永不判 long", () => {
    expect(lengthProgressState(1500, 2000, null)).toBe("short")
    expect(lengthProgressState(3500, 2000, null)).toBe("good")
    expect(lengthProgressState(12000, 2000, null)).toBe("good")
  })

  test("上限 ≤ 下限退化态永不判 long", () => {
    expect(lengthProgressState(3000, 2000, 1500)).toBe("good")
    expect(lengthProgressState(3000, 2000, 2000)).toBe("good")
  })
})
