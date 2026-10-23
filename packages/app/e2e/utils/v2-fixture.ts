// V2 wire fixture 工厂与校验防线（e2e-v2-mock Wave 1）。
// 产出 SDK gen 的 wire 形状（服务端 JSON 编码侧），运行时经 @opennovel-ai/schema
// 的 Effect Schema 解码校验（严格 excess property），接班被删 timeline fixture 的防线。
// adapter 硬约束（v2-adapter.ts）：assistant 必填 id/time.created/agent/model/content；
// tool pending 的 input 是 JSON string，其余三态是 Record 且 structured/content 必填；
// structured 整体透传为视图模型 metadata（sessionId/provider/answers/filediff/files）。
import { Schema } from "effect"
import { SessionEvent } from "@opennovel-ai/schema/session-event"
import { SessionMessage } from "@opennovel-ai/schema/session-message"
import { Permission } from "@opennovel-ai/schema/permission"
import { Question } from "@opennovel-ai/schema/question"
import type {
  LlmToolContent,
  ModelRef,
  PromptAgentAttachment,
  PromptFileAttachment,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionMessageToolStatePending,
  SessionMessageToolStateRunning,
  SessionMessageUser,
} from "@opennovel-ai/sdk/v2/client"

// adapter 只渲染 user/assistant/compaction，其余消息类型首版丢弃（v2-adapter.ts:351）
export type V2FixtureMessage = SessionMessageUser | SessionMessageAssistant | SessionMessageCompaction

export type V2SseFrame = {
  directory: string
  payload: { id: string; type: string; properties: Record<string, unknown> }
}

const decodeOptions = { errors: "all", onExcessProperty: "error" } as const
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)

const eventDefinitions: ReadonlyMap<string, Schema.Codec<unknown, unknown>> = new Map(
  [...SessionEvent.Definitions, ...Question.Event.Definitions, ...Permission.Event.Definitions].map(
    (definition) => [definition.type, definition.data] as const,
  ),
)

let messageSequence = 0
let eventSequence = 0
let clock = 1_760_000_000_000

/** 测试间确定性：每个 spec 文件开场调用归零计数器与时钟 */
export function resetV2FixtureCounters() {
  messageSequence = 0
  eventSequence = 0
  clock = 1_760_000_000_000
}

const nextMessageID = () => `msg_fixture_${String(++messageSequence).padStart(4, "0")}`
const nextTimestamp = () => (clock += 1000)

function checked<T extends V2FixtureMessage>(message: T): T {
  decodeMessage(message, decodeOptions)
  return message
}

export function v2UserMessage(input: {
  id?: string
  text: string
  created?: number
  files?: PromptFileAttachment[]
  agents?: PromptAgentAttachment[]
}): SessionMessageUser {
  return checked({
    type: "user",
    id: input.id ?? nextMessageID(),
    time: { created: input.created ?? nextTimestamp() },
    text: input.text,
    ...(input.files === undefined ? {} : { files: input.files }),
    ...(input.agents === undefined ? {} : { agents: input.agents }),
  })
}

export function v2Text(text: string, id?: string): SessionMessageAssistantText {
  return { type: "text", id: id ?? `${nextMessageID()}:text`, text }
}

export function v2Reasoning(
  text: string,
  input?: { id?: string; created?: number; completed?: number; providerMetadata?: Record<string, Record<string, unknown>> },
): SessionMessageAssistantReasoning {
  return {
    type: "reasoning",
    id: input?.id ?? `${nextMessageID()}:reasoning`,
    text,
    ...(input?.providerMetadata === undefined ? {} : { providerMetadata: input.providerMetadata }),
    ...(input?.created === undefined
      ? {}
      : {
          time: {
            created: input.created,
            ...(input.completed === undefined ? {} : { completed: input.completed }),
          },
        }),
  }
}

export function v2ToolPending(input: Record<string, unknown>): SessionMessageToolStatePending {
  // pending 的 input 在 wire 上是 JSON string（adapter JSON.parse，失败降级空对象）
  return { status: "pending", input: JSON.stringify(input) }
}

export function v2ToolRunning(input: {
  input: Record<string, unknown>
  structured?: Record<string, unknown>
  content?: LlmToolContent[]
}): SessionMessageToolStateRunning {
  return { status: "running", input: input.input, structured: input.structured ?? {}, content: input.content ?? [] }
}

export function v2ToolCompleted(input: {
  input: Record<string, unknown>
  structured?: Record<string, unknown>
  content?: LlmToolContent[]
  attachments?: PromptFileAttachment[]
  outputPaths?: string[]
  result?: unknown
}): SessionMessageToolStateCompleted {
  return {
    status: "completed",
    input: input.input,
    structured: input.structured ?? {},
    content: input.content ?? [],
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    ...(input.outputPaths === undefined ? {} : { outputPaths: input.outputPaths }),
    ...(input.result === undefined ? {} : { result: input.result }),
  }
}

export function v2ToolError(input: {
  input: Record<string, unknown>
  error: string
  structured?: Record<string, unknown>
  content?: LlmToolContent[]
  result?: unknown
}): SessionMessageToolStateError {
  return {
    status: "error",
    input: input.input,
    structured: input.structured ?? {},
    content: input.content ?? [],
    error: { type: "unknown", message: input.error },
    ...(input.result === undefined ? {} : { result: input.result }),
  }
}

