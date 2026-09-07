/**
 * 批注批量执行的纯逻辑：快照构造、AI 指令生成和执行轮次编排。
 */

export type AnnotationExecutionInput = {
  readonly id: string
  readonly status: "open" | "resolved" | "wontfix" | "applied"
  readonly paragraphIndex?: number | null | undefined
  readonly startOffset?: number | null | undefined
  readonly endOffset?: number | null | undefined
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null | undefined
}

export type AnnotationExecutionSnapshot = {
  readonly id: string
  readonly paragraphIndex?: number | null | undefined
  readonly startOffset?: number | null | undefined
  readonly endOffset?: number | null | undefined
  readonly quote: string
  readonly status: "open" | "resolved" | "wontfix" | "applied"
  readonly comment: string
  readonly suggestedReplacement?: string | null | undefined
}

export function buildAnnotationsSnapshot(
  annotations: readonly AnnotationExecutionInput[],
): AnnotationExecutionSnapshot[] {
  return annotations.map((ann) => ({
    id: ann.id,
    paragraphIndex: ann.paragraphIndex ?? null,
    startOffset: ann.startOffset ?? null,
    endOffset: ann.endOffset ?? null,
    quote: ann.quote,
    status: ann.status,
    comment: ann.comment,
    suggestedReplacement: ann.suggestedReplacement ?? null,
  }))
}

export function formatExecutionPrompt(input: {
  readonly chapterID: string
  readonly chapterTitle?: string | null | undefined
  readonly paragraphs: readonly string[]
  readonly annotations: readonly AnnotationExecutionInput[]
}): string {
  const sections = [
    "请根据以下批注修改章节正文。",
    "\n## 目标章节\n"
      + `- chapter_id: ${input.chapterID}\n`
      + `- chapter_title: ${JSON.stringify(input.chapterTitle ?? "")}`,
    "\n## 批注列表\n"
      + input.annotations
        .map((ann, index) => {
          const paragraph = ann.paragraphIndex != null ? input.paragraphs[ann.paragraphIndex] : undefined
          const action =
            ann.status === "applied" && ann.suggestedReplacement
              ? "replace"
              : ann.status === "resolved"
                ? "rewrite"
                : "skip"
          const lines = [
            `### ${index + 1}`,
            `- annotation_id: ${ann.id}`,
            `- paragraph_index: ${ann.paragraphIndex == null ? "whole_chapter" : ann.paragraphIndex + 1}`,
          ]
          if (ann.startOffset != null) lines.push(`- start_offset: ${ann.startOffset}`)
          if (ann.endOffset != null) lines.push(`- end_offset: ${ann.endOffset}`)
          lines.push(
            `- action: ${action}`,
            `- paragraph_text: ${paragraph == null ? "not_found" : JSON.stringify(paragraph)}`,
            `- selected_quote: ${JSON.stringify(ann.quote)}`,
            `- comment: ${JSON.stringify(ann.comment)}`,
          )
          if (ann.suggestedReplacement) lines.push(`- suggested_replacement: ${JSON.stringify(ann.suggestedReplacement)}`)
          return lines.join("\n")
        })
        .join("\n\n"),
    "\n## 定位与修改规则\n"
      + "1. 优先在 paragraph_index 指向的段落中精确匹配 selected_quote。\n"
      + "2. 如果正文已更新导致该段落匹配失败，再在章节全文中查找 selected_quote。\n"
      + "3. 如果 selected_quote 无法唯一匹配，不要凭偏移量猜测；保留该段并在回复中说明未定位。\n"
      + "4. action 为 replace 时使用 suggested_replacement；rewrite 时按 comment 改写；skip 时不要修改正文。\n"
      + "5. 修改完成后检查前后文衔接。",
  ]
  return sections.join("\n")
}

export function groupHistoryRounds(
  rounds: readonly {
    readonly id: string
    readonly promptSnapshot: string
    readonly status: string
    readonly annotationsSnapshot: readonly AnnotationExecutionSnapshot[]
    readonly resultSummary: string
    readonly createdAt: number
  }[],
) {
  return rounds
    .map((round) => ({ ...round, annotations: round.annotationsSnapshot }))
    .filter((round) => round.annotations.length > 0)
}

export async function executeAnnotationExecution(
  input: {
    readonly chapterID: string
    readonly chapterTitle?: string | null | undefined
    readonly paragraphs: readonly string[]
    readonly annotations: readonly AnnotationExecutionInput[]
  },
  deps: {
    readonly createRound: (args: { promptSnapshot: string; annotationsSnapshot: AnnotationExecutionSnapshot[] }) => Promise<{ id: string }>
    readonly sendPrompt: (args: { roundID: string; prompt: string }) => Promise<string | null | undefined>
    readonly associateAnnotations: (args: { roundID: string; annotations: readonly AnnotationExecutionInput[] }) => Promise<void>
    readonly completeRound: (args: { roundID: string; resultSummary: string }) => Promise<void>
    readonly failRound: (args: { roundID: string; resultSummary: string }) => Promise<void>
  },
): Promise<string | null | undefined> {
  const prompt = formatExecutionPrompt(input)
  const round = await deps.createRound({
    promptSnapshot: prompt,
    annotationsSnapshot: buildAnnotationsSnapshot(input.annotations),
  })
  try {
    const sessionID = await deps.sendPrompt({ roundID: round.id, prompt })
    await deps.associateAnnotations({ roundID: round.id, annotations: input.annotations })
    await deps.completeRound({ roundID: round.id, resultSummary: "执行指令已发送，等待 AI 改稿结果。" })
    return sessionID
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.failRound({ roundID: round.id, resultSummary: `执行失败：${message}` })
    throw error
  }
}
