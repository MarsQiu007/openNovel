import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { icons, resolveIcon, symbolId } from "./icon-registry"

const originalWarn = console.warn
let warnCalls: unknown[][] = []

beforeEach(() => {
  warnCalls = []
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args)
  }
})

afterEach(() => {
  console.warn = originalWarn
})

describe("v2 图标注册表", () => {
  test("delete/info 已注册且对齐 16 视窗，解析到各自 symbol id", () => {
    expect(icons.delete.viewBox).toBe("0 0 16 16")
    expect(icons.info.viewBox).toBe("0 0 16 16")
    expect(resolveIcon("delete")).toEqual({ viewBox: "0 0 16 16", missing: false })
    expect(resolveIcon("info")).toEqual({ viewBox: "0 0 16 16", missing: false })
    expect(symbolId("delete")).toBe("opennovel-v2-icon-delete")
    expect(symbolId("info")).toBe("opennovel-v2-icon-info")
    expect(warnCalls.length).toBe(0)
  })

  test("既有注册名不受影响且不告警", () => {
    expect(resolveIcon("book")).toEqual({ viewBox: "0 0 16 16", missing: false })
    expect(symbolId("book")).toBe("opennovel-v2-icon-book")
    expect(warnCalls.length).toBe(0)
  })
})

describe("v2 图标未知名兜底", () => {
  test("未知名解析为 missing，symbol id 指向不存在的注册条目（渲染空白），且告警一次", () => {
    const resolved = resolveIcon("definitely-missing-icon")
    expect(resolved).toEqual({ viewBox: "0 0 16 16", missing: true })
    expect("definitely-missing-icon" in icons).toBe(false)
    expect(symbolId("definitely-missing-icon")).toBe("opennovel-v2-icon-definitely-missing-icon")
    expect(warnCalls.length).toBe(1)
    expect(String(warnCalls[0][0])).toContain("definitely-missing-icon")
  })
})