export function v2Tool(input: {
  name: string
  state:
    | SessionMessageToolStatePending
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError
  id?: string
  created?: number
  ran?: number
  completed?: number
  provider?: { executed: boolean; metadata?: Record<string, Record<string, unknown>> }
}): SessionMessageAssistantTool {
  const created = input.created ?? nextTimestamp()
  return {
    type: "tool",
    id: input.id ?? `${nextMessageID()}:tool`,
    name: input.name,
    state: input.state,
    time: {
      created,
      ...(input.ran === undefined ? {} : { ran: input.ran }),
      ...(input.completed === undefined ? {} : { completed: input.completed }),
    },
    ...(input.provider === undefined ? {} : { provider: input.provider }),
  }
}

const defaultModel = (): ModelRef => ({ id: "mock-model", providerID: "mock-provider" })

export function v2AssistantMessage(input: {
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  id?: string
  agent?: string
  model?: ModelRef
  created?: number
  completed?: number
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  finish?: string
  error?: string
}): SessionMessageAssistant {
  return checked({
    type: "assistant",
    id: input.id ?? nextMessageID(),
    time: {
      created: input.created ?? nextTimestamp(),
      ...(input.completed === undefined ? {} : { completed: input.completed }),
    },
    agent: input.agent ?? "build",
    model: input.model ?? defaultModel(),
    content: input.content,
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    ...(input.tokens === undefined ? {} : { tokens: input.tokens }),
    ...(input.finish === undefined ? {} : { finish: input.finish }),
    ...(input.error === undefined ? {} : { error: { type: "unknown" as const, message: input.error } }),
  })
}

export function v2Compaction(input: {
  reason: "auto" | "manual"
  summary: string
  recent: string
  id?: string
  created?: number
}): SessionMessageCompaction {
  return checked({
    type: "compaction",
    id: input.id ?? nextMessageID(),
    time: { created: input.created ?? nextTimestamp() },
    reason: input.reason,
    summary: input.summary,
    recent: input.recent,
  })
}

/** N 对 user+assistant 历史回合（升序），供分页/滚动场景播种 */
export function v2History(count: number, input?: { agent?: string; model?: ModelRef }): V2FixtureMessage[] {
  return Array.from({ length: count }, (_, index) => index + 1).flatMap((n) => [
    v2UserMessage({ text: `history turn ${n} prompt` }),
    v2AssistantMessage({
      content: [v2Text(`history turn ${n} response`)],
      completed: nextTimestamp(),
      ...(input?.agent === undefined ? {} : { agent: input.agent }),
      ...(input?.model === undefined ? {} : { model: input.model }),
    }),
  ])
}

/** fixture 自检：重复 ID、孤儿 assistant（前面必须已有 user/compaction）、content 归属 */
export function validateV2Timeline(messages: V2FixtureMessage[]) {
  const seen = new Set<string>()
  let hasUser = false
  for (const message of messages) {
    if (seen.has(message.id)) throw new Error(`duplicate message id: ${message.id}`)
    seen.add(message.id)
    if (message.type === "user" || message.type === "compaction") {
      hasUser = true
      continue
    }
    if (!hasUser) throw new Error(`orphan assistant message: ${message.id} (no preceding user/compaction)`)
    const contentIDs = new Set<string>()
    for (const item of message.content) {
      if (contentIDs.has(item.id)) throw new Error(`duplicate content id ${item.id} in ${message.id}`)
      contentIDs.add(item.id)
    }
  }
}

/** SSE 帧工厂：properties 经事件 schema 严格校验，产出 {directory, payload} 信封 */
export function v2Event(directory: string, type: string, properties: Record<string, unknown>): V2SseFrame {
  const data = eventDefinitions.get(type)
  if (!data) throw new Error(`unknown V2 event type: ${type}`)
  Schema.decodeUnknownSync(data)(properties, decodeOptions)
  return {
    directory,
    payload: { id: `evt_fixture_${String(++eventSequence).padStart(4, "0")}`, type, properties },
  }
}

const zeroTokens = () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

/** user→assistant 流式回合最小事件集（6 帧：prompted→step.started→text.started→text.delta×N→text.ended→step.ended）。
 *  注意 step.ended 会触发 app 拉 GET /api/session/{id}/diff，mock 必须兜住。 */
export function v2StreamTurn(input: {
  directory: string
  sessionID: string
  text: string
  messageID?: string
  assistantMessageID?: string
  textID?: string
  chunks?: number
  agent?: string
  model?: ModelRef
}): V2SseFrame[] {
  const messageID = input.messageID ?? nextMessageID()
  const assistantMessageID = input.assistantMessageID ?? nextMessageID()
  const textID = input.textID ?? `${assistantMessageID}:text`
  const chunks = input.chunks ?? 3
  const size = Math.max(1, Math.ceil(input.text.length / chunks))
  const deltas = Array.from({ length: Math.ceil(input.text.length / size) }, (_, index) =>
    input.text.slice(index * size, (index + 1) * size),
  )
  const base = () => ({ timestamp: nextTimestamp(), sessionID: input.sessionID })
  const step = () => ({ ...base(), assistantMessageID })
  return [
    v2Event(input.directory, "session.next.prompted", {
      ...base(),
      messageID,
      prompt: { text: input.text },
      delivery: "steer",
    }),
    v2Event(input.directory, "session.next.step.started", {
      ...step(),
      agent: input.agent ?? "build",
      model: input.model ?? defaultModel(),
    }),
    v2Event(input.directory, "session.next.text.started", { ...step(), textID }),
    ...deltas.map((delta) => v2Event(input.directory, "session.next.text.delta", { ...step(), textID, delta })),
    v2Event(input.directory, "session.next.text.ended", { ...step(), textID, text: input.text }),
    v2Event(input.directory, "session.next.step.ended", {
      ...step(),
      finish: "stop",
      cost: 0,
      tokens: zeroTokens(),
    }),
  ]
}
