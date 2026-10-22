import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { EOL } from "os"
import path from "path"
import { which } from "@opennovel-ai/core/util/which"
import { embeddedClient } from "../embedded-client"
import type { SessionV2Info } from "@opennovel-ai/sdk/v2"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.OPENNOVEL_GIT_BASH_PATH) {
    const less = path.join(Flag.OPENNOVEL_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).command(SessionDeleteCommand).demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const client = yield* Effect.promise(() => embeddedClient())
    // V2 删除对缺失会话是 no-op，先 get 预检保留「不存在则报错」的既有语义
    const found = yield* Effect.promise(() =>
      client.v2.session
        .get({ sessionID: args.sessionID })
        .then((x) => x.data?.data)
        .catch(() => undefined),
    )
    if (!found) return yield* fail(`Session not found: ${args.sessionID}`)
    yield* Effect.promise(() => client.v2.session.delete({ sessionID: args.sessionID }))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.session.list")(function* (args) {
    // core SessionV2.list 尚无 roots 入参（protocol 声明了但被忽略），客户端按 parentID 过滤；
    // 服务端恒生成 next 游标，空页即到底。directory 与 run 一致走 realpath 规范化
    // （core 按 SessionTable.directory 精确匹配，raw cwd 会失配）。
    const listed = yield* Effect.promise(async () => {
      const client = await embeddedClient(Filesystem.resolve(process.cwd()))
      const collected: SessionV2Info[] = []
      let cursor: string | undefined
      for (;;) {
        const page = await client.v2.session.list({ limit: 50, ...(cursor === undefined ? {} : { cursor }) })
        if (page.error) return { error: page.error }
        const items = page.data?.data ?? []
        collected.push(...items.filter((item) => !item.parentID))
        if (args.maxCount !== undefined && collected.length >= args.maxCount) break
        const next = page.data?.cursor.next
        if (!next || items.length === 0) break
        cursor = next
      }
      return { sessions: args.maxCount === undefined ? collected : collected.slice(0, args.maxCount) }
    })
    if ("error" in listed) return yield* fail(`Failed to list sessions: ${JSON.stringify(listed.error)}`)
    const sessions = listed.sessions

    if (sessions.length === 0) return

    const output = args.format === "json" ? formatSessionJSON(sessions) : formatSessionTable(sessions)

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      })
    } else {
      console.log(output)
    }
  }),
})

function formatSessionTable(sessions: SessionV2Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: SessionV2Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.location.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
