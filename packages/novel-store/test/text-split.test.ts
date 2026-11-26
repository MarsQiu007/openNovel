/**
 * 句流切分原语测试（narrative-unit-split 任务 2.3）
 *
 * 覆盖：句流跨度切分、引号内句末不切、无句末标点尾部并入、
 * 全文无切点单跨度、区间引号闭合判定。
 */
import { describe, test, expect } from "bun:test"
import { isQuoteBalanced, splitSentenceSpans } from "../src/text-split.js"

describe("splitSentenceSpans", () => {
  test("按句末标点切分且跨度覆盖全文", () => {
    const text = "他走了。她笑了！真的吗？"
    const spans = splitSentenceSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(["他走了。", "她笑了！", "真的吗？"])
    expect(spans.at(-1)?.end).toBe(text.length)
  })

  test("引号内句末不切，右引号闭合后切分", () => {
    const text = "他说：“今天来。明天走。”然后离开了。"
    const spans = splitSentenceSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(["他说：“今天来。明天走。”", "然后离开了。"])
  })

  test("无句末标点的尾部并入最后一句", () => {
    const text = "第一句。没有标点的尾巴"
    const spans = splitSentenceSpans(text)
    expect(spans).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: text.length },
    ])
  })

  test("全文无切点时输出单跨度", () => {
    const text = "没有句末标点的一段话"
    const spans = splitSentenceSpans(text)
    expect(spans).toEqual([{ start: 0, end: text.length }])
  })
})

describe("isQuoteBalanced", () => {
  test("引号闭合区间为真", () => {
    expect(isQuoteBalanced("他说：“你好。”", 0, 8)).toBe(true)
  })

  test("引号未闭合区间为假", () => {
    expect(isQuoteBalanced("他说：“你好。", 0, 7)).toBe(false)
  })
})
