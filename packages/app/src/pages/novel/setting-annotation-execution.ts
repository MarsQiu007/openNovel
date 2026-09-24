/**
 * 设定批注执行纯逻辑：生成设定专属 prompt 并编排执行轮次。
 *
 * 不复用章节执行 prompt，因为目标实体、写入工具和回填工具语义不同。
 */
import { buildAnnotationsSnapshot, formatPromptQuote, type AnnotationExecutionInput, type AnnotationExecutionSnapshot } from "./annotation-execution"

export function formatSettingExecutionPrompt(input: {
  readonly roundID: string
  readonly entryID: string
  readonly entryTitle?: string | null | undefined
  readonly paragraphs: readonly string[]
  readonly annotations: readonly AnnotationExecutionInput[]
}): string {
  const sections = [
    "请根据以下设定批注修改目标 world_entry 的 content。",
    "\n## 目标设定\n"
      + `- execution_round_id: ${input.roundID}\n`
      + `- world_entry_id: ${input.entryID}\n`
      + `- title: ${JSON.stringify(input.entryTitle ?? "")}`,
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
            `- paragraph_index: ${ann.paragraphIndex == null ? "whole_entry" : ann.paragraphIndex}`,
          ]
          // 仅跨段批注输出结束段落索引，单段 prompt 与现状一致
          const isCrossParagraph =
            ann.paragraphIndex != null && ann.endParagraphIndex != null && ann.endParagraphIndex !== ann.paragraphIndex
          if (isCrossParagraph) lines.push(`- end_paragraph_index: ${ann.endParagraphIndex}`)
          if (ann.startOffset != null) lines.push(`- start_offset: ${ann.startOffset}`)
          if (ann.endOffset != null) lines.push(`- end_offset: ${ann.endOffset}`)
          lines.push(
            `- action: ${action}`,
            `- paragraph_text: ${paragraph == null ? "not_found" : JSON.stringify(paragraph)}`,
            `- selected_quote: ${formatPromptQuote(ann.quote)}`,
            `- comment: ${JSON.stringify(ann.comment)}`,
          )
          if (ann.suggestedReplacement) lines.push(`- suggested_replacement: ${JSON.stringify(ann.suggestedReplacement)}`)
          return lines.join("\n")
        })
        .join("\n\n"),
    "\n## 执行规则\n"
      + "1. 先调用 read_setting 读取目标 world_entry 全文，再按批注定位。\n"
      + "2. 只修改 world_entry_id 指向的 content；不要修改 category 或 title。\n"
      + "3. 无法唯一匹配 selected_quote 或段落锚点时，不要猜测修改，改为在结果中说明未定位。\n"
      + "4. 修改后使用 update_setting 写入完整 content，保持纯文本并用空行分段。\n"
      + "5. 禁止 Markdown 符号、删除无关事实、虚构设定或覆盖未涉及段落。\n"
      + "6. 只有全部批注都完成修改后才回填 completed；任何未定位、未修改或失败项都必须回填 failed。\n"
      + "7. 成功或失败都必须调用 report_setting_annotation_execution 回填 execution_round_id、状态和结果摘要。",
  ]
  return sections.join("\n")
}

export async function executeSettingAnnotationExecution(
  input: {
    readonly entryID: string
    readonly entryTitle?: string | null | undefined
    readonly paragraphs: readonly string[]
    readonly annotations: readonly AnnotationExecutionInput[]
  },
  deps: {
    readonly createRound: (args: { promptSnapshot: string; annotationsSnapshot: AnnotationExecutionSnapshot[] }) => Promise<{ id: string }>
    readonly updateRoundPrompt: (args: { roundID: string; promptSnapshot: string }) => Promise<void>
    readonly sendPrompt: (args: { roundID: string; prompt: string }) => Promise<string | null | undefined>
    readonly associateAnnotations: (args: { roundID: string; annotations: readonly AnnotationExecutionInput[] }) => Promise<void>
    readonly failRound: (args: { roundID: string; resultSummary: string }) => Promise<void>
  },
): Promise<string | null | undefined> {
  const round = await deps.createRound({
    promptSnapshot: "",
    annotationsSnapshot: buildAnnotationsSnapshot(input.annotations),
  })
  try {
    const prompt = formatSettingExecutionPrompt({ ...input, roundID: round.id })
    await deps.updateRoundPrompt({ roundID: round.id, promptSnapshot: prompt })
    const sessionID = await deps.sendPrompt({ roundID: round.id, prompt })
    await deps.associateAnnotations({ roundID: round.id, annotations: input.annotations })
    return sessionID
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.failRound({ roundID: round.id, resultSummary: `执行失败：${message}` })
    throw error
  }
}