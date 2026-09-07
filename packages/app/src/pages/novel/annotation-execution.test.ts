import { describe, expect, test } from "bun:test"
import { buildAnnotationsSnapshot, executeAnnotationExecution, formatExecutionPrompt, groupHistoryRounds } from "./annotation-execution"

const annotations = [
  {
    id: "ann-1",
    status: "applied" as const,
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 2,
    quote: "旧句",
    comment: "这句话太生硬",
    suggestedReplacement: "新句",
  },
  {
    id: "ann-2",
    status: "resolved" as const,
    paragraphIndex: 1,
    startOffset: null,
    endOffset: null,
    quote: "另一段",
    comment: "补充心理描写",
    suggestedReplacement: null,
  },
]

describe("buildAnnotationsSnapshot", () => {
  test("构造包含锚点和意图的不可变快照", () => {
    const snapshot = buildAnnotationsSnapshot(annotations)
    expect(snapshot).toEqual([
      {
        id: "ann-1",
        paragraphIndex: 0,
        startOffset: 0,
        endOffset: 2,
        quote: "旧句",
        status: "applied",
        comment: "这句话太生硬",
        suggestedReplacement: "新句",
      },
      {
        id: "ann-2",
        paragraphIndex: 1,
        startOffset: null,
        endOffset: null,
        quote: "另一段",
        status: "resolved",
        comment: "补充心理描写",
        suggestedReplacement: null,
      },
    ])
  })
})

describe("formatExecutionPrompt", () => {
  test("prompt 包含章节、段落、完整原文和 annotation_id", () => {
    const prompt = formatExecutionPrompt({
      roundID: "round-1",
      chapterID: "ch-1",
      chapterTitle: "第一章",
      paragraphs: ["旧句在开头", "另一段"],
      annotations,
    })

    expect(prompt).toContain("execution_round_id: round-1")
    expect(prompt).toContain("chapter_id: ch-1")
    expect(prompt).toContain("annotation_id: ann-1")
    expect(prompt).toContain("- paragraph_text: \"旧句在开头\"")
    expect(prompt).toContain("- selected_quote: \"旧句\"")
    expect(prompt).toContain("- suggested_replacement: \"新句\"")
    expect(prompt).toContain("annotation_id: ann-2")
    expect(prompt).toContain("- paragraph_text: \"另一段\"")
  })
})

describe("executeAnnotationExecution", () => {
  test("按创建轮次 → 保存指令 → 发送 → 关联顺序执行，并保持待回填", async () => {
    const calls: string[] = []
    const sessionID = await executeAnnotationExecution(
      { chapterID: "ch-1", paragraphs: ["正文"], annotations },
      {
        createRound: async ({ annotationsSnapshot }) => {
          calls.push(`create:${annotationsSnapshot.length}`)
          return { id: "round-1" }
        },
        updateRoundPrompt: async ({ roundID, promptSnapshot }) => {
          calls.push(`prompt:${roundID}:${promptSnapshot.includes("execution_round_id: round-1")}`)
        },
        sendPrompt: async ({ roundID, prompt }) => {
          calls.push(`send:${roundID}:${prompt.includes("annotation_id: ann-1")}`)
          return "session-1"
        },
        associateAnnotations: async ({ roundID, annotations }) => {
          calls.push(`associate:${roundID}:${annotations.length}`)
        },
        failRound: async ({ roundID }) => {
          calls.push(`fail:${roundID}`)
        },
      },
    )

    expect(sessionID).toBe("session-1")
    expect(calls).toEqual([
      "create:2",
      "prompt:round-1:true",
      "send:round-1:true",
      "associate:round-1:2",
    ])
  })

  test("发送失败时记录失败轮次并向上抛出", async () => {
    const calls: string[] = []
    await executeAnnotationExecution(
      { chapterID: "ch-1", paragraphs: [], annotations: [] },
      {
        createRound: async () => {
          calls.push("create")
          return { id: "round-1" }
        },
        updateRoundPrompt: async () => {
          calls.push("prompt")
        },
        sendPrompt: async () => {
          calls.push("send")
          throw new Error("session unavailable")
        },
        associateAnnotations: async () => {
          calls.push("associate")
        },
        failRound: async ({ roundID, resultSummary }) => {
          calls.push(`fail:${roundID}:${resultSummary}`)
        },
      },
    ).catch((error) => expect(error.message).toBe("session unavailable"))

    expect(calls).toEqual(["create", "prompt", "send", "fail:round-1:执行失败：session unavailable"])
  })
})

describe("groupHistoryRounds", () => {
  test("保留章节版本和等待回填状态供历史面板展示", () => {
    const groups = groupHistoryRounds([
      {
        id: "round-running",
        promptSnapshot: "prompt",
        status: "running",
        annotationsSnapshot: [
          { id: "ann-1", paragraphIndex: 0, startOffset: 0, endOffset: 2, quote: "旧句", status: "applied", comment: "改写", suggestedReplacement: "新句" },
        ],
        resultSummary: "",
        chapterVersionId: null,
        createdAt: 1,
      },
    ])

    expect(groups[0]?.status).toBe("running")
    expect(groups[0]?.resultSummary).toBe("")
    expect(groups[0]?.chapterVersionId).toBeNull()
  })

  test("按轮次渲染快照，不依赖当前批注表反查", () => {
    const groups = groupHistoryRounds([
      {
        id: "round-2",
        promptSnapshot: "prompt-2",
        status: "completed",
        annotationsSnapshot: [],
        resultSummary: "empty",
        chapterVersionId: "cv-2",
        createdAt: 20,
      },
      {
        id: "round-1",
        promptSnapshot: "prompt-1",
        status: "completed",
        annotationsSnapshot: [{ id: "ann-1", paragraphIndex: 0, startOffset: 0, endOffset: 2, quote: "旧句", status: "applied", comment: "改写", suggestedReplacement: "新句" }],
        resultSummary: "sent",
        createdAt: 10,
      },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe("round-1")
    expect(groups[0].annotations[0]?.id).toBe("ann-1")
    expect(groups[0].annotations[0]?.status).toBe("applied")
  })
})
