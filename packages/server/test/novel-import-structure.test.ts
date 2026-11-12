/**
 * 书籍导入结构解析单测（book-import · 3.2 / 4.1 / 4.2）。
 */
import { describe, expect, test } from "bun:test"
import { looksLikeHeadingLine, matchHeading, parseChapterNumber, parseStructure, splitFixedLength } from "../src/handlers/novel-import/structure"

describe("parseChapterNumber", () => {
  test("阿拉伯与全角数字", () => {
    expect(parseChapterNumber("3")).toBe(3)
    expect(parseChapterNumber("12")).toBe(12)
    expect(parseChapterNumber("７")).toBe(7)
  })

  test("中文数字基本位", () => {
    expect(parseChapterNumber("一")).toBe(1)
    expect(parseChapterNumber("十")).toBe(10)
    expect(parseChapterNumber("十五")).toBe(15)
    expect(parseChapterNumber("二十")).toBe(20)
  })

  test("中文数字复合", () => {
    expect(parseChapterNumber("一百二十三")).toBe(123)
    expect(parseChapterNumber("一千零五")).toBe(1005)
    expect(parseChapterNumber("三万四千")).toBe(34000)
  })

  test("无法解析返回 null", () => {
    expect(parseChapterNumber("abc")).toBeNull()
    expect(parseChapterNumber("")).toBeNull()
  })
})

describe("matchHeading / looksLikeHeadingLine", () => {
  test("章题模式族", () => {
    expect(matchHeading("第三章")?.kind).toBe("chapter")
    expect(matchHeading("第三章：新的开始")?.kind).toBe("chapter")
    expect(matchHeading("第3章 新的开始")?.kind).toBe("chapter")
    expect(matchHeading("第五回 起")?.kind).toBe("chapter")
    expect(matchHeading("第5节")?.kind).toBe("chapter")
    expect(matchHeading("Chapter 12 开局")?.kind).toBe("chapter")
  })

  test("卷题模式族", () => {
    expect(matchHeading("第三卷")?.kind).toBe("volume")
    expect(matchHeading("第2部 风起")?.kind).toBe("volume")
    expect(matchHeading("卷五")?.kind).toBe("volume")
    expect(matchHeading("Volume 1")?.kind).toBe("volume")
  })

  test("特殊章", () => {
    expect(matchHeading("序章")).toEqual({ kind: "chapter", number: null, title: "序章", special: "prologue" })
    expect(matchHeading("楔子")).toEqual({ kind: "chapter", number: null, title: "楔子", special: "prologue" })
    expect(matchHeading("尾声")).toEqual({ kind: "chapter", number: null, title: "尾声", special: "epilogue" })
    expect(matchHeading("番外篇：江湖轶事")).toEqual({
      kind: "chapter",
      number: null,
      title: "番外篇：江湖轶事",
      special: "extra",
    })
  })

  test("章题解析出数字", () => {
    const match = matchHeading("第十二章 风起")
    expect(match).toMatchObject({ kind: "chapter", number: 12 })
  })

  test("行独占性防线：含句读标点的行不是标题", () => {
    expect(looksLikeHeadingLine("他说第三章的内容很有意思。")).toBe(false)
    expect(looksLikeHeadingLine("第三章，他开始行动")).toBe(false)
  })

  test("行独占性防线：超长行不是标题", () => {
    expect(looksLikeHeadingLine(`第三章${"很长".repeat(20)}`)).toBe(false)
  })

  test("正文行不是标题", () => {
    expect(looksLikeHeadingLine("清晨的风从东方吹来。")).toBe(false)
    expect(looksLikeHeadingLine("")).toBe(false)
  })
})

