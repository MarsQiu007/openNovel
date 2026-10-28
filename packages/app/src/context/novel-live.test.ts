import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { createSignal } from "solid-js"
import { createNovelInvalidator, isNovelLiveKey, shouldInvalidateNovelSessionUpdate } from "./novel-live"

const directory = "C:/Novels/Live"

describe("isNovelLiveKey", () => {
  test("命中本目录本小说的读取族 key（含 bound-sessions）", () => {
    expect(isNovelLiveKey(["novel", "detail", directory, "book-a"], directory, "book-a")).toBe(true)
    expect(isNovelLiveKey(["novel", "bound-sessions", directory, "book-a"], directory, "book-a")).toBe(true)
  })

  test("排除单章正文/版本/批注与目录、小说不匹配的 key", () => {
    expect(isNovelLiveKey(["novel", "chapter", directory, "book-a", "ch-1"], directory, "book-a")).toBe(false)
    expect(
      isNovelLiveKey(["novel", "chapter-versions", directory, "book-a", "ch-1"], directory, "book-a"),
    ).toBe(false)
    expect(isNovelLiveKey(["novel", "annotations", directory, "book-a", "chapter", "ch-1"], directory, "book-a")).toBe(
      false,
    )
    expect(isNovelLiveKey(["novel", "detail", "C:/Other", "book-a"], directory, "book-a")).toBe(false)
    expect(isNovelLiveKey(["novel", "detail", directory, "book-b"], directory, "book-a")).toBe(false)
    expect(isNovelLiveKey(["session", directory, "book-a"], directory, "book-a")).toBe(false)
  })
})

describe("shouldInvalidateNovelSessionUpdate", () => {
  test("绑定会话的标题更新立即失效书内会话列表", () => {
    const bound = new Set(["ses-bound"])
    const updated = { type: "session.next.updated", properties: { sessionID: "ses-bound", title: "撰写" } }

    expect(shouldInvalidateNovelSessionUpdate(updated, bound)).toBe(true)
    expect(shouldInvalidateNovelSessionUpdate(updated, new Set(["ses-other"]))).toBe(false)
    expect(
      shouldInvalidateNovelSessionUpdate(
        { type: "session.next.text.delta", properties: { sessionID: "ses-bound" } },
        bound,
      ),
    ).toBe(false)
  })
})

describe("createNovelInvalidator", () => {
  test("每次调用按当前位置失效：切书后命中新书、不再命中旧书", async () => {
    const queryClient = new QueryClient()
    const [current, setCurrent] = createSignal("book-a")
    const invalidate = createNovelInvalidator({
      queryClient,
      directory: () => directory,
      novelID: current,
    })

    const keyA = ["novel", "detail", directory, "book-a"] as const
    const keyB = ["novel", "detail", directory, "book-b"] as const

    // 阶段一：停在 book-a 时失效只命中 A
    queryClient.setQueryData(keyA, { id: "book-a" })
    queryClient.setQueryData(keyB, { id: "book-b" })
    await invalidate()
    expect(queryClient.getQueryState(keyA)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keyB)?.isInvalidated).toBe(false)

    // 阶段二：切到 book-b 后清缓存重种，失效只命中 B——作用域随 accessor 移动
    queryClient.clear()
    queryClient.setQueryData(keyA, { id: "book-a" })
    queryClient.setQueryData(keyB, { id: "book-b" })
    setCurrent("book-b")
    await invalidate()
    expect(queryClient.getQueryState(keyB)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keyA)?.isInvalidated).toBe(false)
  })
})