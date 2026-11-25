import { describe, expect, test } from "bun:test"
import { canConfirmImport, importSourceInput, shouldResetImportTitle } from "./book-import-input"

const file = { name: "book.txt", dataUrl: "data:text/plain;base64,dGV4dA==" }

describe("书籍导入解析输入", () => {
  test("analyze 携带固定长度分章开关", () => {
    expect(importSourceInput(file, { cleanEnabled: true, encoding: "auto", fallbackFixedLength: true })).toEqual({
      dataUrl: file.dataUrl,
      filename: file.name,
      cleanEnabled: true,
      fallbackFixedLength: true,
    })
  })

  test("显式编码覆盖 auto 编码", () => {
    expect(importSourceInput(file, { cleanEnabled: false, encoding: "gb18030", fallbackFixedLength: false })).toEqual({
      dataUrl: file.dataUrl,
      filename: file.name,
      cleanEnabled: false,
      encoding: "gb18030",
      fallbackFixedLength: false,
    })
  })
})

describe("书籍导入确认状态", () => {
  const recognizedPreview = { volumes: [{ title: "第一卷" }] }

  test("重新分析期间禁止提交旧预览", () => {
    expect(canConfirmImport({ title: "书名", preview: recognizedPreview, fallbackFixedLength: true, analyzing: true, applying: false })).toBe(false)
  })

  test("固定长度预览就绪后允许确认", () => {
    expect(canConfirmImport({ title: "书名", preview: { volumes: [] }, fallbackFixedLength: true, analyzing: false, applying: false })).toBe(true)
  })
})

describe("书籍导入书名重置", () => {
  test("首次分析重置书名，兜底重分析保留书名", () => {
    expect(shouldResetImportTitle(null)).toBe(true)
    expect(shouldResetImportTitle({ volumes: [] })).toBe(false)
  })
})
