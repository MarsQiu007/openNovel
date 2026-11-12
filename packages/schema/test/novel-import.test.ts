/**
 * 书籍导入契约单测（book-import）。
 *
 * 覆盖 NovelImportAnalyzeInput / NovelImportApplyInput 的解码往返与非法输入拒绝，
 * 以及预览/报告结构的最小合法样本往返。解析行为本身在 server 包测试。
 */
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  NovelImportAnalyzeInput,
  NovelImportApplyInput,
  NovelImportPreview,
  NovelImportReport,
} from "../src/novel"

const analyzeSample = {
  dataUrl: "data:text/plain;base64,5Zu+6Zui55qE5paH56ug",
  filename: "demo.txt",
  cleanEnabled: true,
}

describe("NovelImportAnalyzeInput", () => {
  test("合法样本解码往返", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportAnalyzeInput)(analyzeSample)
    expect(decoded).toEqual(analyzeSample)
  })

  test("可显式指定编码", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportAnalyzeInput)({
      ...analyzeSample,
      encoding: "gb18030",
    })
    expect(decoded.encoding).toBe("gb18030")
  })

  test("可携带等长分章兜底选项", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportAnalyzeInput)({
      ...analyzeSample,
      fallbackFixedLength: true,
    })
    expect(decoded.fallbackFixedLength).toBe(true)
  })

  test("空 dataUrl 拒绝", () => {
    expect(() => Schema.decodeUnknownSync(NovelImportAnalyzeInput)({ ...analyzeSample, dataUrl: "" })).toThrow()
  })

  test("空 filename 拒绝", () => {
    expect(() => Schema.decodeUnknownSync(NovelImportAnalyzeInput)({ ...analyzeSample, filename: "" })).toThrow()
  })

  test("非布尔 cleanEnabled 拒绝", () => {
    expect(() =>
      Schema.decodeUnknownSync(NovelImportAnalyzeInput)({ ...analyzeSample, cleanEnabled: "yes" }),
    ).toThrow()
  })

  test("未知编码取值拒绝", () => {
    expect(() =>
      Schema.decodeUnknownSync(NovelImportAnalyzeInput)({ ...analyzeSample, encoding: "shift-jis" }),
    ).toThrow()
  })

  test("缺字段拒绝", () => {
    expect(() => Schema.decodeUnknownSync(NovelImportAnalyzeInput)({ filename: "demo.txt" })).toThrow()
  })
})

describe("NovelImportApplyInput", () => {
  const applySample = {
    previewToken: "v1.abc123",
    title: "导入的书",
    dataUrl: analyzeSample.dataUrl,
    filename: "demo.txt",
    cleanEnabled: false,
  }

  test("合法样本解码往返", () => {
    const decoded = Schema.decodeUnknownSync(NovelImportApplyInput)(applySample)
    expect(decoded).toEqual(applySample)
  })

  test("空书名拒绝", () => {
    expect(() => Schema.decodeUnknownSync(NovelImportApplyInput)({ ...applySample, title: "" })).toThrow()
  })

  test("缺 previewToken 拒绝", () => {
    const { previewToken: _omit, ...rest } = applySample
    expect(() => Schema.decodeUnknownSync(NovelImportApplyInput)(rest)).toThrow()
  })
})

describe("NovelImportPreview / NovelImportReport 结构往返", () => {
  const cleanSummary = {
    whitespaceTrimmed: 1,
    blankLinesCollapsed: 2,
    punctuationNormalized: 3,
    linesMerged: 4,
    adsRemoved: 5,
    duplicatesRemoved: 6,
  }
  const issue = { type: "sequence-gap", message: "第 3 章后跳至第 5 章", chapterNumber: 3 } as const

  test("预览最小样本往返", () => {
    const sample = {
      suggestedTitle: "demo",
      encoding: "utf-8" as const,
      volumes: [
        {
          title: null,
          chapters: [{ title: "第一章 风起", wordCount: 10, contentHash: "ab12" }],
        },
      ],
      issues: [issue],
      cleanSummary,
      previewToken: "v1.hash",
    }
    expect(Schema.decodeUnknownSync(NovelImportPreview)(sample)).toEqual(sample)
  })

  test("报告最小样本往返", () => {
    const sample = {
      novelId: "n1",
      title: "demo",
      volumeCount: 1,
      chapterCount: 1,
      cleanSummary,
      issues: [issue],
    }
    expect(Schema.decodeUnknownSync(NovelImportReport)(sample)).toEqual(sample)
  })

  test("负数计数拒绝", () => {
    const sample = {
      novelId: "n1",
      title: "demo",
      volumeCount: -1,
      chapterCount: 1,
      cleanSummary: {
        whitespaceTrimmed: 0,
        blankLinesCollapsed: 0,
        punctuationNormalized: 0,
        linesMerged: 0,
        adsRemoved: 0,
        duplicatesRemoved: 0,
      },
      issues: [],
    }
    expect(() => Schema.decodeUnknownSync(NovelImportReport)(sample)).toThrow()
  })
})