describe("parseStructure", () => {
  test("常规无章题文件：默认单卷按章拆分", () => {
    const text = ["第一章 风起", "正文一的内容。", "", "第二章 云涌", "正文二的内容。", "第三章", "正文三的内容。"].join("\n")
    const result = parseStructure(text)
    expect(result.chapterHeadingCount).toBe(3)
    expect(result.volumes).toHaveLength(1)
    expect(result.volumes[0]!.title).toBeNull()
    expect(result.volumes[0]!.chapters.map((chapter) => chapter.title)).toEqual(["第一章 风起", "第二章 云涌", "第三章"])
    expect(result.volumes[0]!.chapters[0]!.content).toBe("正文一的内容。")
    expect(result.volumes[0]!.chapters[1]!.content).toBe("正文二的内容。")
    expect(result.issues).toEqual([])
  })

  test("多卷拆分：章归属正确卷", () => {
    const text = [
      "第一卷 风起天南",
      "第一章 开局",
      "卷一正文。",
      "第二章 发展",
      "卷一的第二章正文。",
      "第二卷 纵横天下",
      "第三章 转折",
      "卷二正文。",
    ].join("\n")
    const result = parseStructure(text)
    expect(result.volumes).toHaveLength(2)
    expect(result.volumes[0]!.title).toBe("第一卷 风起天南")
    expect(result.volumes[0]!.chapters.map((chapter) => chapter.title)).toEqual(["第一章 开局", "第二章 发展"])
    expect(result.volumes[1]!.title).toBe("第二卷 纵横天下")
    expect(result.volumes[1]!.chapters[0]!.content).toBe("卷二正文。")
  })

  test("特殊章就近归卷且保留标识", () => {
    const text = ["序章", "序章正文。", "第一章 正章", "正文。", "番外篇：轶事", "番外正文。", "尾声", "尾声正文。"].join("\n")
    const result = parseStructure(text)
    const chapters = result.volumes[0]!.chapters
    expect(chapters.map((chapter) => chapter.special)).toEqual(["prologue", null, "extra", "epilogue"])
    expect(chapters[1]!.content).toBe("正文。")
  })

  test("编号断裂跳号标注", () => {
    const text = ["第一章 甲", "一。", "第三章 乙", "二。"].join("\n")
    const issues = parseStructure(text).issues
    expect(issues).toEqual([{ type: "sequence-gap", message: "第 1 章后跳至第 3 章", chapterNumber: 3 }])
  })

  test("编号重复与乱序标注", () => {
    const duplicated = parseStructure(["第二章 甲", "一。", "第二章 乙", "二。"].join("\n")).issues
    expect(duplicated[0]).toMatchObject({ type: "duplicate-number", chapterNumber: 2 })
    const mismatched = parseStructure(["第三章 甲", "一。", "第一章 乙", "二。"].join("\n")).issues
    expect(mismatched[0]).toMatchObject({ type: "order-mismatch", chapterNumber: 1 })
  })

  test("卷前言并入第一章不丢失", () => {
    const text = ["书稿简介行。", "", "第一章 开局", "正文。"].join("\n")
    const first = parseStructure(text).volumes[0]!.chapters[0]!
    expect(first.content).toBe("书稿简介行。\n\n正文。")
  })

  test("无章节边界如实报告", () => {
    const text = "这是一个完全没有章节标题的散文段落。它讲述了一些事情，然后结束了。"
    const result = parseStructure(text)
    expect(result.chapterHeadingCount).toBe(0)
    expect(result.volumes).toEqual([])
    expect(result.issues).toEqual([{ type: "unrecognized-boundary", message: "未识别到章节边界" }])
  })

  test("英文 Chapter 标题拆分", () => {
    const text = ["Chapter 1 Start", "body one.", "Chapter 2", "body two."].join("\n")
    const result = parseStructure(text)
    expect(result.volumes[0]!.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1 Start", "Chapter 2"])
  })
})

describe("splitFixedLength", () => {
  test("按固定字数等长分章", () => {
    const text = "字".repeat(7000)
    const volumes = splitFixedLength(text, 3000)
    expect(volumes).toHaveLength(1)
    expect(volumes[0]!.chapters).toHaveLength(3)
    expect(volumes[0]!.chapters[0]!.title).toBe("第1部分")
    expect(volumes[0]!.chapters[0]!.content).toHaveLength(3000)
    expect(volumes[0]!.chapters[2]!.content).toHaveLength(1000)
  })

  test("空文本返回空章列表", () => {
    const volumes = splitFixedLength("   ")
    expect(volumes[0]!.chapters).toEqual([])
  })
})
