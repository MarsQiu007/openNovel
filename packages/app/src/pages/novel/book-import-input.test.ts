import { describe, expect, test } from "bun:test"
import { DEFAULT_SPLIT_RANGE, canConfirmImport, importSourceInput, isValidSplitRange, shouldResetImportTitle } from "./book-import-input"

const file = { name: "book.txt", dataUrl: "data:text/plain;base64,dGV4dA==" }

describe("书籍导入解析输入", () => {
  test("analyze 携带兜底分章开关与字数范围", () => {
    expect(
      importSourceInput(file, { cleanEnabled: true, encoding: "auto", fallbackFixedLength: true, splitRange: { min: 2000, max: 3000 } }),
    ).toEqual({
      dataUrl: file.dataUrl,
      filename: file.name,
      cleanEnabled: true,
      fallbackFixedLength: true,
      splitRange: { min: 2000, max: 3000 },
    })
  })

  test("显式编码覆盖 auto 编码", () => {
    expect(
      importSourceInput(file, { cleanEnabled: false, encoding: "gb18030", fallbackFixedLength: false, splitRange: DEFAULT_SPLIT_RANGE }),
    ).toEqual({
      dataUrl: file.dataUrl,
      filename: file.name,
      cleanEnabled: false,
      encoding: "gb18030",
      fallbackFixedLength: false,
      splitRange: DEFAULT_SPLIT_RANGE,
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

describe("兜底分章字数范围校验", () => {
  test("默认范围合法", () => {
    expect(isValidSplitRange(DEFAULT_SPLIT_RANGE)).toBe(true)
  })

  test("下限不小于上限非法", () => {
    expect(isValidSplitRange({ min: 3000, max: 2000 })).toBe(false)
    expect(isValidSplitRange({ min: 2000, max: 2000 })).toBe(false)
  })

  test("越界与非整数非法", () => {
    expect(isValidSplitRange({ min: 100, max: 3000 })).toBe(false)
    expect(isValidSplitRange({ min: 2000, max: 50000 })).toBe(false)
    expect(isValidSplitRange({ min: 2000.5, max: 3000 })).toBe(false)
  })
})
