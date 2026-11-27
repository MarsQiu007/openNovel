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

describe("直引号与同形引号", () => {
  test("英文直引号对话：闭合后切分", () => {
    const text = '他说"今天来。明天走。"然后离开。'
    const spans = splitSentenceSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(['他说"今天来。明天走。"', "然后离开。"])
  })

  test("英文直引号未闭合：不切分且不平衡", () => {
    const text = '他说"今天来。明天走。'
    const spans = splitSentenceSpans(text)
    expect(spans).toEqual([{ start: 0, end: text.length }])
    expect(isQuoteBalanced(text, 0, text.length)).toBe(false)
  })

  test("全角直引号与单弯引号配对", () => {
    expect(isQuoteBalanced("他说＂你好。＂", 0, 7)).toBe(true)
    expect(isQuoteBalanced("他说‘你好。’", 0, 7)).toBe(true)
    expect(isQuoteBalanced("他说＂你好。", 0, 6)).toBe(false)
  })

  test("孤儿右引号容错钳位：不再判不平衡", () => {
    expect(isQuoteBalanced("你好。」", 0, 4)).toBe(true)
  })

  test("孤儿右引号不传染后续切分（采集重叠残段）", () => {
    const text = "他说完了。」她点头。然后离开。"
    const spans = splitSentenceSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(["他说完了。", "」", "她点头。", "然后离开。"])
    expect(isQuoteBalanced(text, 0, text.length)).toBe(true)
  })

  test("成对引号后多一个右引号仍可切分", () => {
    const text = "「你好。」他走了。」"
    const spans = splitSentenceSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(["「你好。」", "他走了。", "」"])
  })

  test("左右引号颠倒（」…「）仍判不平衡", () => {
    expect(isQuoteBalanced("」你好「", 0, 4)).toBe(false)
  })

  test("未闭合左引号超过 500 字自动闭合，句流恢复切分", () => {
    const text = "「" + "啊".repeat(600) + "。下一句。"
    const spans = splitSentenceSpans(text)
    expect(spans.length).toBe(2)
    expect(spans[0].end).toBe(602)
    expect(text.slice(spans[1].start, spans[1].end)).toBe("下一句。")
    expect(isQuoteBalanced(text, 0, text.length)).toBe(true)
  })

  test("引号开放未超过 500 字仍按未闭合处理", () => {
    const text = "「" + "啊".repeat(480) + "。" + "啊".repeat(10) + "」尾句。"
    const spans = splitSentenceSpans(text)
    expect(text.slice(spans[0].start, spans[0].end)).toBe("「" + "啊".repeat(480) + "。" + "啊".repeat(10) + "」")
    expect(text.slice(spans[1].start, spans[1].end)).toBe("尾句。")
  })

  test("直引号开放超过 500 字自动闭合", () => {
    const text = '"' + "啊".repeat(600) + "。收尾。"
    const spans = splitSentenceSpans(text)
    expect(spans.length).toBe(2)
    expect(isQuoteBalanced(text, 0, text.length)).toBe(true)
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
