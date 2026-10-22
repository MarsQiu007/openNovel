import type {
  AssistantMessage,
  FileDiff,
  FilePart,
  LlmToolContent,
  Message,
  Part,
  PermissionRequest,
  PermissionV2Request,
  PromptFileAttachment,
  QuestionRequest,
  QuestionV2Request,
  RevertState,
  Session,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageUser,
  SessionV2Info,
  SnapshotFileDiff,
  ToolPart,
  UserMessage,
} from "@opennovel-ai/sdk/v2/client"

// V2 投影/事件形状 → V1 store 形状的纯函数适配层。
// timeline/session-ui/导出继续消费 V1 Message/Part 词汇，读取面统一在这里转换。

export type AdaptContext = {
  sessionID: string
  directory: string
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
}

export const zeroTokens = () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

export function adaptRevert(revert: RevertState): NonNullable<Session["revert"]> {
  return {
    messageID: revert.messageID,
    ...(revert.partID === undefined ? {} : { partID: revert.partID }),
    ...(revert.snapshot === undefined ? {} : { snapshot: revert.snapshot }),
    ...(revert.diff === undefined ? {} : { diff: revert.diff }),
  }
}

export function adaptInfo(session: SessionV2Info): Session {
  return {
    id: session.id,
    slug: session.id,
    projectID: session.projectID,
    ...(session.location.workspaceID === undefined ? {} : { workspaceID: session.location.workspaceID }),
    directory: session.location.directory,
    ...(session.subpath === undefined ? {} : { path: session.subpath }),
    ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
    cost: session.cost,
    tokens: session.tokens,
    title: session.title,
    ...(session.agent === undefined ? {} : { agent: session.agent }),
    ...(session.model === undefined ? {} : { model: session.model }),
    version: "",
    time: session.time,
    ...(session.revert === undefined ? {} : { revert: adaptRevert(session.revert) }),
  }
}

/** session.next.created 事件 payload → Session（新会话尚无用量，cost/tokens 置零）。 */
export function adaptCreated(props: {
  sessionID: string
  timestamp: number
  projectID: string
  directory: string
  path?: string
  workspaceID?: string
  parentID?: string
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  version: string
}): Session {
  return {
    id: props.sessionID,
    slug: props.sessionID,
    projectID: props.projectID,
    directory: props.directory,
    ...(props.workspaceID === undefined ? {} : { workspaceID: props.workspaceID }),
    ...(props.path === undefined ? {} : { path: props.path }),
    ...(props.parentID === undefined ? {} : { parentID: props.parentID }),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    title: props.title,
    ...(props.agent === undefined ? {} : { agent: props.agent }),
    ...(props.model === undefined ? {} : { model: props.model }),
    version: props.version,
    time: { created: props.timestamp, updated: props.timestamp },
  }
}

export function adaptDiff(diffs: FileDiff[]): SnapshotFileDiff[] {
  return diffs.map((diff) => ({
    file: diff.path,
    status: diff.status,
    additions: diff.additions,
    deletions: diff.deletions,
    patch: diff.patch,
  }))
}

export function adaptPermission(request: PermissionV2Request): PermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    always: request.save ?? [],
    metadata: request.metadata ?? {},
    ...(request.source === undefined
      ? {}
      : { tool: { messageID: request.source.messageID, callID: request.source.callID } }),
  }
}

export function adaptQuestion(request: QuestionV2Request): QuestionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    questions: request.questions,
    ...(request.tool === undefined ? {} : { tool: request.tool }),
  }
}

export function serializeToolContent(content: LlmToolContent[]): string {
  return content
    .map((item) => (item.type === "text" ? item.text : `[file] ${item.name ?? item.uri}`))
    .filter((text) => text.length > 0)
    .join("\n")
}

export const structuredTitle = (structured: Record<string, unknown>) =>
  typeof structured.title === "string" ? structured.title : undefined

const filePath = (uri: string) => uri.replace(/^file:\/\//, "").split("?")[0]

function adaptAttachment(
  attachment: PromptFileAttachment,
  id: string,
  messageID: string,
  sessionID: string,
): FilePart {
  return {
    id,
    sessionID,
    messageID,
    type: "file",
    mime: attachment.mime,
    ...(attachment.name === undefined ? {} : { filename: attachment.name }),
    url: attachment.uri,
    ...(attachment.source === undefined
      ? {}
      : {
          source: {
            type: "file" as const,
            path: filePath(attachment.uri),
            text: { value: attachment.source.text, start: attachment.source.start, end: attachment.source.end },
          },
        }),
  }
}

function adaptToolState(tool: SessionMessageAssistantTool, messageID: string, sessionID: string): ToolPart["state"] {
  const start = tool.time.ran ?? tool.time.created
  const end = tool.time.completed ?? tool.time.ran ?? tool.time.created
  const state = tool.state
  if (state.status === "pending") {
    let input: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(state.input)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>
    } catch {
      // raw 保留原文，input 解析失败按空对象降级
    }
    return { status: "pending", input, raw: state.input }
  }
  if (state.status === "running") {
    const title = structuredTitle(state.structured)
    return {
      status: "running",
      input: state.input,
      ...(title === undefined ? {} : { title }),
      metadata: state.structured,
      time: { start },
    }
  }
  if (state.status === "completed") {
    return {
      status: "completed",
      input: state.input,
      output: serializeToolContent(state.content),
      title: structuredTitle(state.structured) ?? "",
      metadata: state.structured,
      time: { start, end },
      ...(state.attachments === undefined
        ? {}
        : {
            attachments: state.attachments.map((attachment, index) =>
              adaptAttachment(attachment, `${tool.id}:attachment:${index}`, messageID, sessionID),
            ),
          }),
    }
  }
  return {
    status: "error",
    input: state.input,
    error: state.error.message,
    metadata: state.structured,
    time: { start, end },
  }
}

