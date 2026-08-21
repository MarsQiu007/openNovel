import type { OpenNovelEventEncoded } from "@opennovel-ai/protocol/groups/event"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError"

export type ProviderNotFoundError = {
  readonly _tag: "ProviderNotFoundError"
  readonly providerID: string
  readonly message: string
}
export const isProviderNotFoundError = (value: unknown): value is ProviderNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type QuestionNotFoundError = {
  readonly _tag: "QuestionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isQuestionNotFoundError = (value: unknown): value is QuestionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "QuestionNotFoundError"

export type ProjectCopyError = {
  readonly name: "ProjectCopyError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isProjectCopyError = (value: unknown): value is ProjectCopyError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "ProjectCopyError"

export type NovelValidationError = {
  readonly name: "NovelValidationError"
  readonly data: { readonly message: string; readonly field?: string | undefined }
}
export const isNovelValidationError = (value: unknown): value is NovelValidationError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "NovelValidationError"

export type NovelNotFoundError = {
  readonly name: "NovelNotFoundError"
  readonly data: { readonly message: string; readonly novelId?: string | undefined }
}
export const isNovelNotFoundError = (value: unknown): value is NovelNotFoundError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "NovelNotFoundError"

export type ChapterNotFoundError = {
  readonly name: "ChapterNotFoundError"
  readonly data: {
    readonly message: string
    readonly novelId?: string | undefined
    readonly chapterId?: string | undefined
  }
}
export const isChapterNotFoundError = (value: unknown): value is ChapterNotFoundError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "ChapterNotFoundError"

export type NovelModeError = { readonly name: "NovelModeError"; readonly data: { readonly message: string } }
export const isNovelModeError = (value: unknown): value is NovelModeError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "NovelModeError"

export type SyncErrorResponse = {
  readonly name: "SyncErrorResponse"
  readonly data: { readonly message: string; readonly code?: string | undefined }
}
export const isSyncErrorResponse = (value: unknown): value is SyncErrorResponse =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "SyncErrorResponse"

export type HealthGetOutput = { readonly healthy: true }

export type LocationGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type LocationGetOutput = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: { readonly id: string; readonly directory: string }
}

export type AgentsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type AgentsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
    readonly system?: string
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
    readonly steps?: number
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }>
  }>
}

export type SessionsListInput = {
  readonly workspace?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["workspace"]
  readonly limit?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly directory?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }>
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type SessionsCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["id"]
  readonly agent?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["location"]
}

export type SessionsCreateOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsActiveOutput = { readonly data: { readonly [x: string]: { readonly type: "running" } } }["data"]

export type SessionsGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionsSwitchAgentOutput = void

export type SessionsSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionsSwitchModelOutput = void

export type SessionsPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly prompt: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["prompt"]
  readonly delivery?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionsPromptOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly mime: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery: "steer" | "queue"
    readonly timeCreated: number
    readonly promotedSeq?: number
  }
}["data"]

export type SessionsCompactInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCompactOutput = void

export type SessionsWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsWaitOutput = void

export type SessionsStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionsStageOutput = {
  readonly data: {
    readonly messageID: string
    readonly partID?: string
    readonly snapshot?: string
    readonly diff?: string
    readonly files?: ReadonlyArray<{
      readonly path: string
      readonly status: "added" | "modified" | "deleted"
      readonly additions: number
      readonly deletions: number
      readonly patch: string
    }>
  }
}["data"]

export type SessionsClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsClearOutput = void

export type SessionsCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCommitOutput = void

export type SessionsContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsContextOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
}["data"]

export type SessionsHistoryInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined; readonly after?: number | undefined }["limit"]
  readonly after?: { readonly limit?: number | undefined; readonly after?: number | undefined }["after"]
}

export type SessionsHistoryOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.agent.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly agent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.model.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.moved"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly location: { readonly directory: string; readonly workspaceID?: string }
          readonly subdirectory?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompt.admitted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.context.updated"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.synthetic"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly callID: string
          readonly command: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly callID: string
          readonly output: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly snapshot?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly finish: string
          readonly cost: number
          readonly tokens: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly snapshot?: string
          readonly files?: ReadonlyArray<string>
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly name: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.called"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly tool: string
          readonly input: { readonly [x: string]: JsonValue }
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.progress"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.success"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
          readonly outputPaths?: ReadonlyArray<string>
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly text: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.retried"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly attempt: number
          readonly error: {
            readonly message: string
            readonly statusCode?: number
            readonly isRetryable: boolean
            readonly responseHeaders?: { readonly [x: string]: string }
            readonly responseBody?: string
            readonly metadata?: { readonly [x: string]: string }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
          readonly text: string
          readonly recent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.staged"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly revert: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
            readonly files?: ReadonlyArray<{
              readonly path: string
              readonly status: "added" | "modified" | "deleted"
              readonly additions: number
              readonly deletions: number
              readonly patch: string
            }>
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.cleared"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.committed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
      }
  >
  readonly hasMore: boolean
}

export type SessionsEventsInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined }["after"]
}

export type SessionsEventsOutput =
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.agent.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly agent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.model.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.moved"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly location: { readonly directory: string; readonly workspaceID?: string }
        readonly subdirectory?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompt.admitted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.context.updated"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.synthetic"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly callID: string
        readonly command: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly callID: string
        readonly output: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly snapshot?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly finish: string
        readonly cost: number
        readonly tokens: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly snapshot?: string
        readonly files?: ReadonlyArray<string>
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly name: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.called"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly tool: string
        readonly input: { readonly [x: string]: unknown }
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.progress"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.success"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
        readonly outputPaths?: ReadonlyArray<string>
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly text: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.retried"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly attempt: number
        readonly error: {
          readonly message: string
          readonly statusCode?: number
          readonly isRetryable: boolean
          readonly responseHeaders?: { readonly [x: string]: string }
          readonly responseBody?: string
          readonly metadata?: { readonly [x: string]: string }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
        readonly text: string
        readonly recent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.staged"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly revert: {
          readonly messageID: string
          readonly partID?: string
          readonly snapshot?: string
          readonly diff?: string
          readonly files?: ReadonlyArray<{
            readonly path: string
            readonly status: "added" | "modified" | "deleted"
            readonly additions: number
            readonly deletions: number
            readonly patch: string
          }>
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.cleared"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.committed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
    }

export type SessionsInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsInterruptOutput = void

export type SessionsMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionsMessageOutput = {
  readonly data:
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
}["data"]

export type MessagesListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type MessagesListOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type ModelsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly providerID: string
    readonly family?: string
    readonly name: string
    readonly api:
      | {
          readonly id: string
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly id: string
          readonly type: "native"
          readonly url?: string
          readonly settings: { readonly [x: string]: JsonValue }
        }
    readonly capabilities: {
      readonly tools: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
      readonly variant?: string
    }
    readonly variants: ReadonlyArray<{
      readonly id: string
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }>
    readonly time: { readonly released: number }
    readonly cost: ReadonlyArray<{
      readonly tier?: { readonly type: "context"; readonly size: number }
      readonly input: number
      readonly output: number
      readonly cache: { readonly read: number; readonly write: number }
    }>
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled: boolean
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  }>
}

