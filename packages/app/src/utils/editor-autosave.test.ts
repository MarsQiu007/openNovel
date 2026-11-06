import { describe, test, expect } from "bun:test"
import {
  AUTO_SAVE_INTERVAL_DEFAULT,
  AUTO_SAVE_INTERVAL_OPTIONS,
  resolveAutoSaveInterval,
} from "./editor-autosave"

describe("resolveAutoSaveInterval", () => {
  test("合法选项原样返回", () => {
    for (const option of AUTO_SAVE_INTERVAL_OPTIONS) {
      expect(resolveAutoSaveInterval(option)).toBe(option)
    }
  })

  test("缺省与非法值回退默认", () => {
    expect(resolveAutoSaveInterval(undefined)).toBe(AUTO_SAVE_INTERVAL_DEFAULT)
    expect(resolveAutoSaveInterval(null)).toBe(AUTO_SAVE_INTERVAL_DEFAULT)
    expect(resolveAutoSaveInterval("60000")).toBe(AUTO_SAVE_INTERVAL_DEFAULT)
    expect(resolveAutoSaveInterval(0)).toBe(AUTO_SAVE_INTERVAL_DEFAULT)
    expect(resolveAutoSaveInterval(45_000)).toBe(AUTO_SAVE_INTERVAL_DEFAULT)
    expect(resolveAutoSaveInterval(Number.NaN)).toBe(AUTO_SAVE_INTERVAL_DEFAULT)
  })

  test("默认值在合法选项内", () => {
    expect(AUTO_SAVE_INTERVAL_OPTIONS).toContain(AUTO_SAVE_INTERVAL_DEFAULT)
  })
})
