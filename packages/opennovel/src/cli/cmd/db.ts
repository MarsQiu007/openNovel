import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opennovel-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { CliError, effectCmd } from "../effect-cmd"

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

const QueryCommand = effectCmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query as string | undefined
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const keys = Object.keys(result[0])
        console.log(keys.join("\t"))
        for (const row of result) console.log(keys.map((key) => row[key]).join("\t"))
      }
      return
    }
    const child = spawn("sqlite3", [Database.path()], {
      stdio: "inherit",
    })
    // sqlite3 未安装时 spawn 只发 error 事件；不接住它会变成未捕获异常，这里转成可读的 CliError
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          child.on("close", () => resolve())
          child.on("error", reject)
        }),
      catch: (error) => new CliError({ message: `Failed to run sqlite3: ${reason(error)}` }),
    })
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print the database path",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log(Database.path())
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