export type ProvidersListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }>
}

export type ProvidersGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }
}

export type IntegrationsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  }>
}

export type IntegrationsGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  } | null
}

export type IntegrationsConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly key: { readonly key: string; readonly label?: string | undefined }["key"]
  readonly label?: { readonly key: string; readonly label?: string | undefined }["label"]
}

export type IntegrationsConnectKeyOutput = void

export type IntegrationsConnectOauthInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["methodID"]
  readonly inputs: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["inputs"]
  readonly label?: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationsConnectOauthOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly attemptID: string
    readonly url: string
    readonly instructions: string
    readonly mode: "auto" | "code"
    readonly time: {
      readonly created: number | "Infinity" | "-Infinity" | "NaN"
      readonly expires: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type IntegrationsAttemptStatusInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptStatusOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data:
    | {
        readonly status: "pending"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "complete"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "failed"
        readonly message: string
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "expired"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
}

export type IntegrationsAttemptCompleteInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationsAttemptCompleteOutput = void

export type IntegrationsAttemptCancelInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptCancelOutput = void

export type CredentialsUpdateInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialsUpdateOutput = void

export type CredentialsRemoveInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CredentialsRemoveOutput = void

export type PermissionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}

export type PermissionsListSavedInput = {
  readonly projectID?: { readonly projectID?: string | undefined }["projectID"]
}

export type PermissionsListSavedOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly projectID: string
    readonly action: string
    readonly resource: string
  }>
}["data"]

export type PermissionsRemoveSavedInput = { readonly id: { readonly id: string }["id"] }

export type PermissionsRemoveSavedOutput = void

export type PermissionsCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["id"]
  readonly action: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["action"]
  readonly resources: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["resources"]
  readonly save?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["save"]
  readonly metadata?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["metadata"]
  readonly source?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["source"]
  readonly agent?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["agent"]
}

export type PermissionsCreateOutput = {
  readonly data: { readonly id: string; readonly effect: "allow" | "deny" | "ask" }
}["data"]

export type PermissionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type PermissionsGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }
}["data"]

export type PermissionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionsReplyOutput = void

export type FilesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["location"]
  readonly path?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["path"]
}

export type FilesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type FilesFindInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly query: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FilesFindOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type CommandsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly template: string
    readonly description?: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly subtask?: boolean
  }>
}

export type SkillsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly slash?: boolean
    readonly location: string
    readonly content: string
  }>
}

export type EventsSubscribeOutput = OpenNovelEventEncoded

export type PtysListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }>
}

export type PtysCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly command?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["command"]
  readonly args?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["cwd"]
  readonly title?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["title"]
  readonly env?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["env"]
}

export type PtysCreateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly size?: { readonly rows: number; readonly cols: number }
  }["title"]
  readonly size?: { readonly title?: string; readonly size?: { readonly rows: number; readonly cols: number } }["size"]
}

export type PtysUpdateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysRemoveInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysRemoveOutput = void

export type QuestionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type QuestionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}

export type QuestionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type QuestionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type QuestionsReplyOutput = void

export type QuestionsRejectInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type QuestionsRejectOutput = void

export type ReferencesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ReferencesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly description?: string
    readonly hidden?: boolean
    readonly source:
      | { readonly type: "local"; readonly path: string; readonly description?: string; readonly hidden?: boolean }
      | {
          readonly type: "git"
          readonly repository: string
          readonly branch?: string
          readonly description?: string
          readonly hidden?: boolean
        }
  }>
}

export type ProjectCopiesCreateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly strategy: { readonly strategy: string; readonly directory: string; readonly name?: string }["strategy"]
  readonly directory: { readonly strategy: string; readonly directory: string; readonly name?: string }["directory"]
  readonly name?: { readonly strategy: string; readonly directory: string; readonly name?: string }["name"]
}

export type ProjectCopiesCreateOutput = { readonly directory: string }

export type ProjectCopiesRemoveInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly directory: { readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly directory: string; readonly force: boolean }["force"]
}

export type ProjectCopiesRemoveOutput = void

export type ProjectCopiesRefreshInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCopiesRefreshOutput = void

export type ServerNovelListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelListOutput = ReadonlyArray<{
  readonly id: string
  readonly title: string
  readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  readonly synopsis: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerNovelCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title: {
    readonly title: string
    readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
    readonly synopsis: string
  }["title"]
  readonly genre: {
    readonly title: string
    readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
    readonly synopsis: string
  }["genre"]
  readonly synopsis: {
    readonly title: string
    readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
    readonly synopsis: string
  }["synopsis"]
}

export type ServerNovelCreateOutput = {
  readonly id: string
  readonly title: string
  readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  readonly synopsis: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelForSessionInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelForSessionOutput = {
  readonly id: string
  readonly title: string
  readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  readonly synopsis: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelSessionBindingsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelSessionBindingsOutput = ReadonlyArray<{
  readonly sessionID: string
  readonly novelID: string
  readonly novelTitle: string
}>

export type ServerNovelDetailInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDetailOutput = {
  readonly id: string
  readonly title: string
  readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  readonly synopsis: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly styleGuide: {
    readonly id: string
    readonly novelId: string
    readonly rules: { readonly [x: string]: string }
    readonly tone: string
    readonly pov: string
    readonly tense: string
  }
  readonly stats: {
    readonly chapterCount: number
    readonly volumeCount: number
    readonly characterCount: number
    readonly wordCount: number
  }
}

export type ServerNovelVolumesInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelVolumesOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly title: string
  readonly summary: string
  readonly order: number
  readonly createdAt: number
}>

export type ServerNovelChaptersInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelChaptersOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerNovelChapterInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelChapterOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly content: string
}

export type ServerNovelChapterVersionsInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelChapterVersionsOutput = ReadonlyArray<{
  readonly id: string
  readonly chapterId: string
  readonly version: number
  readonly content: string
  readonly wordCount: number
  readonly createdAt: number
  readonly createdBy: string
}>

export type ServerNovelChapterReviewsInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelChapterReviewsOutput = ReadonlyArray<{
  readonly id: string
  readonly chapterId: string
  readonly round: number
  readonly source: "deterministic" | "auditor" | "human"
  readonly overall: "PASS" | "WARN" | "FAIL"
  readonly passCount: number
  readonly warnCount: number
  readonly failCount: number
  readonly dimensions: ReadonlyArray<{
    readonly dimension: string
    readonly status: "PASS" | "WARN" | "FAIL"
    readonly detail: string
    readonly evidence?: string
  }>
  readonly summary: string
  readonly sessionId?: string
  readonly createdAt: number
}>

export type ServerNovelRollbackInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelRollbackOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelUpdateContentInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly content: { readonly content: string }["content"]
}

export type ServerNovelUpdateContentOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelApprovalInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly action: { readonly action: "approve" | "reject"; readonly comment?: string }["action"]
  readonly comment?: { readonly action: "approve" | "reject"; readonly comment?: string }["comment"]
}

export type ServerNovelApprovalOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelCharactersInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelCharactersOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly status: string
  readonly createdAt: number
}>

export type ServerNovelPlotThreadsInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelPlotThreadsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly description: string
  readonly createdAt: number
  readonly closedAt?: number
}>

export type ServerNovelForeshadowingInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelForeshadowingOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly plantedChapterId?: string
  readonly resolvedChapterId?: string
  readonly content: string
  readonly state: string
  readonly createdAt: number
}>

export type ServerNovelWorldEntriesInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelWorldEntriesOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly category: string
  readonly title: string
  readonly content: string
  readonly createdAt: number
}>

export type ServerNovelOutlineInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelOutlineOutput = {
  readonly master: string
  readonly volumes: ReadonlyArray<{ readonly volumeId: string; readonly markdown: string }>
  readonly chapters: ReadonlyArray<{ readonly chapterId: string; readonly markdown: string }>
}

export type ServerNovelUpdateOutlineInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly section: {
    readonly section: "master" | "volume" | "chapter"
    readonly id?: string
    readonly markdown: string
  }["section"]
  readonly id?: {
    readonly section: "master" | "volume" | "chapter"
    readonly id?: string
    readonly markdown: string
  }["id"]
  readonly markdown: {
    readonly section: "master" | "volume" | "chapter"
    readonly id?: string
    readonly markdown: string
  }["markdown"]
}

export type ServerNovelUpdateOutlineOutput = {
  readonly master: string
  readonly volumes: ReadonlyArray<{ readonly volumeId: string; readonly markdown: string }>
  readonly chapters: ReadonlyArray<{ readonly chapterId: string; readonly markdown: string }>
}

export type ServerNovelExportInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelExportOutput = { readonly filename: string; readonly content: string }

export type ServerNovelDeleteChapterInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteChapterOutput = { readonly deleted: boolean }

export type ServerNovelCreateVolumeInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title: { readonly title: string; readonly summary?: string }["title"]
  readonly summary?: { readonly title: string; readonly summary?: string }["summary"]
}

export type ServerNovelCreateVolumeOutput = {
  readonly id: string
  readonly novelId: string
  readonly title: string
  readonly summary: string
  readonly order: number
  readonly createdAt: number
}

export type ServerNovelUpdateVolumeInput = {
  readonly novelID: { readonly novelID: string; readonly volumeID: string }["novelID"]
  readonly volumeID: { readonly novelID: string; readonly volumeID: string }["volumeID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: { readonly title?: string; readonly summary?: string }["title"]
  readonly summary?: { readonly title?: string; readonly summary?: string }["summary"]
}

export type ServerNovelUpdateVolumeOutput = {
  readonly id: string
  readonly novelId: string
  readonly title: string
  readonly summary: string
  readonly order: number
  readonly createdAt: number
}

export type ServerNovelDeleteVolumeInput = {
  readonly novelID: { readonly novelID: string; readonly volumeID: string }["novelID"]
  readonly volumeID: { readonly novelID: string; readonly volumeID: string }["volumeID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteVolumeOutput = { readonly deleted: boolean }

export type ServerNovelRestoreVersionInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly version: { readonly version: number }["version"]
}

export type ServerNovelRestoreVersionOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelMoveChapterInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly action: { readonly action: "up" | "down" | "to-volume"; readonly volumeId?: string }["action"]
  readonly volumeId?: { readonly action: "up" | "down" | "to-volume"; readonly volumeId?: string }["volumeId"]
}

export type ServerNovelMoveChapterOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelUpdateChapterInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: { readonly title?: string; readonly status?: string }["title"]
  readonly status?: { readonly title?: string; readonly status?: string }["status"]
}

export type ServerNovelUpdateChapterOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelRelationshipsInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelRelationshipsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly charAId: string
  readonly charBId: string
  readonly type: string
  readonly description: string
}>

export type ServerNovelCreateRelationshipInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly charAId: {
    readonly charAId: string
    readonly charBId: string
    readonly type: string
    readonly description?: string
  }["charAId"]
  readonly charBId: {
    readonly charAId: string
    readonly charBId: string
    readonly type: string
    readonly description?: string
  }["charBId"]
  readonly type: {
    readonly charAId: string
    readonly charBId: string
    readonly type: string
    readonly description?: string
  }["type"]
  readonly description?: {
    readonly charAId: string
    readonly charBId: string
    readonly type: string
    readonly description?: string
  }["description"]
}

export type ServerNovelCreateRelationshipOutput = {
  readonly id: string
  readonly novelId: string
  readonly charAId: string
  readonly charBId: string
  readonly type: string
  readonly description: string
}

