import { FSUtil } from "@opennovel-ai/core/fs-util"
// CLI 入口点，处理 `opennovel run`。
//
// 支持两种模式：
//   1. 非交互式（默认）：V2 create → prompt → wait → 读尾消息，
//      事件流输出到 stdout，drain 落定后退出。
//   2. 附加（`--attach`）：连接到正在运行的 opennovel 服务器执行同一链路。
//
// 还支持 `--command` 执行斜杠命令、`--format json` 原始事件流、
// `--continue` / `--session` 恢复会话。
import type { Argv } from "yargs"
import path from "path"
import { pathToFileURL } from "url"
import { open } from "node:fs/promises"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import {
  createOpenNovelClient,
  type ModelRef,
  type OpenNovelClient,
  type PromptInputFileAttachment,
  type SessionMessage,
  type SessionV2Info,
} from "@opennovel-ai/sdk/v2"
import { FormatError, FormatUnknownError } from "../error"

function pick(value: string | undefined, variant: string | undefined): ModelRef | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return {
    providerID,
    id: rest.join("/"),
    ...(variant === undefined ? {} : { variant }),
  }
}

function resolveRunInput(value?: string, piped?: string): string | undefined {
  if (!value) {
    return piped
  }

  if (!piped) {
    return value
  }

  return value + "\n" + piped
}

const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024

