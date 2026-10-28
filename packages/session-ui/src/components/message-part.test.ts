import { describe, expect, test } from "bun:test"
import {
  readPartText,
  renderablePart,
  reasoningHeadingText,
  reasoningTriggerText,
  resolveCollapsibleOpen,
} from "./message-part-text"

describe("readPartText", () => {
  const part = (input: { id: string; text?: string; messageID?: string }) => ({
    messageID: "msg_1",
    ...input,
  })

  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, part({ id: "part_1" }))).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, part({ id: "part_1", text: "  hello  " }))).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ "msg_1:part_1": "  from accum  " }, part({ id: "part_1", text: "from part" }))).toBe(
      "from accum",
    )
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, part({ id: "part_1", text: "  from part  " }))).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, part({ id: "part_1", text: "   \n\t  " }))).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, part({ id: "part_1", text: "\n  body  \n" }))).toBe("body")
  })

  test("同 id 不同 messageID 互不命中", () => {
    const accum = { "msg_1:text-0": "消息一的文本" }
    expect(readPartText(accum, part({ messageID: "msg_2", id: "text-0", text: "消息二的文本" }))).toBe("消息二的文本")
    expect(readPartText({ "msg_2:text-0": "消息二的文本" }, part({ id: "text-0" }))).toBe("")
    expect(readPartText(accum, part({ id: "text-0" }))).toBe("消息一的文本")
  })
})

describe("reasoningHeadingText", () => {
  test("html 标题优先", () => {
    expect(reasoningHeadingText('<h3>规划章节</h3>\n正文')).toBe("规划章节")
  })

  test("atx 标题", () => {
    expect(reasoningHeadingText("## 故事大纲\n正文")).toBe("故事大纲")
  })

  test("atx 带尾部闭合井号", () => {
    expect(reasoningHeadingText("### 角色动机 ##\n正文")).toBe("角色动机")
  })

  test("setext 标题", () => {
    expect(reasoningHeadingText("主线冲突\n====\n正文")).toBe("主线冲突")
  })

  test("strong 行", () => {
    expect(reasoningHeadingText("**关键设定**\n正文")).toBe("关键设定")
  })

  test("无标题形状返回 undefined", () => {
    expect(reasoningHeadingText("普通正文没有标题")).toBeUndefined()
  })

  test("清理行内 markdown 标记", () => {
    expect(reasoningHeadingText('## 使用 `spawn` 与 [链接](https://x.y) 的*计划*')).toBe("使用 spawn 与 链接 的计划")
  })

  test("空文本返回 undefined", () => {
    expect(reasoningHeadingText("")).toBeUndefined()
  })

  test("容忍 CRLF", () => {
    expect(reasoningHeadingText("标题行\r\n====\r\n正文")).toBe("标题行")
  })
})

describe("reasoningTriggerText", () => {
  test("有标题时与 reasoningHeadingText 一致", () => {
    expect(reasoningTriggerText("## 大纲\n正文")).toBe("大纲")
  })

  test("无标题时回退剥离标记的截断首行", () => {
    expect(reasoningTriggerText("先梳理**主线**再动笔\n第二行")).toBe("先梳理主线再动笔")
  })

  test("首行超长截断到 80 字符", () => {
    const long = "字".repeat(120)
    expect(reasoningTriggerText(long)).toBe("字".repeat(80) + "…")
  })

  test("空文本返回 undefined", () => {
    expect(reasoningTriggerText("")).toBeUndefined()
  })
})

describe("renderablePart", () => {
  const part = (input: { type: string; text?: string; tool?: string; state?: { status: string } }) => ({
    id: "part_1",
    ...input,
  })
  const hasComponent = (type: string) => type === "compaction"

  test("reasoning 有正文即渲染", () => {
    expect(renderablePart(part({ type: "reasoning", text: "思考中" }), hasComponent)).toBe(true)
  })

  test("reasoning 空白正文不渲染", () => {
    expect(renderablePart(part({ type: "reasoning", text: "  \n  " }), hasComponent)).toBe(false)
    expect(renderablePart(part({ type: "reasoning" }), hasComponent)).toBe(false)
  })

  test("tool/text 行为不变", () => {
    expect(renderablePart(part({ type: "tool", tool: "bash", state: { status: "completed" } }), hasComponent)).toBe(
      true,
    )
    expect(renderablePart(part({ type: "tool", tool: "todowrite", state: { status: "completed" } }), hasComponent)).toBe(
      false,
    )
    expect(renderablePart(part({ type: "text", text: "hi" }), hasComponent)).toBe(true)
    expect(renderablePart(part({ type: "text", text: "  " }), hasComponent)).toBe(false)
    expect(renderablePart(part({ type: "compaction" }), hasComponent)).toBe(true)
  })
})

describe("resolveCollapsibleOpen", () => {
  test("全未传默认收起", () => {
    expect(resolveCollapsibleOpen({})).toBe(false)
    expect(resolveCollapsibleOpen({ local: false })).toBe(false)
  })

  test("defaultOpen 单独传时生效", () => {
    expect(resolveCollapsibleOpen({ defaultOpen: true, local: false })).toBe(true)
  })

  test("toolOpen 受控翻转优先于 defaultOpen", () => {
    expect(resolveCollapsibleOpen({ toolOpen: false, defaultOpen: true, local: true })).toBe(false)
    expect(resolveCollapsibleOpen({ toolOpen: true, defaultOpen: false, local: false })).toBe(true)
  })
})
