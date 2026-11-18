import type { PartGroup } from "@opennovel-ai/session-ui/message-part"
import type { CompactionPart } from "@opennovel-ai/sdk/v2/client"
import { Data, Equal } from "effect"

export namespace TimelineRow {
  export class TurnGap extends Data.TaggedClass("TurnGap")<{
    userMessageID: string
  }> {}
  export class CommentStrip extends Data.TaggedClass("CommentStrip")<{
    userMessageID: string
  }> {}
  export class UserMessage extends Data.TaggedClass("UserMessage")<{
    userMessageID: string
    anchor: boolean
  }> {}
  export class TurnDivider extends Data.TaggedClass("TurnDivider")<{
    userMessageID: string
    label: "compaction" | "interrupted"
    // completed 压缩的可展开摘要与实测 usage（历史加载与实时流共用同一行身份）
    compaction?: CompactionPart
  }> {}
  export class CompactionStatus extends Data.TaggedClass("CompactionStatus")<{
    userMessageID: string
    part: CompactionPart
  }> {}
  export class AssistantPart extends Data.TaggedClass("AssistantPart")<{
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
  }> {}
  export class Thinking extends Data.TaggedClass("Thinking")<{
    userMessageID: string
    reasoningHeading?: string
  }> {}
  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    text: string
  }> {}
  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: string
  }> {}

  export type TimelineRow =
    | TurnGap
    | CommentStrip
    | UserMessage
    | TurnDivider
    | CompactionStatus
    | AssistantPart
    | Thinking
    | Error
    | Retry

  export const key = (row: TimelineRow) => {
    switch (row._tag) {
      case "TurnGap":
        return `turn-gap:${row.userMessageID}`
      case "CommentStrip":
        return `comment-strip:${row.userMessageID}`
      case "UserMessage":
        return `user-message:${row.userMessageID}`
      case "TurnDivider":
        return `turn-divider:${row.userMessageID}:${row.label}`
      case "CompactionStatus":
        return `compaction-status:${row.userMessageID}`
      case "AssistantPart":
        return `assistant-part:${row.userMessageID}:${row.group.key}`
      case "Thinking":
        return `thinking:${row.userMessageID}`
      case "Error":
        return `error:${row.userMessageID}`
      case "Retry":
        return `retry:${row.userMessageID}`
    }
  }

  export function equals(a: TimelineRow, b: TimelineRow) {
    return Equal.equals(a, b)
  }
}

// reasoning 成行策略：单段或整条消息完成后成行并默认折叠；仍在流式生成时由设置控制正文可见性。
// 空正文始终不成行。
export function reasoningPartRenderable(input: {
  text?: string
  partCompleted: boolean
  messageCompleted: boolean
  showReasoning: boolean
}) {
  return (input.showReasoning || input.partCompleted || input.messageCompleted) && !!input.text?.trim()
}
