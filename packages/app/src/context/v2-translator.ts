import type {
  AssistantMessage,
  EventMessagePartDelta,
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventPermissionAsked,
  EventPermissionReplied,
  EventQuestionAsked,
  EventQuestionReplied,
  EventQuestionRejected,
  GlobalEvent,
  Part,
} from "@opennovel-ai/sdk/v2/client"
import {
  adaptPermission,
  adaptQuestion,
  adaptUser,
  compactionPart,
  serializeToolContent,
  structuredTitle,
  zeroTokens,
} from "../utils/v2-adapter"

// V2 durable 事件 → V1 伪事件的有状态翻译器。
// 仅 server-session 使用（child stores 不消费消息内容）；native case（session.next.updated
// 等）由调用方处理，不进翻译器。状态跨事件维护 assistant 骨架 / 最近 user / 调用表，
// 使得 step.ended 等结算事件能发出完整的 V1 message.updated。

export type TranslatedEvent =
  | Omit<EventMessageUpdated, "id">
  | Omit<EventMessagePartUpdated, "id">
  | Omit<EventMessagePartDelta, "id">
  | Omit<EventPermissionAsked, "id">
  | Omit<EventPermissionReplied, "id">
  | Omit<EventQuestionAsked, "id">
  | Omit<EventQuestionReplied, "id">
  | Omit<EventQuestionRejected, "id">

export type TranslatorContext = {
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  directory: string
  lastUserID?: string
}

const fallbackContext = (): TranslatorContext => ({
  agent: "",
  model: { providerID: "", modelID: "" },
  directory: "",
})

type CallRecord = {
  sessionID: string
  messageID: string
  tool: string
  input: Record<string, unknown>
  start: number
}