type Inline = {
  icon: string
  title: string
  description?: string
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

function printText(text: string) {
  const value = text.trim()
  if (!value) return
  if (!process.stdout.isTTY) {
    process.stdout.write(value + EOL)
    return
  }
  UI.empty()
  UI.println(value)
  UI.empty()
}

function printReasoning(text: string) {
  const value = text.trim()
  if (!value) return
  const line = `Thinking: ${value}`
  if (!process.stdout.isTTY) {
    process.stdout.write(line + EOL)
    return
  }
  UI.empty()
  UI.println(`${UI.Style.TEXT_DIM}\x1b[3m${line}\x1b[0m${UI.Style.TEXT_NORMAL}`)
  UI.empty()
}

export const RunCommand = effectCmd({
  command: "run [message..]",
  describe: "使用消息运行 opennovel",
  // --attach connects to a remote server (no local instance needed); the
  // default path runs an in-process server and needs the project instance.
  instance: (args) => !args.attach,
  // For --dir without --attach, load instance for the resolved target dir.
  // The handler also chdirs (preserving the legacy order: chdir → file resolution).
  directory: (args) => (args.dir && !args.attach ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "连接到正在运行的 opennovel 服务器 (例如 http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "基本认证密码 (默认使用 OPENNOVEL_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "基本认证用户名 (默认使用 OPENNOVEL_SERVER_USERNAME 或 'opennovel')",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("replay", {
        type: "boolean",
        default: true,
        hidden: true,
        describe: "replay interactive session history on resume and after resize (use --no-replay to disable)",
      })
      .option("replay-limit", {
        type: "number",
        hidden: true,
        describe: "cap visible interactive replay to the newest N messages",
      })
      .option("interactive", {
        alias: ["i"],
        type: "boolean",
        describe: "run in direct interactive split-footer mode",
        default: false,
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("demo", {
        type: "boolean",
        default: false,
        hidden: true,
        describe: "enable direct interactive demo slash commands; pass one as the message to run it immediately",
      }),
  handler: Effect.fn("Cli.run")(function* (args) {
    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    yield* Effect.promise(async () => {
      // interactive/tui 模式已停用
      const auto = args.auto || args.yolo || args["dangerously-skip-permissions"]
      const thinking = args.thinking ?? false
      const die = (message: string): never => {
        UI.error(message)
        process.exit(1)
      }

      let message = [...args.message, ...(args["--"] || [])]
        .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
        .join(" ")

      if (args.demo) {
        die("--demo 已停用（TUI 模式已移除）")
      }
      if (args.fork) {
        die("--fork 已停用（V2 无会话派生端点）")
      }
      if (args.share) {
        die("--share 已停用（V2 无会话分享端点）")
      }

      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const directory = (() => {
        if (!args.dir) return args.attach ? undefined : root
        if (args.attach) return args.dir

        try {
          process.chdir(path.isAbsolute(args.dir) ? args.dir : path.join(root, args.dir))
          return process.cwd()
        } catch {
          UI.error("Failed to change directory to " + args.dir)
          process.exit(1)
        }
      })()
      const attachHeaders = args.attach
        ? ServerAuth.headers({ password: args.password, username: args.username })
        : undefined
      const attachSDK = (dir?: string) => {
        return createOpenNovelClient({
          baseUrl: args.attach!,
          directory: dir,
          headers: attachHeaders,
        })
      }

      const files: PromptInputFileAttachment[] = []
      if (args.file) {
        const list = Array.isArray(args.file) ? args.file : [args.file]

        for (const filePath of list) {
          const resolvedPath = path.resolve(args.attach ? root : (directory ?? root), filePath)
          if (!(await Filesystem.exists(resolvedPath))) {
            UI.error(`File not found: ${filePath}`)
            process.exit(1)
          }

          const stat = Filesystem.stat(resolvedPath)
          const isDirectory = stat?.isDirectory() ?? false
          if (args.attach && isDirectory) {
            UI.error(`Cannot attach local directory without a shared filesystem: ${filePath}`)
            process.exit(1)
          }

          const content = await (async () => {
            if (!args.attach) return
            const handle = await open(resolvedPath, "r")
            try {
              const opened = await handle.stat()
              if (!opened.isFile() || Number(opened.size) > ATTACH_FILE_MAX_BYTES) {
                UI.error(`Cannot attach local file larger than 10 MiB or a special file: ${filePath}`)
                process.exit(1)
              }
              if (opened.size === 0) return Buffer.alloc(0)
              const buffer = Buffer.alloc(Number(opened.size))
              let offset = 0
              while (offset < buffer.length) {
                const read = await handle.read(buffer, offset, buffer.length - offset, offset)
                if (read.bytesRead === 0) break
                offset += read.bytesRead
              }
              return buffer.subarray(0, offset)
            } finally {
              await handle.close()
            }
          })()
          const detected = FSUtil.mimeType(resolvedPath)
          const text = content?.toString("utf8")
          const mime = !args.attach
            ? isDirectory
              ? "application/x-directory"
              : "text/plain"
            : content && text !== undefined && Buffer.from(text, "utf8").equals(content)
              ? "text/plain"
              : detected

          files.push({
            uri: content ? `data:${mime};base64,${content.toString("base64")}` : pathToFileURL(resolvedPath).href,
            name: path.basename(resolvedPath),
          })
        }
      }

      const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
      message = resolveRunInput(message, piped) ?? ""

      if (message.trim().length === 0 && !args.command) {
        UI.error("You must provide a message or a command")
        process.exit(1)
      }

      function title() {
        if (args.title === undefined) return
        if (args.title !== "") return args.title
        return message.slice(0, 50) + (message.length > 50 ? "..." : "")
      }

      async function current(sdk: OpenNovelClient): Promise<string> {
        if (!args.attach) {
          return directory ?? root
        }

        const next = await sdk.path
          .get()
          .then((x) => x.data?.directory)
          .catch(() => undefined)
        if (next) {
          return next
        }

        UI.error("Failed to resolve remote directory")
        process.exit(1)
      }

      // V2 会话的 agent 解析走 core AgentV2 注册表，本地与附加模式统一经 SDK 列表校验
      async function pickAgent(client: OpenNovelClient) {
        if (!args.agent) return undefined
        const name = args.agent

        const agents = await client.v2.agent
          .list()
          .then((x) => x.data?.data ?? [])
          .catch(() => undefined)

        if (!agents) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `failed to list agents. Falling back to default agent`,
          )
          return undefined
        }

        const entry = agents.find((item) => item.id === name)
        if (!entry) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (entry.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return name
      }

      async function resolveSession(
        client: OpenNovelClient,
        cwd: string,
        agent: string | undefined,
        model: ModelRef | undefined,
      ): Promise<SessionV2Info | undefined> {
        if (args.session) {
          const found = await client.v2.session
            .get({ sessionID: args.session })
            .then((x) => x.data?.data)
            .catch(() => undefined)
          if (!found) {
            UI.error("Session not found")
            process.exit(1)
          }
          return found
        }

        if (args.continue) {
          const base = await client.v2.session
            .list({ limit: 50 })
            .then((x) => x.data?.data.find((item) => !item.parentID))
            .catch(() => undefined)
          if (base) return base
        }

        const created = await client.v2.session
          .create({
            location: { directory: cwd },
            ...(agent === undefined ? {} : { agent }),
            ...(model === undefined ? {} : { model }),
          })
          .then((x) => x.data?.data)
          .catch(() => undefined)
        if (!created) return undefined

        const name = title()
        if (name !== undefined) {
          await client.v2.session.update({ sessionID: created.id, title: name }).catch(() => undefined)
        }
        return created
      }

      // wait 落定后 SSE 尾事件可能仍在途中：以投影消息为准补齐未打印的文本/推理段。
      // sinceMessageID 找不到（不应发生）时放弃补齐，避免重印整段历史。
      async function printTail(
        client: OpenNovelClient,
        sessionID: string,
        sinceMessageID: string | undefined,
        printed: ReadonlySet<string>,
      ) {
        const collected: SessionMessage[] = []
        let cursor: string | undefined
        let found = sinceMessageID === undefined
        for (;;) {
          const page = await client.v2.session
            .messages({ sessionID, limit: 50, order: "desc", ...(cursor === undefined ? {} : { cursor }) })
            .then((x) => x.data)
            .catch(() => undefined)
          const items = page?.data ?? []
          if (items.length === 0) break
          collected.push(...items)
          if (items.some((item) => item.id === sinceMessageID)) {
            found = true
            break
          }
          const next = page?.cursor.next
          if (!next) break
          cursor = next
        }
        if (!found) return

        const tail: SessionMessage[] = []
        for (const item of collected) {
          if (item.id === sinceMessageID) break
          tail.push(item)
        }
        for (const item of tail.reverse()) {
          if (item.type !== "assistant") continue
          for (const part of item.content) {
            if (part.type === "text" && !printed.has(`text:${part.id}`)) printText(part.text)
            if (part.type === "reasoning" && thinking && !printed.has(`reasoning:${part.id}`)) {
              printReasoning(part.text)
            }
          }
        }
      }

      async function execute(sdk: OpenNovelClient) {
        const cwd = args.attach ? (directory ?? (await current(sdk))) : (directory ?? root)
        const client = args.attach ? attachSDK(cwd) : sdk

        const agent = await pickAgent(client)
        const model = pick(args.model, args.variant)

        const sess = await resolveSession(client, cwd, agent, model)
        if (!sess) {
          UI.error("Failed to create session")
          process.exit(1)
        }
        const sessionID = sess.id

        // agent/model 是会话级状态：恢复会话与请求值不同则先切换（新建会话已在 create 时设定，比较自然短路）
        if (agent && sess.agent !== agent) await client.v2.session.switchAgent({ sessionID, agent })
        if (
          model &&
          (sess.model?.id !== model.id || sess.model.providerID !== model.providerID || sess.model.variant !== model.variant)
        ) {
          await client.v2.session.switchModel({ sessionID, model })
        }

        function failRequest(error: unknown) {
          if (args.format === "json") {
            process.stdout.write(JSON.stringify({ type: "error", timestamp: Date.now(), sessionID, error }) + EOL)
            return
          }
          UI.error(formatRunError(error))
        }

        const abort = new AbortController()
        const events = await client.v2.event.subscribe({
          signal: abort.signal,
          onSseError: (error) => {
            if (abort.signal.aborted) return
            console.error(error)
          },
        })
        const printed = new Set<string>()

        // 消费全局 V2 事件流：权限/问题自动应答两种模式都做；
        // json 模式原样输出会话事件，default 模式渲染文本/工具进度。
        async function loop() {
          const names = new Map<string, string>()
          const toggles = new Map<string, boolean>()
          let error: string | undefined

          for await (const event of events.stream) {
            if (!("sessionID" in event.data) || event.data.sessionID !== sessionID) continue

            if (event.type === "permission.v2.asked") {
              if (auto) {
                await client.v2.session.permission.reply({ sessionID, requestID: event.data.id, reply: "once" })
                continue
              }
              UI.println(
                UI.Style.TEXT_WARNING_BOLD + "!",
                UI.Style.TEXT_NORMAL +
                  `permission requested: ${event.data.action} (${event.data.resources.join(", ")}); auto-rejecting`,
              )
              await client.v2.session.permission.reply({ sessionID, requestID: event.data.id, reply: "reject" })
              continue
            }

            if (event.type === "question.v2.asked") {
              UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL + `question requested; auto-rejecting`)
              await client.v2.session.question.reject({ sessionID, requestID: event.data.id })
              continue
            }

            if (args.format === "json") {
              process.stdout.write(JSON.stringify(event) + EOL)
              continue
            }

            if (event.type === "session.next.step.started") {
              if (toggles.get("start") === true) continue
              UI.empty()
              UI.println(`> ${event.data.agent} · ${event.data.model.id}`)
              UI.empty()
              toggles.set("start", true)
              continue
            }

            if (event.type === "session.next.tool.input.started") {
              names.set(event.data.callID, event.data.name)
              continue
            }

            if (event.type === "session.next.tool.called") {
              names.set(event.data.callID, event.data.tool)
              if (event.data.tool !== "task" && event.data.tool !== "subagent") continue
              if (toggles.get(event.data.callID) === true) continue
              inline({ icon: "⚙", title: event.data.tool })
              toggles.set(event.data.callID, true)
              continue
            }

            if (event.type === "session.next.tool.success") {
              inline({ icon: "⚙", title: names.get(event.data.callID) ?? event.data.callID })
              names.delete(event.data.callID)
              continue
            }

            if (event.type === "session.next.tool.failed") {
              inline({ icon: "✗", title: `${names.get(event.data.callID) ?? event.data.callID} failed` })
              names.delete(event.data.callID)
              UI.error(event.data.error.message)
              continue
            }

            if (event.type === "session.next.text.ended") {
              printed.add(`text:${event.data.textID}`)
              printText(event.data.text)
              continue
            }

            if (event.type === "session.next.reasoning.ended") {
              printed.add(`reasoning:${event.data.reasoningID}`)
              if (thinking) printReasoning(event.data.text)
              continue
            }

            if (event.type === "session.next.step.failed") {
              error = error ? error + EOL + event.data.error.message : event.data.error.message
              UI.error(event.data.error.message)
              continue
            }
          }
          return error
        }

        const finished = loop().catch((e) => {
          if (abort.signal.aborted) return undefined
          console.error(e)
          process.exitCode = 1
          return undefined
        })

        let admittedID: string | undefined
        if (args.command) {
          const result = await client.v2.session.command({
            sessionID,
            command: args.command,
            arguments: message,
          })
          if (result.error) {
            failRequest(result.error)
            process.exitCode = 1
            abort.abort()
            await finished
            return
          }
          admittedID = result.data?.data.id
        } else {
          const result = await client.v2.session.prompt({
            sessionID,
            prompt: { text: message, ...(files.length === 0 ? {} : { files }) },
          })
          if (result.error) {
            failRequest(result.error)
            process.exitCode = 1
            abort.abort()
            await finished
            return
          }
          admittedID = result.data?.data.id
        }

        // prompt 返回时 wake 已同步注册 drain，wait 必然挂到本次执行上（无早退竞态）
        const settled = await client.v2.session.wait({ sessionID })
        if (settled.error) {
          failRequest(settled.error)
          process.exitCode = 1
          abort.abort()
          await finished
          return
        }
        if (args.format !== "json") await printTail(client, sessionID, admittedID, printed)
        // json 模式以事件流为输出：wait 落定时尾部事件可能仍在 SSE 投递途中，留冲刷窗口再断流
        if (args.format === "json") await new Promise((resolve) => setTimeout(resolve, 200))
        abort.abort()
        const error = await finished
        if (error) process.exitCode = 1
      }

      if (args.attach) {
        const sdk = attachSDK(directory)
        return await execute(sdk)
      }

      const { embeddedClient } = await import("../embedded-client")
      await execute(await embeddedClient(directory))
    })
  }),
})