export type ServerNovelUpdateRelationshipInput = {
  readonly novelID: { readonly novelID: string; readonly relationshipID: string }["novelID"]
  readonly relationshipID: { readonly novelID: string; readonly relationshipID: string }["relationshipID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly type?: { readonly type?: string; readonly description?: string }["type"]
  readonly description?: { readonly type?: string; readonly description?: string }["description"]
}

export type ServerNovelUpdateRelationshipOutput = {
  readonly id: string
  readonly novelId: string
  readonly charAId: string
  readonly charBId: string
  readonly type: string
  readonly description: string
}

export type ServerNovelDeleteRelationshipInput = {
  readonly novelID: { readonly novelID: string; readonly relationshipID: string }["novelID"]
  readonly relationshipID: { readonly novelID: string; readonly relationshipID: string }["relationshipID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteRelationshipOutput = { readonly deleted: boolean }

export type ServerNovelCharacterStatesInput = {
  readonly novelID: { readonly novelID: string; readonly characterID: string }["novelID"]
  readonly characterID: { readonly novelID: string; readonly characterID: string }["characterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelCharacterStatesOutput = ReadonlyArray<{
  readonly id: string
  readonly characterId: string
  readonly chapterId?: string
  readonly active: number
  readonly location?: string
  readonly mood?: string
  readonly summary?: string
}>

export type ServerNovelAllCharacterStatesInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelAllCharacterStatesOutput = ReadonlyArray<{
  readonly id: string
  readonly characterId: string
  readonly chapterId?: string
  readonly active: number
  readonly location?: string
  readonly mood?: string
  readonly summary?: string
}>

export type ServerNovelCreateCharacterStateInput = {
  readonly novelID: { readonly novelID: string; readonly characterID: string }["novelID"]
  readonly characterID: { readonly novelID: string; readonly characterID: string }["characterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly chapterId?: {
    readonly chapterId?: string
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["chapterId"]
  readonly place?: {
    readonly chapterId?: string
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["place"]
  readonly mood?: {
    readonly chapterId?: string
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["mood"]
  readonly summary?: {
    readonly chapterId?: string
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["summary"]
}

export type ServerNovelCreateCharacterStateOutput = {
  readonly id: string
  readonly characterId: string
  readonly chapterId?: string
  readonly active: number
  readonly location?: string
  readonly mood?: string
  readonly summary?: string
}

export type ServerNovelUpdateCharacterStateInput = {
  readonly novelID: { readonly novelID: string; readonly stateID: string }["novelID"]
  readonly stateID: { readonly novelID: string; readonly stateID: string }["stateID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly active?: {
    readonly active?: number
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["active"]
  readonly place?: {
    readonly active?: number
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["place"]
  readonly mood?: {
    readonly active?: number
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["mood"]
  readonly summary?: {
    readonly active?: number
    readonly place?: string
    readonly mood?: string
    readonly summary?: string
  }["summary"]
}

export type ServerNovelUpdateCharacterStateOutput = {
  readonly id: string
  readonly characterId: string
  readonly chapterId?: string
  readonly active: number
  readonly location?: string
  readonly mood?: string
  readonly summary?: string
}

export type ServerNovelDeleteCharacterStateInput = {
  readonly novelID: { readonly novelID: string; readonly stateID: string }["novelID"]
  readonly stateID: { readonly novelID: string; readonly stateID: string }["stateID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteCharacterStateOutput = { readonly deleted: boolean }

export type ServerNovelStyleGuideInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelStyleGuideOutput = {
  readonly id: string
  readonly novelId: string
  readonly rules: { readonly [x: string]: string }
  readonly tone: string
  readonly pov: string
  readonly tense: string
}

export type ServerNovelUpdateStyleGuideInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly tone?: {
    readonly tone?: string
    readonly pov?: string
    readonly tense?: string
    readonly rules?: { readonly [x: string]: string }
  }["tone"]
  readonly pov?: {
    readonly tone?: string
    readonly pov?: string
    readonly tense?: string
    readonly rules?: { readonly [x: string]: string }
  }["pov"]
  readonly tense?: {
    readonly tone?: string
    readonly pov?: string
    readonly tense?: string
    readonly rules?: { readonly [x: string]: string }
  }["tense"]
  readonly rules?: {
    readonly tone?: string
    readonly pov?: string
    readonly tense?: string
    readonly rules?: { readonly [x: string]: string }
  }["rules"]
}

export type ServerNovelUpdateStyleGuideOutput = {
  readonly id: string
  readonly novelId: string
  readonly rules: { readonly [x: string]: string }
  readonly tone: string
  readonly pov: string
  readonly tense: string
}

export type ServerNovelSoulInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelSoulOutput = {
  readonly id: string
  readonly novelId: string
  readonly content: string
  readonly updatedAt: number
}

export type ServerNovelUpdateSoulInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly content: { readonly content: string }["content"]
}

export type ServerNovelUpdateSoulOutput = {
  readonly id: string
  readonly novelId: string
  readonly content: string
  readonly updatedAt: number
}

export type ServerNovelSearchInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly q: {
    readonly q: string
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["q"]
  readonly location?: {
    readonly q: string
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelSearchOutput = ReadonlyArray<{
  readonly chapterId: string
  readonly title: string
  readonly order: number
  readonly volumeId?: string
  readonly snippet: string
}>

export type ServerNovelTensionInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelTensionOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly chapterNumber: number
  readonly level: number
  readonly createdAt: number
}>

export type ServerNovelBindInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly sessionID: { readonly sessionID: string }["sessionID"]
}

export type ServerNovelBindOutput = {
  readonly id: string
  readonly title: string
  readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  readonly synopsis: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelCreateChapterInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title: { readonly title: string; readonly volumeId?: string; readonly order?: number }["title"]
  readonly volumeId?: { readonly title: string; readonly volumeId?: string; readonly order?: number }["volumeId"]
  readonly order?: { readonly title: string; readonly volumeId?: string; readonly order?: number }["order"]
}

export type ServerNovelCreateChapterOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId?: string
  readonly title: string
  readonly order: number
  readonly status: string
  readonly wordCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelUpdateInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly synopsis?: string
    readonly genre?: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  }["title"]
  readonly synopsis?: {
    readonly title?: string
    readonly synopsis?: string
    readonly genre?: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  }["synopsis"]
  readonly genre?: {
    readonly title?: string
    readonly synopsis?: string
    readonly genre?: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  }["genre"]
}

export type ServerNovelUpdateOutput = {
  readonly id: string
  readonly title: string
  readonly genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
  readonly synopsis: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelDeleteInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteOutput = { readonly deleted: boolean }

export type ServerNovelCreateCharacterInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly name: { readonly name: string; readonly role?: string; readonly description?: string }["name"]
  readonly role?: { readonly name: string; readonly role?: string; readonly description?: string }["role"]
  readonly description?: { readonly name: string; readonly role?: string; readonly description?: string }["description"]
}

export type ServerNovelCreateCharacterOutput = {
  readonly id: string
  readonly novelId: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly status: string
  readonly createdAt: number
}

export type ServerNovelUpdateCharacterInput = {
  readonly novelID: { readonly novelID: string; readonly characterID: string }["novelID"]
  readonly characterID: { readonly novelID: string; readonly characterID: string }["characterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly name?: {
    readonly name?: string
    readonly role?: string
    readonly description?: string
    readonly status?: string
  }["name"]
  readonly role?: {
    readonly name?: string
    readonly role?: string
    readonly description?: string
    readonly status?: string
  }["role"]
  readonly description?: {
    readonly name?: string
    readonly role?: string
    readonly description?: string
    readonly status?: string
  }["description"]
  readonly status?: {
    readonly name?: string
    readonly role?: string
    readonly description?: string
    readonly status?: string
  }["status"]
}

export type ServerNovelUpdateCharacterOutput = {
  readonly id: string
  readonly novelId: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly status: string
  readonly createdAt: number
}

export type ServerNovelDeleteCharacterInput = {
  readonly novelID: { readonly novelID: string; readonly characterID: string }["novelID"]
  readonly characterID: { readonly novelID: string; readonly characterID: string }["characterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteCharacterOutput = { readonly deleted: boolean }

export type ServerNovelCreateTensionInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly chapterNumber: { readonly chapterNumber: number; readonly level: number }["chapterNumber"]
  readonly level: { readonly chapterNumber: number; readonly level: number }["level"]
}

export type ServerNovelCreateTensionOutput = {
  readonly id: string
  readonly novelId: string
  readonly chapterNumber: number
  readonly level: number
  readonly createdAt: number
}

export type ServerNovelUpdateTensionInput = {
  readonly novelID: { readonly novelID: string; readonly pointID: string }["novelID"]
  readonly pointID: { readonly novelID: string; readonly pointID: string }["pointID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly level?: { readonly level?: number | "Infinity" | "-Infinity" | "NaN" }["level"]
}

export type ServerNovelUpdateTensionOutput = {
  readonly id: string
  readonly novelId: string
  readonly chapterNumber: number
  readonly level: number
  readonly createdAt: number
}

export type ServerNovelDeleteTensionInput = {
  readonly novelID: { readonly novelID: string; readonly pointID: string }["novelID"]
  readonly pointID: { readonly novelID: string; readonly pointID: string }["pointID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteTensionOutput = { readonly deleted: boolean }

export type ServerNovelCreatePlotThreadInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title: { readonly title: string; readonly priority?: string; readonly description?: string }["title"]
  readonly priority?: { readonly title: string; readonly priority?: string; readonly description?: string }["priority"]
  readonly description?: {
    readonly title: string
    readonly priority?: string
    readonly description?: string
  }["description"]
}

export type ServerNovelCreatePlotThreadOutput = {
  readonly id: string
  readonly novelId: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly description: string
  readonly createdAt: number
  readonly closedAt?: number
}

export type ServerNovelUpdatePlotThreadInput = {
  readonly novelID: { readonly novelID: string; readonly threadID: string }["novelID"]
  readonly threadID: { readonly novelID: string; readonly threadID: string }["threadID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly status?: string
    readonly priority?: string
    readonly description?: string
  }["title"]
  readonly status?: {
    readonly title?: string
    readonly status?: string
    readonly priority?: string
    readonly description?: string
  }["status"]
  readonly priority?: {
    readonly title?: string
    readonly status?: string
    readonly priority?: string
    readonly description?: string
  }["priority"]
  readonly description?: {
    readonly title?: string
    readonly status?: string
    readonly priority?: string
    readonly description?: string
  }["description"]
}

export type ServerNovelUpdatePlotThreadOutput = {
  readonly id: string
  readonly novelId: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly description: string
  readonly createdAt: number
  readonly closedAt?: number
}

export type ServerNovelDeletePlotThreadInput = {
  readonly novelID: { readonly novelID: string; readonly threadID: string }["novelID"]
  readonly threadID: { readonly novelID: string; readonly threadID: string }["threadID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeletePlotThreadOutput = { readonly deleted: boolean }

export type ServerNovelCreateForeshadowingInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly content: { readonly content: string; readonly plantedChapterId?: string }["content"]
  readonly plantedChapterId?: { readonly content: string; readonly plantedChapterId?: string }["plantedChapterId"]
}

export type ServerNovelCreateForeshadowingOutput = {
  readonly id: string
  readonly novelId: string
  readonly plantedChapterId?: string
  readonly resolvedChapterId?: string
  readonly content: string
  readonly state: string
  readonly createdAt: number
}

export type ServerNovelUpdateForeshadowingInput = {
  readonly novelID: { readonly novelID: string; readonly entryID: string }["novelID"]
  readonly entryID: { readonly novelID: string; readonly entryID: string }["entryID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly content?: {
    readonly content?: string
    readonly state?: string
    readonly resolvedChapterId?: string
  }["content"]
  readonly state?: { readonly content?: string; readonly state?: string; readonly resolvedChapterId?: string }["state"]
  readonly resolvedChapterId?: {
    readonly content?: string
    readonly state?: string
    readonly resolvedChapterId?: string
  }["resolvedChapterId"]
}

export type ServerNovelUpdateForeshadowingOutput = {
  readonly id: string
  readonly novelId: string
  readonly plantedChapterId?: string
  readonly resolvedChapterId?: string
  readonly content: string
  readonly state: string
  readonly createdAt: number
}

export type ServerNovelDeleteForeshadowingInput = {
  readonly novelID: { readonly novelID: string; readonly entryID: string }["novelID"]
  readonly entryID: { readonly novelID: string; readonly entryID: string }["entryID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteForeshadowingOutput = { readonly deleted: boolean }

export type ServerNovelCreateWorldEntryInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly category: { readonly category: string; readonly title: string; readonly content?: string }["category"]
  readonly title: { readonly category: string; readonly title: string; readonly content?: string }["title"]
  readonly content?: { readonly category: string; readonly title: string; readonly content?: string }["content"]
}

export type ServerNovelCreateWorldEntryOutput = {
  readonly id: string
  readonly novelId: string
  readonly category: string
  readonly title: string
  readonly content: string
  readonly createdAt: number
}

export type ServerNovelUpdateWorldEntryInput = {
  readonly novelID: { readonly novelID: string; readonly entryID: string }["novelID"]
  readonly entryID: { readonly novelID: string; readonly entryID: string }["entryID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly category?: { readonly category?: string; readonly title?: string; readonly content?: string }["category"]
  readonly title?: { readonly category?: string; readonly title?: string; readonly content?: string }["title"]
  readonly content?: { readonly category?: string; readonly title?: string; readonly content?: string }["content"]
}

export type ServerNovelUpdateWorldEntryOutput = {
  readonly id: string
  readonly novelId: string
  readonly category: string
  readonly title: string
  readonly content: string
  readonly createdAt: number
}

export type ServerNovelDeleteWorldEntryInput = {
  readonly novelID: { readonly novelID: string; readonly entryID: string }["novelID"]
  readonly entryID: { readonly novelID: string; readonly entryID: string }["entryID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteWorldEntryOutput = { readonly deleted: boolean }

export type ServerNovelStructureInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelStructureOutput = {
  readonly volumes: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly title: string
    readonly summary: string
    readonly order: number
    readonly createdAt: number
  }>
  readonly chapters: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly volumeId?: string
    readonly title: string
    readonly order: number
    readonly status: string
    readonly wordCount: number
    readonly createdAt: number
    readonly updatedAt: number
  }>
  readonly arcs: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary: string
    readonly status: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number | null
    readonly plannedEndChapter?: number | null
    readonly actualStartChapter?: number | null
    readonly actualEndChapter?: number | null
    readonly createdAt: number
    readonly updatedAt: number
  }>
  readonly beats: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly arcId: string
    readonly chapterId?: string | null
    readonly chapterOrder?: number | null
    readonly label: string
    readonly kind: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary: string
    readonly status: "planned" | "drafted" | "reviewed"
    readonly createdAt: number
    readonly updatedAt: number
  }>
  readonly threads: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly title: string
    readonly status: string
    readonly priority: string
    readonly description: string
    readonly createdAt: number
    readonly closedAt?: number
  }>
  readonly foreshadowing: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly plantedChapterId?: string
    readonly resolvedChapterId?: string
    readonly content: string
    readonly state: string
    readonly createdAt: number
  }>
  readonly characters: ReadonlyArray<{
    readonly id: string
    readonly novelId: string
    readonly name: string
    readonly role: string
    readonly description: string
    readonly status: string
    readonly createdAt: number
  }>
}

export type ServerNovelArcsInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelArcsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly arcType: "narrative" | "character" | "subplot"
  readonly title: string
  readonly summary: string
  readonly status: "planned" | "active" | "completed" | "abandoned"
  readonly targetCharacterId?: string
  readonly plannedStartChapter?: number | null
  readonly plannedEndChapter?: number | null
  readonly actualStartChapter?: number | null
  readonly actualEndChapter?: number | null
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerNovelCreateArcInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly arcType: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["arcType"]
  readonly title: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["title"]
  readonly summary?: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["summary"]
  readonly status?: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["status"]
  readonly targetCharacterId?: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["targetCharacterId"]
  readonly plannedStartChapter?: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["plannedStartChapter"]
  readonly plannedEndChapter?: {
    readonly arcType: "narrative" | "character" | "subplot"
    readonly title: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
  }["plannedEndChapter"]
}

export type ServerNovelCreateArcOutput = {
  readonly id: string
  readonly novelId: string
  readonly arcType: "narrative" | "character" | "subplot"
  readonly title: string
  readonly summary: string
  readonly status: "planned" | "active" | "completed" | "abandoned"
  readonly targetCharacterId?: string
  readonly plannedStartChapter?: number | null
  readonly plannedEndChapter?: number | null
  readonly actualStartChapter?: number | null
  readonly actualEndChapter?: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelUpdateArcInput = {
  readonly novelID: { readonly novelID: string; readonly arcID: string }["novelID"]
  readonly arcID: { readonly novelID: string; readonly arcID: string }["arcID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["title"]
  readonly summary?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["summary"]
  readonly status?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["status"]
  readonly arcType?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["arcType"]
  readonly targetCharacterId?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["targetCharacterId"]
  readonly plannedStartChapter?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["plannedStartChapter"]
  readonly plannedEndChapter?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["plannedEndChapter"]
  readonly actualStartChapter?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["actualStartChapter"]
  readonly actualEndChapter?: {
    readonly title?: string
    readonly summary?: string
    readonly status?: "planned" | "active" | "completed" | "abandoned"
    readonly arcType?: "narrative" | "character" | "subplot"
    readonly targetCharacterId?: string
    readonly plannedStartChapter?: number
    readonly plannedEndChapter?: number
    readonly actualStartChapter?: number
    readonly actualEndChapter?: number
  }["actualEndChapter"]
}

export type ServerNovelUpdateArcOutput = {
  readonly id: string
  readonly novelId: string
  readonly arcType: "narrative" | "character" | "subplot"
  readonly title: string
  readonly summary: string
  readonly status: "planned" | "active" | "completed" | "abandoned"
  readonly targetCharacterId?: string
  readonly plannedStartChapter?: number | null
  readonly plannedEndChapter?: number | null
  readonly actualStartChapter?: number | null
  readonly actualEndChapter?: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelDeleteArcInput = {
  readonly novelID: { readonly novelID: string; readonly arcID: string }["novelID"]
  readonly arcID: { readonly novelID: string; readonly arcID: string }["arcID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteArcOutput = { readonly deleted: boolean }

export type ServerNovelArcBeatsInput = {
  readonly novelID: { readonly novelID: string; readonly arcID: string }["novelID"]
  readonly arcID: { readonly novelID: string; readonly arcID: string }["arcID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelArcBeatsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly arcId: string
  readonly chapterId?: string | null
  readonly chapterOrder?: number | null
  readonly label: string
  readonly kind: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
  readonly summary: string
  readonly status: "planned" | "drafted" | "reviewed"
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerNovelCreateBeatInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly arcId: {
    readonly arcId: string
    readonly chapterId?: string
    readonly chapterOrder?: number
    readonly label: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
  }["arcId"]
  readonly chapterId?: {
    readonly arcId: string
    readonly chapterId?: string
    readonly chapterOrder?: number
    readonly label: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
  }["chapterId"]
  readonly chapterOrder?: {
    readonly arcId: string
    readonly chapterId?: string
    readonly chapterOrder?: number
    readonly label: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
  }["chapterOrder"]
  readonly label: {
    readonly arcId: string
    readonly chapterId?: string
    readonly chapterOrder?: number
    readonly label: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
  }["label"]
  readonly kind?: {
    readonly arcId: string
    readonly chapterId?: string
    readonly chapterOrder?: number
    readonly label: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
  }["kind"]
  readonly summary?: {
    readonly arcId: string
    readonly chapterId?: string
    readonly chapterOrder?: number
    readonly label: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
  }["summary"]
}

export type ServerNovelCreateBeatOutput = {
  readonly id: string
  readonly novelId: string
  readonly arcId: string
  readonly chapterId?: string | null
  readonly chapterOrder?: number | null
  readonly label: string
  readonly kind: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
  readonly summary: string
  readonly status: "planned" | "drafted" | "reviewed"
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelUpdateBeatInput = {
  readonly novelID: { readonly novelID: string; readonly beatID: string }["novelID"]
  readonly beatID: { readonly novelID: string; readonly beatID: string }["beatID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly label?: {
    readonly label?: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
    readonly status?: "planned" | "drafted" | "reviewed"
    readonly chapterId?: string
    readonly chapterOrder?: number
  }["label"]
  readonly kind?: {
    readonly label?: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
    readonly status?: "planned" | "drafted" | "reviewed"
    readonly chapterId?: string
    readonly chapterOrder?: number
  }["kind"]
  readonly summary?: {
    readonly label?: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
    readonly status?: "planned" | "drafted" | "reviewed"
    readonly chapterId?: string
    readonly chapterOrder?: number
  }["summary"]
  readonly status?: {
    readonly label?: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
    readonly status?: "planned" | "drafted" | "reviewed"
    readonly chapterId?: string
    readonly chapterOrder?: number
  }["status"]
  readonly chapterId?: {
    readonly label?: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
    readonly status?: "planned" | "drafted" | "reviewed"
    readonly chapterId?: string
    readonly chapterOrder?: number
  }["chapterId"]
  readonly chapterOrder?: {
    readonly label?: string
    readonly kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
    readonly summary?: string
    readonly status?: "planned" | "drafted" | "reviewed"
    readonly chapterId?: string
    readonly chapterOrder?: number
  }["chapterOrder"]
}

export type ServerNovelUpdateBeatOutput = {
  readonly id: string
  readonly novelId: string
  readonly arcId: string
  readonly chapterId?: string | null
  readonly chapterOrder?: number | null
  readonly label: string
  readonly kind: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"
  readonly summary: string
  readonly status: "planned" | "drafted" | "reviewed"
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelDeleteBeatInput = {
  readonly novelID: { readonly novelID: string; readonly beatID: string }["novelID"]
  readonly beatID: { readonly novelID: string; readonly beatID: string }["beatID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteBeatOutput = { readonly deleted: boolean }

export type ServerNovelVolumeReviewsInput = {
  readonly novelID: { readonly novelID: string; readonly volumeID: string }["novelID"]
  readonly volumeID: { readonly novelID: string; readonly volumeID: string }["volumeID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelVolumeReviewsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly volumeId: string
  readonly round: number
  readonly overall: string
  readonly score?: number | "Infinity" | "-Infinity" | "NaN" | null
  readonly strengths: ReadonlyArray<string>
  readonly weaknesses: ReadonlyArray<string>
  readonly structure: JsonValue
  readonly characterArcs: ReadonlyArray<JsonValue>
  readonly openThreads: ReadonlyArray<string>
  readonly recommendations: ReadonlyArray<string>
  readonly createdAt: number
}>

export type ServerNovelCreateVolumeReviewInput = {
  readonly novelID: { readonly novelID: string; readonly volumeID: string }["novelID"]
  readonly volumeID: { readonly novelID: string; readonly volumeID: string }["volumeID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly overall: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["overall"]
  readonly score?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["score"]
  readonly strengths?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["strengths"]
  readonly weaknesses?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["weaknesses"]
  readonly structure?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["structure"]
  readonly characterArcs?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["characterArcs"]
  readonly openThreads?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["openThreads"]
  readonly recommendations?: {
    readonly overall: string
    readonly score?: number | "Infinity" | "-Infinity" | "NaN"
    readonly strengths?: ReadonlyArray<string>
    readonly weaknesses?: ReadonlyArray<string>
    readonly structure?: JsonValue
    readonly characterArcs?: ReadonlyArray<JsonValue>
    readonly openThreads?: ReadonlyArray<string>
    readonly recommendations?: ReadonlyArray<string>
  }["recommendations"]
}

export type ServerNovelCreateVolumeReviewOutput = {
  readonly id: string
  readonly novelId: string
  readonly volumeId: string
  readonly round: number
  readonly overall: string
  readonly score?: number | "Infinity" | "-Infinity" | "NaN" | null
  readonly strengths: ReadonlyArray<string>
  readonly weaknesses: ReadonlyArray<string>
  readonly structure: JsonValue
  readonly characterArcs: ReadonlyArray<JsonValue>
  readonly openThreads: ReadonlyArray<string>
  readonly recommendations: ReadonlyArray<string>
  readonly createdAt: number
}

export type ServerNovelEditorialReportsInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelEditorialReportsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly scopeType: string
  readonly scopeId?: string | null
  readonly summary: string
  readonly risks: ReadonlyArray<JsonValue>
  readonly recommendations: ReadonlyArray<string>
  readonly createdAt: number
}>

export type ServerNovelCreateEditorialReportInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly scopeType?: {
    readonly scopeType?: string
    readonly scopeId?: string
    readonly summary?: string
    readonly risks?: ReadonlyArray<JsonValue>
    readonly recommendations?: ReadonlyArray<string>
  }["scopeType"]
  readonly scopeId?: {
    readonly scopeType?: string
    readonly scopeId?: string
    readonly summary?: string
    readonly risks?: ReadonlyArray<JsonValue>
    readonly recommendations?: ReadonlyArray<string>
  }["scopeId"]
  readonly summary?: {
    readonly scopeType?: string
    readonly scopeId?: string
    readonly summary?: string
    readonly risks?: ReadonlyArray<JsonValue>
    readonly recommendations?: ReadonlyArray<string>
  }["summary"]
  readonly risks?: {
    readonly scopeType?: string
    readonly scopeId?: string
    readonly summary?: string
    readonly risks?: ReadonlyArray<JsonValue>
    readonly recommendations?: ReadonlyArray<string>
  }["risks"]
  readonly recommendations?: {
    readonly scopeType?: string
    readonly scopeId?: string
    readonly summary?: string
    readonly risks?: ReadonlyArray<JsonValue>
    readonly recommendations?: ReadonlyArray<string>
  }["recommendations"]
}

export type ServerNovelCreateEditorialReportOutput = {
  readonly id: string
  readonly novelId: string
  readonly scopeType: string
  readonly scopeId?: string | null
  readonly summary: string
  readonly risks: ReadonlyArray<JsonValue>
  readonly recommendations: ReadonlyArray<string>
  readonly createdAt: number
}

export type ServerNovelAnnotationsInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelAnnotationsOutput = ReadonlyArray<{
  readonly id: string
  readonly novelId: string
  readonly chapterId: string
  readonly parentId?: string | null
  readonly source: "user" | "ai"
  readonly anchorType: "paragraph" | "range" | "chapter"
  readonly paragraphIndex?: number | null
  readonly startOffset?: number | null
  readonly endOffset?: number | null
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null
  readonly status: "open" | "resolved" | "wontfix" | "applied"
  readonly authorSessionId?: string | null
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerNovelCreateAnnotationInput = {
  readonly novelID: { readonly novelID: string; readonly chapterID: string }["novelID"]
  readonly chapterID: { readonly novelID: string; readonly chapterID: string }["chapterID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly source?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["source"]
  readonly anchorType?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["anchorType"]
  readonly paragraphIndex?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["paragraphIndex"]
  readonly startOffset?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["startOffset"]
  readonly endOffset?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["endOffset"]
  readonly quote?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["quote"]
  readonly comment: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["comment"]
  readonly suggestedReplacement?: {
    readonly source?: "user" | "ai"
    readonly anchorType?: "paragraph" | "range" | "chapter"
    readonly paragraphIndex?: number
    readonly startOffset?: number
    readonly endOffset?: number
    readonly quote?: string
    readonly comment: string
    readonly suggestedReplacement?: string
  }["suggestedReplacement"]
}

export type ServerNovelCreateAnnotationOutput = {
  readonly id: string
  readonly novelId: string
  readonly chapterId: string
  readonly parentId?: string | null
  readonly source: "user" | "ai"
  readonly anchorType: "paragraph" | "range" | "chapter"
  readonly paragraphIndex?: number | null
  readonly startOffset?: number | null
  readonly endOffset?: number | null
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null
  readonly status: "open" | "resolved" | "wontfix" | "applied"
  readonly authorSessionId?: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelUpdateAnnotationInput = {
  readonly novelID: { readonly novelID: string; readonly annotationID: string }["novelID"]
  readonly annotationID: { readonly novelID: string; readonly annotationID: string }["annotationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly comment?: {
    readonly comment?: string
    readonly status?: "open" | "resolved" | "wontfix" | "applied"
    readonly suggestedReplacement?: string
    readonly quote?: string
  }["comment"]
  readonly status?: {
    readonly comment?: string
    readonly status?: "open" | "resolved" | "wontfix" | "applied"
    readonly suggestedReplacement?: string
    readonly quote?: string
  }["status"]
  readonly suggestedReplacement?: {
    readonly comment?: string
    readonly status?: "open" | "resolved" | "wontfix" | "applied"
    readonly suggestedReplacement?: string
    readonly quote?: string
  }["suggestedReplacement"]
  readonly quote?: {
    readonly comment?: string
    readonly status?: "open" | "resolved" | "wontfix" | "applied"
    readonly suggestedReplacement?: string
    readonly quote?: string
  }["quote"]
}

export type ServerNovelUpdateAnnotationOutput = {
  readonly id: string
  readonly novelId: string
  readonly chapterId: string
  readonly parentId?: string | null
  readonly source: "user" | "ai"
  readonly anchorType: "paragraph" | "range" | "chapter"
  readonly paragraphIndex?: number | null
  readonly startOffset?: number | null
  readonly endOffset?: number | null
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null
  readonly status: "open" | "resolved" | "wontfix" | "applied"
  readonly authorSessionId?: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerNovelDeleteAnnotationInput = {
  readonly novelID: { readonly novelID: string; readonly annotationID: string }["novelID"]
  readonly annotationID: { readonly novelID: string; readonly annotationID: string }["annotationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelDeleteAnnotationOutput = { readonly deleted: boolean }

export type ServerNovelCanvasLayoutInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerNovelCanvasLayoutOutput = {
  readonly columns: ReadonlyArray<{
    readonly id: string
    readonly x: number | "Infinity" | "-Infinity" | "NaN"
    readonly width: number | "Infinity" | "-Infinity" | "NaN"
  }>
  readonly cards: ReadonlyArray<{
    readonly id: string
    readonly x: number | "Infinity" | "-Infinity" | "NaN"
    readonly y: number | "Infinity" | "-Infinity" | "NaN"
    readonly columnId?: string | null
  }>
  readonly viewport?: {
    readonly x: number | "Infinity" | "-Infinity" | "NaN"
    readonly y: number | "Infinity" | "-Infinity" | "NaN"
    readonly zoom: number | "Infinity" | "-Infinity" | "NaN"
  }
} | null

export type ServerNovelUpsertCanvasLayoutInput = {
  readonly novelID: { readonly novelID: string }["novelID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly layout: {
    readonly layout: {
      readonly columns: ReadonlyArray<{
        readonly id: string
        readonly x: number | "Infinity" | "-Infinity" | "NaN"
        readonly width: number | "Infinity" | "-Infinity" | "NaN"
      }>
      readonly cards: ReadonlyArray<{
        readonly id: string
        readonly x: number | "Infinity" | "-Infinity" | "NaN"
        readonly y: number | "Infinity" | "-Infinity" | "NaN"
        readonly columnId?: string | null
      }>
      readonly viewport?: {
        readonly x: number | "Infinity" | "-Infinity" | "NaN"
        readonly y: number | "Infinity" | "-Infinity" | "NaN"
        readonly zoom: number | "Infinity" | "-Infinity" | "NaN"
      }
    }
  }["layout"]
}

export type ServerNovelUpsertCanvasLayoutOutput = {
  readonly columns: ReadonlyArray<{
    readonly id: string
    readonly x: number | "Infinity" | "-Infinity" | "NaN"
    readonly width: number | "Infinity" | "-Infinity" | "NaN"
  }>
  readonly cards: ReadonlyArray<{
    readonly id: string
    readonly x: number | "Infinity" | "-Infinity" | "NaN"
    readonly y: number | "Infinity" | "-Infinity" | "NaN"
    readonly columnId?: string | null
  }>
  readonly viewport?: {
    readonly x: number | "Infinity" | "-Infinity" | "NaN"
    readonly y: number | "Infinity" | "-Infinity" | "NaN"
    readonly zoom: number | "Infinity" | "-Infinity" | "NaN"
  }
}

export type NovelModesGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type NovelModesGetOutput = {
  readonly writing_mode: "auto" | "review"
  readonly setup_mode: "interactive" | "auto"
}

export type NovelModesSetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly writing_mode?: {
    readonly writing_mode?: ("auto" | "review") | undefined
    readonly setup_mode?: ("interactive" | "auto") | undefined
  }["writing_mode"]
  readonly setup_mode?: {
    readonly writing_mode?: ("auto" | "review") | undefined
    readonly setup_mode?: ("interactive" | "auto") | undefined
  }["setup_mode"]
}

export type NovelModesSetOutput = {
  readonly writing_mode: "auto" | "review"
  readonly setup_mode: "interactive" | "auto"
}

export type ServerSyncStatusOutput = {
  readonly connection?: { readonly url: string; readonly username: string; readonly remoteRoot: string }
  readonly rootDir?: string
  readonly projects: ReadonlyArray<{
    readonly name: string
    readonly state:
      | "in_sync"
      | "local_ahead"
      | "remote_ahead"
      | "new_local"
      | "new_remote"
      | "conflict"
      | "pending_delete"
    readonly lastSyncedAt?: number | "Infinity" | "-Infinity" | "NaN"
    readonly novels?: ReadonlyArray<string>
  }>
}

export type ServerSyncTestInput = {
  readonly url: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["url"]
  readonly username: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["username"]
  readonly password: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["password"]
  readonly remoteRoot?: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["remoteRoot"]
}

export type ServerSyncTestOutput = { readonly ok: boolean; readonly error?: string }

export type ServerSyncSaveInput = {
  readonly url: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["url"]
  readonly username: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["username"]
  readonly password: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["password"]
  readonly remoteRoot?: {
    readonly url: string
    readonly username: string
    readonly password: string
    readonly remoteRoot?: string
  }["remoteRoot"]
}

export type ServerSyncSaveOutput = {
  readonly connection?: { readonly url: string; readonly username: string; readonly remoteRoot: string }
  readonly rootDir?: string
  readonly projects: ReadonlyArray<{
    readonly name: string
    readonly state:
      | "in_sync"
      | "local_ahead"
      | "remote_ahead"
      | "new_local"
      | "new_remote"
      | "conflict"
      | "pending_delete"
    readonly lastSyncedAt?: number | "Infinity" | "-Infinity" | "NaN"
    readonly novels?: ReadonlyArray<string>
  }>
}

export type ServerSyncRemoveOutput = {
  readonly connection?: { readonly url: string; readonly username: string; readonly remoteRoot: string }
  readonly rootDir?: string
  readonly projects: ReadonlyArray<{
    readonly name: string
    readonly state:
      | "in_sync"
      | "local_ahead"
      | "remote_ahead"
      | "new_local"
      | "new_remote"
      | "conflict"
      | "pending_delete"
    readonly lastSyncedAt?: number | "Infinity" | "-Infinity" | "NaN"
    readonly novels?: ReadonlyArray<string>
  }>
}

export type ServerSyncSetInput = { readonly rootDir: { readonly rootDir: string }["rootDir"] }

export type ServerSyncSetOutput = {
  readonly connection?: { readonly url: string; readonly username: string; readonly remoteRoot: string }
  readonly rootDir?: string
  readonly projects: ReadonlyArray<{
    readonly name: string
    readonly state:
      | "in_sync"
      | "local_ahead"
      | "remote_ahead"
      | "new_local"
      | "new_remote"
      | "conflict"
      | "pending_delete"
    readonly lastSyncedAt?: number | "Infinity" | "-Infinity" | "NaN"
    readonly novels?: ReadonlyArray<string>
  }>
}

export type ServerSyncRunOutput = {
  readonly results: ReadonlyArray<{
    readonly name: string
    readonly action: "uploaded" | "downloaded" | "deleted_remote"
  }>
  readonly decisions: ReadonlyArray<
    | {
        readonly kind: "pair_conflict"
        readonly name: string
        readonly remote: { readonly device: string; readonly at: number; readonly novels: ReadonlyArray<string> }
      }
    | {
        readonly kind: "tie_conflict"
        readonly name: string
        readonly localTime: number | null
        readonly remoteTime: number | null
      }
    | { readonly kind: "delete_confirm"; readonly names: ReadonlyArray<string> }
  >
}

export type ServerSyncResolveInput = {
  readonly name?: {
    readonly name?: string
    readonly action: "keep_local" | "keep_remote" | "keep_both" | "confirm_delete" | "skip"
    readonly names?: ReadonlyArray<string>
  }["name"]
  readonly action: {
    readonly name?: string
    readonly action: "keep_local" | "keep_remote" | "keep_both" | "confirm_delete" | "skip"
    readonly names?: ReadonlyArray<string>
  }["action"]
  readonly names?: {
    readonly name?: string
    readonly action: "keep_local" | "keep_remote" | "keep_both" | "confirm_delete" | "skip"
    readonly names?: ReadonlyArray<string>
  }["names"]
}

export type ServerSyncResolveOutput = {
  readonly connection?: { readonly url: string; readonly username: string; readonly remoteRoot: string }
  readonly rootDir?: string
  readonly projects: ReadonlyArray<{
    readonly name: string
    readonly state:
      | "in_sync"
      | "local_ahead"
      | "remote_ahead"
      | "new_local"
      | "new_remote"
      | "conflict"
      | "pending_delete"
    readonly lastSyncedAt?: number | "Infinity" | "-Infinity" | "NaN"
    readonly novels?: ReadonlyArray<string>
  }>
}

export type ServerSoulGlobalOutput = { readonly content: string }

export type ServerSoulUpdateGlobalInput = { readonly content: { readonly content: string }["content"] }

export type ServerSoulUpdateGlobalOutput = { readonly content: string }
