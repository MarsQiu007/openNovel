import { describe, test, expect } from "bun:test"
import { segmentText } from "../../src/novel-writer/technique-extract.js"

describe("segmentText", () => {
  test("splits by chapter markers", () => {
    const input = "第一章 开始\n\n内容A\n\n第二章 继续\n\n内容B"
    const segments = segmentText(input)
    expect(segments.length).toBe(2)
    expect(segments[0].title).toContain("第一章")
    expect(segments[1].title).toContain("第二章")
  })

  test("splits long text into overlapping chunks", () => {
    const input = "A".repeat(10000)
    const segments = segmentText(input, { chunkSize: 3000, overlap: 500 })
    expect(segments.length).toBeGreaterThan(1)
  })

  test("short text returns single segment", () => {
    const input = "这是一段短文本。"
    const segments = segmentText(input)
    expect(segments.length).toBe(1)
    expect(segments[0].text).toBe(input)
  })

  test("empty text returns empty array", () => {
    expect(segmentText("")).toEqual([])
  })
})
