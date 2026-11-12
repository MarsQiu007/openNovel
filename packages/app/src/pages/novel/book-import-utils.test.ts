/**
 * 书籍导入向导纯函数单测（book-import）。
 */
import { describe, expect, test } from "bun:test"
import { IMPORT_SUPPORTED_EXTENSIONS, importFilenameToTitle, isSupportedImportFileName } from "./book-import-utils"

describe("isSupportedImportFileName", () => {
  test("TXT 与 Markdown 支持（含大写扩展名）", () => {
    expect(isSupportedImportFileName("book.txt")).toBe(true)
    expect(isSupportedImportFileName("book.md")).toBe(true)
    expect(isSupportedImportFileName("book.markdown")).toBe(true)
    expect(isSupportedImportFileName("BOOK.TXT")).toBe(true)
  })

  test("EPUB/DOCX 等不支持的格式", () => {
    expect(isSupportedImportFileName("book.epub")).toBe(false)
    expect(isSupportedImportFileName("book.docx")).toBe(false)
    expect(isSupportedImportFileName("book.pdf")).toBe(false)
    expect(isSupportedImportFileName("book")).toBe(false)
  })

  test("支持列表非空且均为点前缀小写", () => {
    expect(IMPORT_SUPPORTED_EXTENSIONS.length).toBeGreaterThan(0)
    for (const extension of IMPORT_SUPPORTED_EXTENSIONS) {
      expect(extension.startsWith(".")).toBe(true)
      expect(extension.toLowerCase()).toBe(extension)
    }
  })
})

describe("importFilenameToTitle", () => {
  test("去扩展名", () => {
    expect(importFilenameToTitle("斗破苍穹.txt")).toBe("斗破苍穹")
    expect(importFilenameToTitle("my book.md")).toBe("my book")
  })

  test("无扩展名回退原文件名", () => {
    expect(importFilenameToTitle("无扩展名")).toBe("无扩展名")
  })

  test("多点文件名只去末段", () => {
    expect(importFilenameToTitle("卷一.修订版.txt")).toBe("卷一.修订版")
  })
})
