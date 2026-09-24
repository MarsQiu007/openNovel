/**
 * 设定批注执行逻辑测试
 */
import { describe, test, expect } from "bun:test"
import { hasOverlap, segmentParagraph } from "./annotation-utils"
import { executeSettingAnnotationExecution, formatSettingExecutionPrompt } from "./setting-annotation-execution"
import type { AnnotationExecutionInput } from "./annotation-execution"

const annotations: AnnotationExecutionInput[] = [
  {
    id: "ann-1",
    status: "applied",
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 5,
    quote: "城墙很高",
    comment: "强调压迫感",
    suggestedReplacement: "青灰城墙压向街巷",
  },
]

describe("setting annotation prompt", () => {
  test("prompt 包含设定目标、纯文本约束和回填工具", () => {
    const prompt = formatSettingExecutionPrompt({
      roundID: "wear-round",
      entryID: "we-1",
      entryTitle: "旧城",
      paragraphs: ["城墙很高"],
      annotations,
    })
    expect(prompt).toContain("wear-round")
    expect(prompt).toContain("world_entry_id: we-1")
    expect(prompt).toContain("read_setting")
    expect(prompt).toContain("update_setting")
    expect(prompt).toContain("report_setting_annotation_execution")
    expect(prompt).toContain("- paragraph_index: 0")
    expect(prompt).toContain("禁止 Markdown")
    expect(prompt).toContain("青灰城墙压向街巷")
  })
})

describe("setting annotation orchestration", () => {
  test("创建轮次、写入 prompt、发送并关联批注", async () => {
    const calls: string[] = []
    const sessionID = await executeSettingAnnotationExecution(
      { entryID: "we-1", entryTitle: "旧城", paragraphs: ["城墙很高"], annotations },
      {
        createRound: async ({ promptSnapshot, annotationsSnapshot }) => {
          calls.push("create")
          expect(promptSnapshot).toBe("")
          expect(annotationsSnapshot[0].id).toBe("ann-1")
          return { id: "wear-round" }
        },
        updateRoundPrompt: async ({ roundID }) => {
          calls.push(`prompt:${roundID}`)
        },
        sendPrompt: async ({ roundID }) => {
          calls.push(`send:${roundID}`)
          return "ses-1"
        },
        associateAnnotations: async ({ roundID, annotations: linked }) => {
          calls.push(`associate:${roundID}`)
          expect(linked[0].id).toBe("ann-1")
        },
        failRound: async () => {
          calls.push("fail")
          throw new Error("不应失败")
        },
      },
    )
    expect(sessionID).toBe("ses-1")
    expect(calls).toEqual(["create", "prompt:wear-round", "send:wear-round", "associate:wear-round"])
  })

  test("发送失败时把轮次标记为失败", async () => {
    const calls: string[] = []
    await expect(executeSettingAnnotationExecution(
      { entryID: "we-1", paragraphs: ["城墙很高"], annotations },
      {
        createRound: async () => ({ id: "wear-round" }),
        updateRoundPrompt: async () => undefined,
        sendPrompt: async () => {
          throw new Error("session unavailable")
        },
        associateAnnotations: async () => {
          throw new Error("不应关联")
        },
        failRound: async ({ roundID, resultSummary }) => {
          calls.push(roundID, resultSummary)
        },
      },
    )).rejects.toThrow("session unavailable")
    expect(calls[0]).toBe("wear-round")
    expect(calls[1]).toContain("session unavailable")
  })
})

describe("setting annotation rendering anchors", () => {
  test("segmentParagraph 按偏移渲染高亮片段", () => {
    const segments = segmentParagraph("城墙很高", [{ id: "ann-1", status: "open", paragraphIndex: 0, startOffset: 0, endOffset: 2, quote: "城墙", comment: "强化" }])
    expect(segments[0].annotation?.id).toBe("ann-1")
    expect(segments[0].text).toBe("城墙")
    expect(segments[1]).toEqual({ text: "很高", annotation: null })
  })

  test("同段重叠锚点可被拦截", () => {
    expect(hasOverlap({ startParagraph: 0, start: 0, endParagraph: 0, end: 4 }, { startParagraph: 0, start: 3, endParagraph: 0, end: 6 })).toBe(true)
    expect(hasOverlap({ startParagraph: 0, start: 0, endParagraph: 0, end: 2 }, { startParagraph: 0, start: 2, endParagraph: 0, end: 5 })).toBe(false)
  })
})