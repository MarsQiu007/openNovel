/**
 * 书籍导入结构解析单测（book-import · 3.2 / 4.1 / 4.2）。
 */
import { describe, expect, test } from "bun:test"
import { countWords } from "@opennovel-ai/schema/schema"
import { looksLikeHeadingLine, matchHeading, parseChapterNumber, parseStructure, splitByRange } from "../src/handlers/novel-import/structure"

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

describe("splitByRange", () => {
  /** 造 n 个段落，每段约 charsPerPara 字，段间空行分隔。 */
  const makeParagraphs = (count: number, charsPerPara: number) =>
    Array.from({ length: count }, (_, i) => `第${i + 1}段${"文".repeat(charsPerPara)}`).join("\n\n")

  test("空文本返回空章列表", () => {
    const { volumes, issues } = splitByRange("   ")
    expect(volumes[0]!.chapters).toEqual([])
    expect(issues).toEqual([])
  })

  test("默认范围 2000–3000，切点落在段落边界", () => {
    // 20 段 × 约 155 字 ≈ 3100 字正文 + 空行，总长约 3200
    const text = makeParagraphs(20, 150)
    const { volumes, issues } = splitByRange(text)
    const chapters = volumes[0]!.chapters
    expect(chapters.length).toBeGreaterThanOrEqual(2)
    expect(issues).toEqual([])
    for (const chapter of chapters.slice(0, -1)) {
      expect(countWords(chapter.content)).toBeGreaterThanOrEqual(2000)
      expect(countWords(chapter.content)).toBeLessThanOrEqual(3000)
      // 段落边界切点：章尾必须是完整段落（不切断任何段落）
      expect(chapter.content.endsWith("文")).toBe(true)
    }
    expect(chapters[0]!.title).toBe("第1部分")
  })

  test("自定义范围生效", () => {
    const text = makeParagraphs(10, 150)
    const { volumes } = splitByRange(text, { min: 500, max: 800 })
    const chapters = volumes[0]!.chapters
    for (const chapter of chapters.slice(0, -1)) {
      expect(countWords(chapter.content)).toBeGreaterThanOrEqual(500)
      expect(countWords(chapter.content)).toBeLessThanOrEqual(800)
    }
  })

  test("无段落边界时取引号闭合句末，引号不被切开", () => {
    // 单段 2600 字，无空行；每约 90 字一句，对话引号成对出现
    const unit = `他往前走。${"路".repeat(40)}“你来了。”${"影".repeat(40)}。`
    const text = unit.repeat(20)
    const { volumes, issues } = splitByRange(text, { min: 1000, max: 1500 })
    const chapters = volumes[0]!.chapters
    expect(chapters.length).toBeGreaterThanOrEqual(2)
    expect(issues).toEqual([])
    for (const chapter of chapters.slice(0, -1)) {
      const tail = chapter.content.at(-1)!
      expect(["。", "”"]).toContain(tail)
      // 章内引号各自平衡
      expect(chapter.content.split("“").length).toBe(chapter.content.split("”").length)
    }
  })

  test("末章为剩余全部（可短于下限）", () => {
    const text = makeParagraphs(15, 150) // 约 2400 字
    const { volumes } = splitByRange(text, { min: 2000, max: 3000 })
    const chapters = volumes[0]!.chapters
    expect(chapters).toHaveLength(1)
    expect(chapters[0]!.content.length).toBeGreaterThan(2000)
  })

  test("窗口内无任何合法切点时受限硬切并标注问题清单", () => {
    const text = "字".repeat(5000) // 无段落、无句末标点
    const { volumes, issues } = splitByRange(text, { min: 2000, max: 3000 })
    const chapters = volumes[0]!.chapters
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0]!.type).toBe("forced-cut")
    expect(chapters[0]!.content.length).toBe(3000)
  })

  test("拆分只决定边界，不修改正文字符", () => {
    const text = makeParagraphs(20, 150)
    const { volumes } = splitByRange(text)
    const joined = volumes[0]!.chapters.map((chapter) => chapter.content).join("")
    // 各章拼接（去掉章间空行边界）与原文去空白后一致
    expect(joined.replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""))
  })

  test("字数口径与产品一致（countWords 不含标点）", () => {
    // 每段约 140 个汉字 + 约 20 个标点：字符数约 160，countWords 约 140
    const sentence = "这是一个完整的句子，里面有标点，还有停顿。"
    const para = sentence.repeat(7)
    const text = Array.from({ length: 30 }, () => para).join("\n\n")
    const { volumes } = splitByRange(text, { min: 2000, max: 3000 })
    const chapters = volumes[0]!.chapters
    expect(chapters.length).toBeGreaterThanOrEqual(2)
    for (const chapter of chapters.slice(0, -1)) {
      // 按 countWords 口径必须落在范围内（按字符数口径会超出）
      expect(countWords(chapter.content)).toBeGreaterThanOrEqual(2000)
      expect(countWords(chapter.content)).toBeLessThanOrEqual(3000)
    }
  })

  test("场景分隔线处优先成界", () => {
    const before = `上一幕${"幕".repeat(1150)}。`
    const after = `下一幕${"幕".repeat(1150)}。`
    const text = `${before}\n\n***\n\n${after}`
    const { volumes } = splitByRange(text, { min: 1000, max: 1500 })
    const chapters = volumes[0]!.chapters
    expect(chapters.length).toBe(2)
    // 切点落在场景分隔线边界：分隔线完整归属其中一章，不被切开
    const withBreak = chapters.find((chapter) => chapter.content.includes("***"))
    expect(withBreak).toBeDefined()
    expect(chapters[0]!.content.endsWith("***") || chapters[1]!.content.startsWith("***")).toBe(true)
  })
})
