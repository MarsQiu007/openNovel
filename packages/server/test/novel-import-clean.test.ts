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

  test("逐行机械重复清除，残留短行随段内句间聚合", () => {
    const raw = "正文行。\n重复行\n重复行\n重复行\n\n结尾行。"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("正文行。重复行\n\n结尾行。")
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

  test("硬换行书段内句末碎行聚合为完整段落", () => {
    const raw = "　　他站起身，走到窗前。天色已经暗了下来。\n远处的灯火次第亮起。他转身回到桌前。\n\n　　第二段从这里开始。"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("他站起身，走到窗前。天色已经暗了下来。远处的灯火次第亮起。他转身回到桌前。\n\n第二段从这里开始。")
    expect(summary.linesMerged).toBe(1)
  })

  test("缩进新段不被并入上一段", () => {
    const raw = "　　第一段结束。\n　　第二段开始。"
    const { text } = cleanText(raw)
    expect(text).toBe("第一段结束。\n第二段开始。")
  })

  test("右引号结尾的对话段保护（无缩进书）", () => {
    const raw = "“你来了。”\n他点头。\n“我来了。”"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("“你来了。”\n他点头。\n“我来了。”")
    expect(summary.linesMerged).toBe(0)
  })

  test("对话段后接叙述行不粘连（信号有效书）", () => {
    const raw = "　　“你来了。”\n他点头致意，\n　　“我来了。”\n\n　　下一段。"
    const { text } = cleanText(raw)
    expect(text).toBe("“你来了。”\n他点头致意，\n“我来了。”\n\n下一段。")
  })

  test("护栏回退：无段落信号的书句末不合并", () => {
    const raw = "第一句结束了。\n第二句也结束了。\n第三句。"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("第一句结束了。\n第二句也结束了。\n第三句。")
    expect(summary.linesMerged).toBe(0)
  })

  test("护栏回退：逐行缩进的诗歌版式不误判聚合", () => {
    const raw = "　　床前明月光。\n　　疑是地上霜。\n　　举头望明月。\n　　低头思故乡。"
    const { text, summary } = cleanText(raw)
    expect(text).toBe("床前明月光。\n疑是地上霜。\n举头望明月。\n低头思故乡。")
    expect(summary.linesMerged).toBe(0)
  })

  test("中英文混排合并补空格", () => {
    const raw = "　　他说 Hello\nworld 然后离开。"
    const { text } = cleanText(raw)
    expect(text).toBe("他说 Hello world 然后离开。")
  })

  test("场景分隔线独立成段", () => {
    const raw = "　　上一幕结束。\n***\n　　下一幕开始。"
    const { text } = cleanText(raw)
    expect(text).toBe("上一幕结束。\n***\n下一幕开始。")
  })

  test("网址广告行清除且不粘连正文", () => {
    const raw = "本书下载自搜书吧：www.soushu2022.com\n备用地址：www.soushu2023.com\n　　正文第一段开始，\n没有缩进的续行。"
    const { text, summary } = cleanText(raw)
    expect(text).not.toContain("soushu")
    expect(summary.adsRemoved).toBe(2)
    expect(text.startsWith("正文第一段开始，没有缩进的续行。")).toBe(true)
  })

  test("空文本安全返回", () => {
    const { text, summary } = cleanText("")
    expect(text).toBe("")
    expect(summary).toEqual(emptyCleanSummary())
  })
})
