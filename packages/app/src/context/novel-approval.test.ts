import { describe, expect, test } from "bun:test"
import { isAnySessionWorking } from "./novel-approval"

describe("isAnySessionWorking", () => {
  const isWorking = (sessionID: string) => sessionID === "busy"

  test("空绑定列表永远不活跃", () => {
    expect(isAnySessionWorking([], isWorking)).toBe(false)
  })

  test("当前书绑定会话运行时活跃", () => {
    expect(isAnySessionWorking(["idle", "busy"], isWorking)).toBe(true)
  })

  test("其他书会话运行不影响当前书", () => {
    expect(isAnySessionWorking(["idle", "other"], isWorking)).toBe(false)
  })
})