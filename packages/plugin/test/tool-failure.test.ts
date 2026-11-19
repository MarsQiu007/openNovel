import { describe, expect, test } from "bun:test"
import { isToolErrorCategory, ToolErrorCategories, toolFailure } from "@opennovel-ai/plugin/v2/effect"

describe("toolFailure", () => {
  test("每个词表类别的 name/message/code 稳定", () => {
    for (const category of ToolErrorCategories) {
      const error = toolFailure(category, "章节不存在", { code: "chapter_not_found" })
      expect(error.name).toBe(category)
      expect(error.message).toBe("章节不存在")
      expect((error as { code?: string }).code).toBe("chapter_not_found")
    }
  })

  test("省略 extras 时不带 code", () => {
    const error = toolFailure("not_found", "目标缺失")
    expect((error as { code?: unknown }).code).toBeUndefined()
  })

  test("词表守卫放行词表词、拒绝运行时类型名", () => {
    expect(isToolErrorCategory("not_found")).toBe(true)
    expect(isToolErrorCategory("internal")).toBe(true)
    expect(isToolErrorCategory("Error")).toBe(false)
    expect(isToolErrorCategory("TypeError")).toBe(false)
    expect(isToolErrorCategory("LLM.ToolFailure")).toBe(false)
    expect(isToolErrorCategory(undefined)).toBe(false)
    expect(isToolErrorCategory(42)).toBe(false)
  })
})
