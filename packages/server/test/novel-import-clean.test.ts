/**
 * 书籍导入确定性清洗单测（book-import · 5.1）。
 * 5.2 的「整体开关」在 handler 编排层（关闭时不调用 cleanText，摘要全零），随 handler 测试覆盖。
 */
import { describe, expect, test } from "bun:test"
import { cleanText, emptyCleanSummary } from "../src/handlers/novel-import/clean"

describe("cleanText", () => {
  test("行空白裁剪计数", () => {
    const { text, summary } = cleanText("  正文第一行。  \n\t正文第二行。\t")
    expect(text).toBe("正文第一行。\n正文第二行。")
    expect(summary.whitespaceTrimmed).toBe(2)
  })

  test("空行折叠为单段分隔", () => {
    const { text, summary } = cleanText("第一段。\n\n\n\n第二段。")
    expect(text).toBe("第一段。\n\n第二段。")
    expect(summary.blankLinesCollapsed).toBe(2)
  })

  test("半角标点归一（引号与小数点不动）", () => {
    const { text, summary } = cleanText("你好,世界!他说\"3.5\":ok?")
    expect(text).toBe("你好，世界！他说\"3.5\"：ok？")
    expect(summary.punctuationNormalized).toBe(4)
  })

  test("误断行合并为完整段落", () => {
    const raw = "清晨的风从东方吹来\n带着一丝凉意\n他出发了。\n\n新段落不受影响。"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("清晨的风从东方吹来带着一丝凉意他出发了。\n\n新段落不受影响。")
    expect(summary.linesMerged).toBe(2)
  })

  test("章题行不参与误断行合并", () => {
    const raw = "上一段没有句号的结尾\n第二章 风起\n第二章正文。"
    const { text, summary } = cleanText(raw)
    expect(text).toContain("\n第二章 风起\n")
    expect(summary.linesMerged).toBe(0)
  })

  test("广告行清除", () => {
    const raw = ["第一章 开局", "正文内容。", "最新网址 www.example.com", "请记住本书首发域名", "下一段正文。"].join("\n")
    const { text, summary } = cleanText(raw)
    expect(text).not.toContain("www.example.com")
    expect(text).not.toContain("首发域名")
    expect(text).toContain("正文内容。")
    expect(text).toContain("下一段正文。")
    expect(summary.adsRemoved).toBe(2)
  })

  test("长正文提及站点名不误删", () => {
    const longLine = `他曾在笔趣阁打工多年，${"经历".repeat(30)}，这段岁月塑造了他。`
    const { text, summary } = cleanText(longLine)
    expect(text).toContain(longLine.trim())
    expect(summary.adsRemoved).toBe(0)
  })

  test("逐行机械重复清除", () => {
    const raw = "正文行。\n重复行\n重复行\n重复行\n\n结尾行。"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("正文行。\n重复行\n\n结尾行。")
    expect(summary.duplicatesRemoved).toBe(2)
  })

  test("各项计数互不污染", () => {
    const raw = "  你好,世界  \n\n\n\n他来了\n他来了\n本章完"
    const { summary } = cleanText(raw)
    expect(summary.whitespaceTrimmed).toBe(1)
    expect(summary.blankLinesCollapsed).toBe(2)
    expect(summary.punctuationNormalized).toBe(1)
    expect(summary.duplicatesRemoved).toBe(1)
    expect(summary.adsRemoved).toBe(1)
  })

  test("空文本安全返回", () => {
    const { text, summary } = cleanText("")
    expect(text).toBe("")
    expect(summary).toEqual(emptyCleanSummary())
  })
})
