import { describe, expect, test } from "bun:test"
import { Global } from "@opennovel-ai/core/global"
import { resolveDirectory } from "../src/location"

// location 目录哨兵：`global` 解析为全局数据目录，其余值原样保留
describe("resolveDirectory", () => {
  test("global 哨兵解析为全局数据目录", () => {
    expect(resolveDirectory("global")).toBe(Global.Path.data)
  })

  test("绝对路径原样保留", () => {
    expect(resolveDirectory("D:\\novels\\book")).toBe("D:\\novels\\book")
    expect(resolveDirectory("/tmp/book")).toBe("/tmp/book")
  })

  test("不做大小写归一", () => {
    expect(resolveDirectory("Global")).toBe("Global")
  })
})