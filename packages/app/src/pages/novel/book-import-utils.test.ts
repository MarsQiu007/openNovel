/**
 * 书籍导入向导纯函数单测（book-import）。
 */
import { describe, expect, test } from "bun:test"
import {
  IMPORT_SUPPORTED_EXTENSIONS,
  buildAiSplitPrompt,
  buildImportPipelinePrompt,
  importFilenameToTitle,
  isSupportedImportFileName,
} from "./book-import-utils"
import { canConfirmImport } from "./book-import-input"

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

describe("canConfirmImport（AI 拆章）", () => {
  const base = {
    title: "测试书",
    fallbackFixedLength: false,
    analyzing: false,
    applying: false,
  }

  test("AI 拆章预览无卷章树也允许确认", () => {
    expect(canConfirmImport({ ...base, splitMode: "ai", preview: { volumes: [] } })).toBe(true)
  })

  test("快速拆章预览无卷章且未开兜底时仍拒绝", () => {
    expect(canConfirmImport({ ...base, preview: { volumes: [] } })).toBe(false)
  })
})

describe("buildAiSplitPrompt", () => {
  test("指令含小说 ID、书名、预估章数与队列形态", () => {
    const prompt = buildAiSplitPrompt({ novelID: "nv-1", title: "测试书", estimatedChapters: 12 })
    expect(prompt).toContain("nv-1")
    expect(prompt).toContain("《测试书》")
    expect(prompt).toContain("12")
    expect(prompt).toContain("AI 组章")
    expect(prompt).toContain("@cutter")
    expect(prompt).toContain("@cleaner")
  })

  test("约束覆盖失败暂停、清洗护栏与设定自动入库", () => {
    const prompt = buildAiSplitPrompt({ novelID: "nv-1", title: "测试书", estimatedChapters: 3 })
    expect(prompt).toContain("MUST NOT 静默改用脚本拆分")
    expect(prompt).toContain("10%")
    expect(prompt).toContain("自动入库")
  })
})

describe("buildImportPipelinePrompt", () => {
  const input = { novelID: "novel-1", title: "斗破苍穹", volumeCount: 3, chapterCount: 42 }

  test("指令含小说 ID、书名与卷章规模", () => {
    const prompt = buildImportPipelinePrompt(input)
    expect(prompt).toContain("novel-1")
    expect(prompt).toContain("斗破苍穹")
    expect(prompt).toContain("3 卷 / 42 章")
  })

  test("指令指向导入整理工作队列流程", () => {
    const prompt = buildImportPipelinePrompt(input)
    expect(prompt).toContain("导入后整理")
    expect(prompt).toContain("工作队列")
    expect(prompt).toContain("分章结构校验")
    expect(prompt).toContain("单读三产出")
    expect(prompt).toContain("书籍简介生成")
    expect(prompt).toContain("汇总汇报")
  })

  test("审阅流约束：纠错禁直改正文、设定禁旁路、已有队列不重复建队", () => {
    const prompt = buildImportPipelinePrompt(input)
    expect(prompt).toContain("章节定位 + 原文/建议对照")
    expect(prompt).toContain("禁止直改章节正文")
    expect(prompt).toContain("设定审阅收件箱")
    expect(prompt).toContain("unverified")
    expect(prompt).toContain("update_setting / delete_setting")
    expect(prompt).toContain("不重复建队")
  })
})
