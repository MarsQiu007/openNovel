/**
 * 书籍导入向导纯函数单测（book-import）。
 */
import { describe, expect, test } from "bun:test"
import {
  IMPORT_SUPPORTED_EXTENSIONS,
  buildImportTidyPrompt,
  importFilenameToTitle,
  isSupportedImportFileName,
} from "./book-import-utils"

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

describe("buildImportTidyPrompt", () => {
  const input = { novelID: "novel-1", title: "斗破苍穹", volumeCount: 3, chapterCount: 42 }

  test("指令含小说 ID、书名与卷章规模", () => {
    const prompt = buildImportTidyPrompt(input)
    expect(prompt).toContain("novel-1")
    expect(prompt).toContain("斗破苍穹")
    expect(prompt).toContain("3 卷 / 42 章")
  })

  test("编排覆盖错别字校对与设定/角色抽取", () => {
    const prompt = buildImportTidyPrompt(input)
    expect(prompt).toContain("错别字")
    expect(prompt).toContain("list_chapters")
    expect(prompt).toContain("read_chapter_content")
    expect(prompt).toContain("lint_settings")
    expect(prompt).toContain('organize_settings(action="analyze")')
    expect(prompt).toContain('organize_settings(action="batch")')
  })

  test("审阅流约束：产出进收件箱、禁止直改正文与旁路改设定", () => {
    const prompt = buildImportTidyPrompt(input)
    expect(prompt).toContain("审阅收件箱")
    expect(prompt).toContain("禁止直接修改章节正文")
    expect(prompt).toContain("章节定位 + 原文/建议对照")
    expect(prompt).toContain("旁路")
    expect(prompt).toContain("禁止虚构 ID")
  })
})
