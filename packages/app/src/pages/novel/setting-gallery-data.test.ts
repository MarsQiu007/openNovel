import { describe, expect, test } from "bun:test"
import { avatarOf, moveItem, validateImageFile } from "./setting-gallery-data"

describe("validateImageFile", () => {
  test("超上限拒绝", () => {
    expect(validateImageFile({ size: 5 * 1024 * 1024 + 1, type: "image/png" })).toBe("tooLarge")
  })

  test("上限内且白名单类型通过", () => {
    expect(validateImageFile({ size: 1024, type: "image/png" })).toBeNull()
    expect(validateImageFile({ size: 5 * 1024 * 1024, type: "image/webp" })).toBeNull()
  })

  test("非白名单类型拒绝", () => {
    expect(validateImageFile({ size: 10, type: "image/svg+xml" })).toBe("badType")
    expect(validateImageFile({ size: 10, type: "" })).toBe("badType")
  })
})

describe("moveItem", () => {
  const ids = ["a", "b", "c"]

  test("上移与下移交换相邻位置", () => {
    expect(moveItem(ids, "b", -1)).toEqual(["b", "a", "c"])
    expect(moveItem(ids, "b", 1)).toEqual(["a", "c", "b"])
  })

  test("越界保持原列表", () => {
    expect(moveItem(ids, "a", -1)).toBe(ids)
    expect(moveItem(ids, "c", 1)).toBe(ids)
  })

  test("未知 id 保持原列表", () => {
    expect(moveItem(ids, "x", 1)).toBe(ids)
  })
})

describe("avatarOf", () => {
  test("取排序最前的图片", () => {
    expect(
      avatarOf([
        { id: "b", sortOrder: 1, createdAt: 1 },
        { id: "a", sortOrder: 0, createdAt: 9 },
      ]),
    ).toBe("a")
  })

  test("同序按创建时间取先者", () => {
    expect(
      avatarOf([
        { id: "late", sortOrder: 0, createdAt: 5 },
        { id: "early", sortOrder: 0, createdAt: 2 },
      ]),
    ).toBe("early")
  })

  test("空列表返回 null", () => {
    expect(avatarOf([])).toBeNull()
  })
})
