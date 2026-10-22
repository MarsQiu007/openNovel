import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Effect } from "effect"
import { embeddedClient, listAllMessages, listAllSessions } from "../embedded-client"
import { Filesystem } from "@/util/filesystem"
import type {
  LlmToolContent,
  PromptFileAttachment,
  SessionMessage,
  SessionMessageAssistantTool,
  SessionV2Info,
} from "@opennovel-ai/sdk/v2"

type ToolState = SessionMessageAssistantTool["state"]

function redact(kind: string, id: string, value: string) {
  return value.trim() ? `[redacted:${kind}:${id}]` : value
}

function data(kind: string, id: string, value: Record<string, unknown> | undefined) {
  if (!value) return value
  return Object.keys(value).length ? { redacted: `${kind}:${id}` } : value
}

function attachment(id: string, file: PromptFileAttachment): PromptFileAttachment {
  return {
    ...file,
    uri: redact("file-url", id, file.uri),
    name: file.name === undefined ? undefined : redact("file-name", id, file.name),
    description: file.description === undefined ? undefined : redact("file-description", id, file.description),
    source: !file.source ? file.source : { ...file.source, text: redact("file-text", id, file.source.text) },
  }
}

function toolContent(id: string, content: LlmToolContent[]): LlmToolContent[] {
  return content.map((item, index) => {
    if (item.type === "text") return { ...item, text: redact("tool-text", `${id}-${index}`, item.text) }
    return {
      ...item,
      uri: redact("tool-file", `${id}-${index}`, item.uri),
      name: item.name === undefined ? undefined : redact("tool-file-name", `${id}-${index}`, item.name),
    }
  })
}

function toolState(id: string, state: ToolState): ToolState {
  switch (state.status) {
    case "pending":
      return { ...state, input: redact("tool-input", id, state.input) }
    case "running":
      return {
        ...state,
        input: data("tool-input", id, state.input) ?? state.input,
        structured: data("tool-structured", id, state.structured) ?? state.structured,
        content: toolContent(id, state.content),
      }
    case "completed":
      return {
        ...state,
        input: data("tool-input", id, state.input) ?? state.input,
        structured: data("tool-structured", id, state.structured) ?? state.structured,
        content: toolContent(id, state.content),
        outputPaths: state.outputPaths?.map((item, index) => redact("tool-path", `${id}-${index}`, item)),
        result: state.result === undefined ? undefined : { redacted: `tool-result:${id}` },
        attachments: state.attachments?.map((file) => attachment(id, file)),
      }
    case "error":
      return {
        ...state,
        input: data("tool-input", id, state.input) ?? state.input,
        structured: data("tool-structured", id, state.structured) ?? state.structured,
        content: toolContent(id, state.content),
        error: { ...state.error, message: redact("tool-error", id, state.error.message) },
        result: state.result === undefined ? undefined : { redacted: `tool-result:${id}` },
      }
  }
}

function message(msg: SessionMessage): SessionMessage {
  switch (msg.type) {
    case "user":
      return {
        ...msg,
        text: redact("text", msg.id, msg.text),
        files: msg.files?.map((file) => attachment(msg.id, file)),
        agents: msg.agents?.map((agent) => ({
          ...agent,
          source: !agent.source
            ? agent.source
            : { ...agent.source, text: redact("agent-text", msg.id, agent.source.text) },
        })),
      }
    case "synthetic":
    case "system":
      return { ...msg, text: redact("text", msg.id, msg.text) }
    case "shell":
      return {
        ...msg,
        command: redact("shell-command", msg.id, msg.command),
        output: redact("shell-output", msg.id, msg.output),
      }
    case "assistant":
      return {
        ...msg,
        snapshot: !msg.snapshot
          ? msg.snapshot
          : {
              ...msg.snapshot,
              start: msg.snapshot.start === undefined ? undefined : redact("snapshot", msg.id, msg.snapshot.start),
              end: msg.snapshot.end === undefined ? undefined : redact("snapshot", msg.id, msg.snapshot.end),
              files: msg.snapshot.files?.map((item, index) => redact("snapshot-file", `${msg.id}-${index}`, item)),
            },
        content: msg.content.map((part) => {
          if (part.type === "text") return { ...part, text: redact("text", part.id, part.text) }
          if (part.type === "reasoning") {
            // providerMetadata 含加密推理签名，sanitize 直接摘除（其值类型不允许占位符字符串）
            return { ...part, text: redact("reasoning", part.id, part.text), providerMetadata: undefined }
          }
          return { ...part, state: toolState(part.id, part.state) }
        }),
      }
    case "compaction":
      return {
        ...msg,
        summary: redact("compaction-summary", msg.id, msg.summary),
        recent: redact("compaction-recent", msg.id, msg.recent),
      }
    default:
      return msg
  }
}

function sanitize(input: { info: SessionV2Info; messages: SessionMessage[] }) {
  return {
    info: {
      ...input.info,
      title: redact("session-title", input.info.id, input.info.title),
      location: {
        ...input.info.location,
        directory: redact("session-directory", input.info.id, input.info.location.directory),
      },
      revert: !input.info.revert
        ? input.info.revert
        : {
            ...input.info.revert,
            snapshot:
              input.info.revert.snapshot === undefined
                ? undefined
                : redact("revert-snapshot", input.info.id, input.info.revert.snapshot),
            diff:
              input.info.revert.diff === undefined
                ? undefined
                : redact("revert-diff", input.info.id, input.info.revert.diff),
          },
    },
    messages: input.messages.map(message),
  }
}

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("sanitize", {
        describe: "redact sensitive transcript and file data",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: { sessionID?: string; sanitize?: boolean }) {
  const client = yield* Effect.promise(() => embeddedClient(Filesystem.resolve(process.cwd())))
  let sessionID = args.sessionID
  process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

  if (!sessionID) {
    UI.empty()
    prompts.intro("Export session", { output: process.stderr })

    const sessions = yield* Effect.promise(() => listAllSessions(client))

    if (sessions.length === 0) {
      prompts.log.error("No sessions found", { output: process.stderr })
      prompts.outro("Done", { output: process.stderr })
      return
    }

    sessions.sort((a, b) => b.time.updated - a.time.updated)

    const selectedSession = yield* Effect.promise(() =>
      prompts.autocomplete({
        message: "Select session to export",
        maxItems: 10,
        options: sessions.map((session) => ({
          label: session.title,
          value: session.id,
          hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
        })),
        output: process.stderr,
      }),
    )

    if (prompts.isCancel(selectedSession)) {
      return yield* Effect.die(new UI.CancelledError())
    }

    sessionID = selectedSession

    prompts.outro("Exporting session...", { output: process.stderr })
  }

  const id = sessionID
  const sessionInfo = yield* Effect.promise(() =>
    client.v2.session
      .get({ sessionID: id })
      .then((x) => x.data?.data)
      .catch(() => undefined),
  )
  if (!sessionInfo) return yield* fail(`Session not found: ${id}`)
  const messages = yield* Effect.promise(() => listAllMessages(client, id))

  const exportData = { info: sessionInfo, messages }

  process.stdout.write(JSON.stringify(args.sanitize ? sanitize(exportData) : exportData, null, 2))
  process.stdout.write(EOL)
})
