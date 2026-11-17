import { describe, expect, test } from "bun:test"
import { pathKey } from "./path-key"

describe("pathKey", () => {
  test("unifies separators for windows paths", () => {
    expect(String(pathKey("D:\\novels\\book"))).toBe("D:/novels/book")
    expect(String(pathKey("D:/novels/book"))).toBe("D:/novels/book")
    expect(String(pathKey("D:/novels\\book"))).toBe("D:/novels/book")
  })

  test("trims trailing slashes", () => {
    expect(String(pathKey("D:/novels/book/"))).toBe("D:/novels/book")
    expect(String(pathKey("D:\\novels\\book\\"))).toBe("D:/novels/book")
    expect(String(pathKey("/tmp/foo/"))).toBe("/tmp/foo")
  })

  test("completes bare drive roots", () => {
    expect(String(pathKey("D:"))).toBe("D:/")
    expect(String(pathKey("C:\\"))).toBe("C:/")
  })

  test("keeps posix paths verbatim except trailing slashes", () => {
    expect(String(pathKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
    expect(String(pathKey("/"))).toBe("/")
    expect(String(pathKey("//server/share"))).toBe("//server/share")
  })
})
