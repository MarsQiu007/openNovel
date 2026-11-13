import { describe, expect, test } from "bun:test"

import { gateAutoUpdate } from "./updater-signing"

const throwingProbe = () => {
  throw new Error("probe must not be called")
}

describe("gateAutoUpdate", () => {
  test("非 mac 平台始终允许，不发起签名探测", () => {
    expect(gateAutoUpdate("win32", true, throwingProbe)).toEqual({ allowed: true })
    expect(gateAutoUpdate("linux", true, throwingProbe)).toEqual({ allowed: true })
  })

  test("mac 未打包（开发态）允许，不发起签名探测", () => {
    expect(gateAutoUpdate("darwin", false, throwingProbe)).toEqual({ allowed: true })
  })

  test("mac 已签名打包产物允许自动更新", () => {
    expect(gateAutoUpdate("darwin", true, () => true)).toEqual({ allowed: true })
  })

  test("mac 未签名打包产物禁用自动更新并给出原因", () => {
    expect(gateAutoUpdate("darwin", true, () => false)).toEqual({
      allowed: false,
      reason: "unsigned macOS build cannot auto-update",
    })
  })
})