export function adaptAssistant(
  message: SessionMessageAssistant,
  ctx: AdaptContext,
  parentID: string,
): { info: AssistantMessage; parts: Part[] } {
  const info: AssistantMessage = {
    id: message.id,
    sessionID: ctx.sessionID,
    role: "assistant",
    time: {
      created: message.time.created,
      ...(message.time.completed === undefined ? {} : { completed: message.time.completed }),
    },
    ...(message.error === undefined
      ? {}
      : { error: { name: "UnknownError" as const, data: { message: message.error.message } } }),
    parentID,
    modelID: message.model.id,
    providerID: message.model.providerID,
    mode: message.agent,
    agent: message.agent,
    path: { cwd: ctx.directory, root: ctx.directory },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? zeroTokens(),
    ...(message.model.variant === undefined ? {} : { variant: message.model.variant }),
    ...(message.finish === undefined ? {} : { finish: message.finish }),
  }
  const parts = message.content.map((item): Part => {
    if (item.type === "text") {
      return {
        id: item.id,
        sessionID: ctx.sessionID,
        messageID: message.id,
        type: "text",
        text: item.text,
      }
    }
    if (item.type === "reasoning") {
      return {
        id: item.id,
        sessionID: ctx.sessionID,
        messageID: message.id,
        type: "reasoning",
        text: item.text,
        ...(item.providerMetadata === undefined ? {} : { metadata: item.providerMetadata }),
        time: {
          start: item.time?.created ?? message.time.created,
          ...(item.time?.completed === undefined ? {} : { end: item.time.completed }),
        },
      }
    }
    return {
      id: item.id,
      sessionID: ctx.sessionID,
      messageID: message.id,
      type: "tool",
      callID: item.id,
      tool: item.name,
      state: adaptToolState(item, message.id, ctx.sessionID),
    }
  })
  return { info, parts }
}

export function adaptUser(message: SessionMessageUser, ctx: AdaptContext): { info: UserMessage; parts: Part[] } {
  const info: UserMessage = {
    id: message.id,
    sessionID: ctx.sessionID,
    role: "user",
    time: { created: message.time.created },
    agent: ctx.agent,
    model: ctx.model,
  }
  const text: Part[] = message.text
    ? [
        {
          id: `${message.id}:text`,
          sessionID: ctx.sessionID,
          messageID: message.id,
          type: "text",
          text: message.text,
        },
      ]
    : []
  const files = (message.files ?? []).map((attachment, index) =>
    adaptAttachment(attachment, `${message.id}:file:${index}`, message.id, ctx.sessionID),
  )
  const agents = (message.agents ?? []).map(
    (attachment, index): Part => ({
      id: `${message.id}:agent:${index}`,
      sessionID: ctx.sessionID,
      messageID: message.id,
      type: "agent",
      name: attachment.name,
      ...(attachment.source === undefined
        ? {}
        : {
            source: {
              value: attachment.source.text,
              start: attachment.source.start,
              end: attachment.source.end,
            },
          }),
    }),
  )
  return { info, parts: [...text, ...files, ...agents] }
}

// compaction 投影为合成 user 消息 + CompactionPart，对齐 V1 时间线形态
export function adaptCompaction(message: SessionMessageCompaction, ctx: AdaptContext): { info: UserMessage; parts: Part[] } {
  return adaptUser(
    {
      id: message.id,
      time: message.time,
      text: "",
      type: "user",
    },
    ctx,
  )
}

export function compactionPart(message: SessionMessageCompaction, ctx: AdaptContext): Part {
  return {
    id: `${message.id}:compaction`,
    sessionID: ctx.sessionID,
    messageID: message.id,
    type: "compaction",
    auto: message.reason === "auto",
  }
}

// system/synthetic/agent-switched/model-switched/shell 首版不渲染，返回 undefined
export function adaptMessage(
  message: SessionMessage,
  ctx: AdaptContext,
  parentID?: string,
): { info: Message; parts: Part[] } | undefined {
  if (message.type === "user") return adaptUser(message, ctx)
  if (message.type === "assistant") return adaptAssistant(message, ctx, parentID ?? "")
  if (message.type === "compaction") {
    const adapted = adaptCompaction(message, ctx)
    return { info: adapted.info, parts: [...adapted.parts, compactionPart(message, ctx)] }
  }
  return undefined
}

// 页面级适配：按时间线升序跟踪最近 user（含合成 compaction-user）补齐 assistant parentID。
// 输入必须已是升序；页首 assistant 的父消息在更早分页时 parentID 置空串，由时间线容错。
export function adaptMessages(messages: SessionMessage[], ctx: AdaptContext) {
  const session: Message[] = []
  const part: { id: string; part: Part[] }[] = []
  let lastUser = ""
  for (const message of messages) {
    const adapted = adaptMessage(message, ctx, lastUser)
    if (!adapted) continue
    if (adapted.info.role === "user") lastUser = adapted.info.id
    session.push(adapted.info)
    part.push({ id: adapted.info.id, part: adapted.parts })
  }
  return { session, part }
}
