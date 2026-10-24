// 冻结的 V1 形状视图模型契约（v1-removal G6 落地）。
// V1 wire 已随 legacy 路由裁撤，以下类型不再是协议形状——生成器不会再产出它们。
// 它们是 app/session-ui/plugin-tui 的内部视图模型词汇：app 的 v2-adapter 在
// SDK 边界把 V2 投影/事件转换成这些形状，组件层继续消费。
// 机械复制自重生前的 gen/types.gen.ts（源头已随重生消失）；RevertState/Range
// 在 V2 wire 中仍存活且形状一致，直接从 gen 引用避免重复。ProviderAuthError/
// UnknownError 的 V2 wire 形状已变（_tag 词汇），此处保留 V1 形状并在
// client.ts 显式 re-export 压过 gen 同名导出。
// 禁止扩展字段；新功能一律走 V2 类型。
import type { Range } from "./gen/types.gen.js"

export type ProviderAuthError = {
  name: "ProviderAuthError"
  data: {
    providerID: string
    message: string
  }
}

export type UnknownError = {
  name: "UnknownError"
  data: {
    message: string
    ref?: string
  }
}

export type SnapshotFileDiff = {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type PermissionAction = "allow" | "deny" | "ask"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRuleset = Array<PermissionRule>

export type Session = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  share?: {
    url: string
  }
  title: string
  agent?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  version: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: PermissionRuleset
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

export type OutputFormatText = {
  type: "text"
}

export type JsonSchema = {
  [key: string]: unknown
}

export type OutputFormatJsonSchema = {
  type: "json_schema"
  schema: JsonSchema
  retryCount?: number
}

export type OutputFormat = OutputFormatText | OutputFormatJsonSchema

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: {
    created: number
  }
  format?: OutputFormat
  agent: string
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  system?: string
  tools?: {
    [key: string]: boolean
  }
}

export type MessageOutputLengthError = {
  name: "MessageOutputLengthError"
  data: {
    [key: string]: unknown
  }
}

export type MessageAbortedError = {
  name: "MessageAbortedError"
  data: {
    message: string
  }
}

export type StructuredOutputError = {
  name: "StructuredOutputError"
  data: {
    message: string
    retries: number
  }
}

export type ContextOverflowError = {
  name: "ContextOverflowError"
  data: {
    message: string
    responseBody?: string
  }
}

export type ContentFilterError = {
  name: "ContentFilterError"
  data: {
    message: string
  }
}

export type ApiError = {
  name: "APIError"
  data: {
    message: string
    statusCode?: number
    isRetryable: boolean
    responseHeaders?: {
      [key: string]: string
    }
    responseBody?: string
    metadata?: {
      [key: string]: string
    }
  }
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: {
    created: number
    completed?: number
  }
  error?:
    | ProviderAuthError
    | UnknownError
    | MessageOutputLengthError
    | MessageAbortedError
    | StructuredOutputError
    | ContextOverflowError
    | ContentFilterError
    | ApiError
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: {
    cwd: string
    root: string
  }
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  structured?: unknown
  variant?: string
  finish?: string
}

export type Message = UserMessage | AssistantMessage

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    [key: string]: unknown
  }
}

export type SubtaskPart = {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  command?: string
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
    end?: number
  }
}

export type FilePartSourceText = {
  value: string
  start: number
  end: number
}

export type FileSource = {
  text: FilePartSourceText
  type: "file"
  path: string
}

export type SymbolSource = {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: Range
  name: string
  kind: number
}

export type ResourceSource = {
  text: FilePartSourceText
  type: "resource"
  clientName: string
  uri: string
}

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type ToolStatePending = {
  status: "pending"
  input: {
    [key: string]: unknown
  }
  raw: string
}

export type ToolStateRunning = {
  status: "running"
  input: {
    [key: string]: unknown
  }
  title?: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
  }
}

export type ToolStateCompleted = {
  status: "completed"
  input: {
    [key: string]: unknown
  }
  output: string
  title: string
  metadata: {
    [key: string]: unknown
  }
  time: {
    start: number
    end: number
    compacted?: number
  }
  attachments?: Array<FilePart>
}

export type ToolStateError = {
  status: "error"
  input: {
    [key: string]: unknown
  }
  error: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
    end: number
  }
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: {
    [key: string]: unknown
  }
}

export type StepStartPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
  snapshot?: string
}

export type StepFinishPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

export type SnapshotPart = {
  id: string
  sessionID: string
  messageID: string
  type: "snapshot"
  snapshot: string
}

export type PatchPart = {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: Array<string>
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export type RetryPart = {
  id: string
  sessionID: string
  messageID: string
  type: "retry"
  attempt: number
  error: ApiError
  time: {
    created: number
  }
}

export type CompactionPart = {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type QuestionOption = {
  /**
   * Display text (1-5 words, concise)
   */
  label: string
  /**
   * Explanation of choice
   */
  description: string
}

export type QuestionInfo = {
  /**
   * Complete question
   */
  question: string
  /**
   * Very short label (max 30 chars)
   */
  header: string
  /**
   * Available choices
   */
  options: Array<QuestionOption>
  multiple?: boolean
  custom?: boolean
}

export type QuestionTool = {
  messageID: string
  callID: string
}

export type QuestionAnswer = Array<string>

export type QuestionRequest = {
  id: string
  sessionID: string
  /**
   * Questions to ask
   */
  questions: Array<QuestionInfo>
  tool?: QuestionTool
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: {
    [key: string]: unknown
  }
  always: Array<string>
  tool?: {
    messageID: string
    callID: string
  }
}

export type EventMessageUpdated = {
  id: string
  type: "message.updated"
  properties: {
    sessionID: string
    info: Message
  }
}

export type EventMessagePartUpdated = {
  id: string
  type: "message.part.updated"
  properties: {
    sessionID: string
    part: Part
    time: number
  }
}

export type EventMessagePartDelta = {
  id: string
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

export type EventPermissionAsked = {
  id: string
  type: "permission.asked"
  properties: PermissionRequest
}

export type EventPermissionReplied = {
  id: string
  type: "permission.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }
}

export type EventQuestionAsked = {
  id: string
  type: "question.asked"
  properties: QuestionRequest
}

export type EventQuestionReplied = {
  id: string
  type: "question.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionAnswer>
  }
}

export type EventQuestionRejected = {
  id: string
  type: "question.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type TextPartInput = {
  id?: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    [key: string]: unknown
  }
}

export type FilePartInput = {
  id?: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type AgentPartInput = {
  id?: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}
