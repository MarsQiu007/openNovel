import { describe, test, expect } from "bun:test"
import { chooseSoul } from "../../src/novel-writer/soul.js"

describe("chooseSoul", () => {
  test("小说灵魂非空时覆盖全局", () => {
    expect(chooseSoul("小说人格", "全局人格")).toBe("小说人格")
  })

  test("小说灵魂为空时回落全局", () => {
    expect(chooseSoul(undefined, "全局人格")).toBe("全局人格")
    expect(chooseSoul("", "全局人格")).toBe("全局人格")
    expect(chooseSoul("   ", "全局人格")).toBe("全局人格")
  })

  test("非小说会话（无小说灵魂）使用全局", () => {
    expect(chooseSoul(undefined, "全局人格")).toBe("全局人格")
  })

  test("都为空时不注入", () => {
    expect(chooseSoul(undefined, undefined)).toBeUndefined()
    expect(chooseSoul("", "")).toBeUndefined()
    expect(chooseSoul("  ", " \n ")).toBeUndefined()
  })
})
