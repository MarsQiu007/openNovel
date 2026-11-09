import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opennovel-ai/core/config/v1/config"

const decode = (input: unknown) => Schema.decodeUnknownSync(ConfigV1.Info)(input)

describe("ConfigV1.Info toolInsight 字段", () => {
  test("缺省 payload 不被解码默认值物化成覆盖写", () => {
    const info = decode({})
    expect(Object.hasOwn(info, "toolInsight")).toBe(false)
  })

  test("显式 payload 原样保留 enabled 与 directory", () => {
    const info = decode({ toolInsight: { enabled: true, directory: "D:/novel-logs" } })
    expect(info.toolInsight).toEqual({ enabled: true, directory: "D:/novel-logs" })
  })

  test("enabled 类型非法时整体解码失败，不静默修正", () => {
    expect(() => decode({ toolInsight: { enabled: "yes" } })).toThrow()
  })
})