export function createV2Translator(input: { context: (sessionID: string) => TranslatorContext | undefined }) {
  const assistants = new Map<string, AssistantMessage>()
  const lastUser = new Map<string, string>()
  const calls = new Map<string, CallRecord>()
  const reasoningStarts = new Map<string, number>()

  const context = (sessionID: string) => input.context(sessionID) ?? fallbackContext()

  const messageUpdated = (sessionID: string, info: AssistantMessage | ReturnType<typeof adaptUser>["info"]) =>
    ({ type: "message.updated", properties: { sessionID, info } }) satisfies TranslatedEvent

  const partUpdated = (sessionID: string, part: Part, time: number) =>
    ({ type: "message.part.updated", properties: { sessionID, part, time } }) satisfies TranslatedEvent

  const partDelta = (sessionID: string, messageID: string, partID: string, delta: string) =>
    ({
      type: "message.part.delta",
      properties: { sessionID, messageID, partID, field: "text", delta },
    }) satisfies TranslatedEvent

  function translate(event: GlobalEvent["payload"]): TranslatedEvent[] {
    switch (event.type) {
      case "session.next.prompted": {
        const data = event.properties
        const ctx = context(data.sessionID)
        const adapted = adaptUser(
          {
            id: data.messageID,
            time: { created: data.timestamp },
            text: data.prompt.text,
            ...(data.prompt.files === undefined ? {} : { files: data.prompt.files }),
            ...(data.prompt.agents === undefined ? {} : { agents: data.prompt.agents }),
            type: "user",
          },
          {
            sessionID: data.sessionID,
            directory: ctx.directory,
            agent: ctx.agent,
            model: ctx.model,
          },
        )
        lastUser.set(data.sessionID, data.messageID)
        return [
          messageUpdated(data.sessionID, adapted.info),
          ...adapted.parts.map((part) => partUpdated(data.sessionID, part, data.timestamp)),
        ]
      }
      case "session.next.step.started": {
        const data = event.properties
        const ctx = context(data.sessionID)
        const skeleton: AssistantMessage = {
          id: data.assistantMessageID,
          sessionID: data.sessionID,
          role: "assistant",
          time: { created: data.timestamp },
          parentID: lastUser.get(data.sessionID) ?? ctx.lastUserID ?? "",
          modelID: data.model.id,
          providerID: data.model.providerID,
          mode: data.agent,
          agent: data.agent,
          path: { cwd: ctx.directory, root: ctx.directory },
          cost: 0,
          tokens: zeroTokens(),
          ...(data.model.variant === undefined ? {} : { variant: data.model.variant }),
        }
        assistants.set(data.assistantMessageID, skeleton)
        return [messageUpdated(data.sessionID, skeleton)]
      }
      case "session.next.text.started": {
        const data = event.properties
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.textID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "text",
              text: "",
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.text.delta": {
        const data = event.properties
        return [partDelta(data.sessionID, data.assistantMessageID, data.textID, data.delta)]
      }
      case "session.next.text.ended": {
        const data = event.properties
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.textID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "text",
              text: data.text,
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.reasoning.started": {
        const data = event.properties
        reasoningStarts.set(data.reasoningID, data.timestamp)
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.reasoningID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "reasoning",
              text: "",
              ...(data.providerMetadata === undefined ? {} : { metadata: data.providerMetadata }),
              time: { start: data.timestamp },
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.reasoning.delta": {
        const data = event.properties
        return [partDelta(data.sessionID, data.assistantMessageID, data.reasoningID, data.delta)]
      }
      case "session.next.reasoning.ended": {
        const data = event.properties
        const start = reasoningStarts.get(data.reasoningID) ?? data.timestamp
        reasoningStarts.delete(data.reasoningID)
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.reasoningID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "reasoning",
              text: data.text,
              ...(data.providerMetadata === undefined ? {} : { metadata: data.providerMetadata }),
              time: { start, end: data.timestamp },
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.tool.called": {
        const data = event.properties
        const call: CallRecord = {
          sessionID: data.sessionID,
          messageID: data.assistantMessageID,
          tool: data.tool,
          input: data.input,
          start: data.timestamp,
        }
        calls.set(data.callID, call)
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.callID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "tool",
              callID: data.callID,
              tool: data.tool,
              state: { status: "running", input: data.input, time: { start: data.timestamp } },
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.tool.progress": {
        const data = event.properties
        const call = calls.get(data.callID)
        const title = structuredTitle(data.structured)
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.callID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "tool",
              callID: data.callID,
              tool: call?.tool ?? "",
              state: {
                status: "running",
                input: call?.input ?? {},
                ...(title === undefined ? {} : { title }),
                metadata: data.structured,
                time: { start: call?.start ?? data.timestamp },
              },
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.tool.success": {
        const data = event.properties
        const call = calls.get(data.callID)
        calls.delete(data.callID)
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.callID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "tool",
              callID: data.callID,
              tool: call?.tool ?? "",
              state: {
                status: "completed",
                input: call?.input ?? {},
                output: serializeToolContent(data.content),
                title: structuredTitle(data.structured) ?? "",
                metadata: data.structured,
                time: { start: call?.start ?? data.timestamp, end: data.timestamp },
              },
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.tool.failed": {
        const data = event.properties
        const call = calls.get(data.callID)
        calls.delete(data.callID)
        return [
          partUpdated(
            data.sessionID,
            {
              id: data.callID,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "tool",
              callID: data.callID,
              tool: call?.tool ?? "",
              state: {
                status: "error",
                input: call?.input ?? {},
                error: data.error.message,
                time: { start: call?.start ?? data.timestamp, end: data.timestamp },
              },
            },
            data.timestamp,
          ),
        ]
      }
      case "session.next.step.ended": {
        const data = event.properties
        const skeleton = assistants.get(data.assistantMessageID)
        if (!skeleton) return []
        const settled: AssistantMessage = {
          ...skeleton,
          time: { ...skeleton.time, completed: data.timestamp },
          finish: data.finish,
          cost: data.cost,
          tokens: data.tokens,
        }
        assistants.set(data.assistantMessageID, settled)
        return [messageUpdated(data.sessionID, settled)]
      }
      case "session.next.step.failed": {
        const data = event.properties
        const skeleton = assistants.get(data.assistantMessageID)
        if (!skeleton) return []
        const failed: AssistantMessage = {
          ...skeleton,
          time: { ...skeleton.time, completed: data.timestamp },
          error: { name: "UnknownError", data: { message: data.error.message } },
        }
        assistants.set(data.assistantMessageID, failed)
        return [messageUpdated(data.sessionID, failed)]
      }
      case "session.next.compaction.ended": {
        const data = event.properties
        const ctx = context(data.sessionID)
        const adapt = {
          sessionID: data.sessionID,
          directory: ctx.directory,
          agent: ctx.agent,
          model: ctx.model,
        }
        const adapted = adaptUser(
          { id: data.messageID, time: { created: data.timestamp }, text: "", type: "user" },
          adapt,
        )
        const compaction = compactionPart(
          {
            id: data.messageID,
            time: { created: data.timestamp },
            type: "compaction",
            reason: data.reason,
            summary: data.text,
            recent: data.recent,
          },
          adapt,
        )
        lastUser.set(data.sessionID, data.messageID)
        return [
          messageUpdated(data.sessionID, adapted.info),
          partUpdated(data.sessionID, compaction, data.timestamp),
        ]
      }
      case "permission.v2.asked":
        return [{ type: "permission.asked", properties: adaptPermission(event.properties) }]
      case "permission.v2.replied": {
        const data = event.properties
        return [
          {
            type: "permission.replied",
            properties: { sessionID: data.sessionID, requestID: data.requestID, reply: data.reply },
          },
        ]
      }
      case "question.v2.asked":
        return [{ type: "question.asked", properties: adaptQuestion(event.properties) }]
      case "question.v2.replied": {
        const data = event.properties
        return [
          {
            type: "question.replied",
            properties: { sessionID: data.sessionID, requestID: data.requestID, answers: data.answers },
          },
        ]
      }
      case "question.v2.rejected": {
        const data = event.properties
        return [
          { type: "question.rejected", properties: { sessionID: data.sessionID, requestID: data.requestID } },
        ]
      }
      default:
        return []
    }
  }

  function evict(sessionID: string) {
    lastUser.delete(sessionID)
    for (const [id, message] of assistants) if (message.sessionID === sessionID) assistants.delete(id)
    for (const [id, call] of calls) if (call.sessionID === sessionID) calls.delete(id)
  }

  return { translate, evict }
}
