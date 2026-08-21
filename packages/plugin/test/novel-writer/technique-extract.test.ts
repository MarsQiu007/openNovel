import { describe, test, expect } from "bun:test"
import {
  segmentText,
  highlightTechniques,
  distillTechniques,
  filterTechniques,
} from "../../src/novel-writer/technique-extract.js"

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

describe("highlightTechniques", () => {
  test("calls LLM and returns highlights", async () => {
    const mockLLM = async () =>
      JSON.stringify({
        highlights: [{ reason: "对话中通过停顿制造张力", sceneType: "dialogue", level: "paragraph" }],
      })
    const segments = [{ title: "测试", text: "这是一段测试文本。", startOffset: 0, endOffset: 10 }]
    const highlights = await highlightTechniques(segments, mockLLM)
    expect(highlights.length).toBe(1)
    expect(highlights[0].sceneType).toBe("dialogue")
  })

  test("empty input returns empty", async () => {
    const highlights = await highlightTechniques([], async () => "[]")
    expect(highlights.length).toBe(0)
  })

  test("invalid JSON returns empty", async () => {
    const highlights = await highlightTechniques(
      [{ title: "t", text: "text", startOffset: 0, endOffset: 4 }],
      async () => "not json",
    )
    expect(highlights.length).toBe(0)
  })
})

describe("distillTechniques", () => {
  test("produces partial technique entries", async () => {
    const mockLLM = async () =>
      JSON.stringify({
        techniques: [
          {
            name: "对话停顿制造张力",
            principle: "在关键对话中插入动作或环境描写作为停顿",
            instruction: "写紧张对话时，每3-4句插入一个角色的微小动作",
            sceneTypes: ["dialogue"],
            level: "paragraph",
            evidence: [
              { sourceTitle: "测试", sourceLocation: "第1章", excerpt: "他停下了筷子。", annotation: "停顿暗示拒绝" },
            ],
            commonMisuse: "停顿过多导致节奏拖沓",
          },
        ],
      })
    const highlights = [
      {
        segment: { title: "测试", text: "他停下了筷子。", startOffset: 0, endOffset: 7 },
        reason: "停顿制造张力",
        sceneType: "dialogue",
        level: "paragraph",
      },
    ]
    const techniques = await distillTechniques(highlights, mockLLM)
    expect(techniques.length).toBe(1)
    expect(techniques[0].name).toBe("对话停顿制造张力")
  })

  test("empty highlights returns empty", async () => {
    const techniques = await distillTechniques([], async () => "[]")
    expect(techniques.length).toBe(0)
  })
})

describe("filterTechniques", () => {
  test("removes vague and evidence-less entries", () => {
    const entries = [
      {
        name: "具体",
        principle: "",
        instruction: "写对话时每3句插入一个动作",
        sceneTypes: ["dialogue"],
        level: "paragraph",
        evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }],
        commonMisuse: "",
      },
      {
        name: "废话",
        principle: "",
        instruction: "要注意节奏",
        sceneTypes: ["general"],
        level: "paragraph",
        evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }],
        commonMisuse: "",
      },
      {
        name: "无证据",
        principle: "",
        instruction: "具体指令内容足够长",
        sceneTypes: ["dialogue"],
        level: "paragraph",
        evidence: [],
        commonMisuse: "",
      },
    ]
    const filtered = filterTechniques(entries)
    expect(filtered.length).toBe(1)
  })

  test("merges same-name entries", () => {
    const entries = [
      {
        name: "技法A",
        principle: "",
        instruction: "写对话时插入角色微小动作",
        sceneTypes: ["dialogue"],
        level: "paragraph",
        evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }],
        commonMisuse: "",
      },
      {
        name: "技法A",
        principle: "",
        instruction: "写对话时插入角色微小动作",
        sceneTypes: ["dialogue"],
        level: "paragraph",
        evidence: [{ sourceTitle: "e", sourceLocation: "f", excerpt: "g", annotation: "h" }],
        commonMisuse: "",
      },
    ]
    const filtered = filterTechniques(entries)
    expect(filtered.length).toBe(1)
    expect(filtered[0].evidence?.length).toBe(2)
  })
})
