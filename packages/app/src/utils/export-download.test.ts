import { describe, expect, test } from "bun:test"
import { createExportBlob } from "./export-download"

describe("createExportBlob", () => {
  test("Markdown 使用 UTF-8 文本 MIME", async () => {
    const blob = createExportBlob("# 书名", "markdown")
    expect(blob.type).toBe("text/markdown;charset=utf-8")
    expect(await blob.text()).toBe("# 书名")
  })

  test("TXT 使用纯文本 MIME", async () => {
    const blob = createExportBlob("书名", "txt")
    expect(blob.type).toBe("text/plain;charset=utf-8")
  })

  test("EPUB 将 Base64 转为二进制 MIME", async () => {
    const blob = createExportBlob(btoa([0, 1, 2, 3].map((value) => String.fromCharCode(value)).join("")), "epub")
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(blob.type).toBe("application/epub+zip")
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3])
  })
})