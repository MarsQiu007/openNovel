import { describe, expect, test } from "bun:test"
import { parseEvidenceText } from "./technique-utils"

describe("技法库证据输入解析", () => {
  test("按行拆分证据并解析必填字段", () => {
    const result = parseEvidenceText(" 短篇范例 | 第 12 段 | 他停了两秒 | 控制节奏 \n坏例子 | 第一章 | 对话留白 | ")
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      sourceTitle: "短篇范例",
      sourceLocation: "第 12 段",
      excerpt: "他停了两秒",
      annotation: "控制节奏",
    })
    expect(result[1].annotation).toBe("")
  })

  test("跳过空行", () => {
    expect(parseEvidenceText("\n  \n来源 | 位置 | 摘录 | 注释\n")).toHaveLength(1)
  })
})