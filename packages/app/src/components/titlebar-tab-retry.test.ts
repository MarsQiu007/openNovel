import { describe, expect, test } from "bun:test"
import { shouldRetryNovelDetail } from "./titlebar-tab-retry"

describe("标题栏书籍标签详情重试", () => {
  test("确定性 NotFound 不重试", () => {
    const notFound = new Error("request failed", {
      cause: { name: "NovelNotFoundError", data: { novelID: "novel-id" } },
    })
    expect(shouldRetryNovelDetail(notFound)).toBe(false)
  })

  test("瞬态错误保留默认重试", () => {
    expect(shouldRetryNovelDetail(new Error("network disconnected"))).toBe(true)
  })
})
