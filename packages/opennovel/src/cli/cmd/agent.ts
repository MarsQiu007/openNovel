import { cmd } from "./cmd"
import { Filesystem } from "@/util/filesystem"
import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"

const AgentListCommand = effectCmd({
  command: "list",
  describe: "list all available agents",
  handler: Effect.fn("Cli.agent.list")(function* () {
    const { embeddedClient } = yield* Effect.promise(() => import("../embedded-client"))
    // 带 directory：AgentV2 是 Location 作用域，项目级 agent 定义依赖位置解析
    const client = yield* Effect.promise(() => embeddedClient(Filesystem.resolve(process.cwd())))
    const result = yield* Effect.promise(() => client.v2.agent.list())
    if (result.error) return yield* fail(`Failed to list agents: ${JSON.stringify(result.error)}`)
    const agents = (result.data?.data ?? []).sort((a, b) => a.id.localeCompare(b.id))

    for (const agent of agents) {
      process.stdout.write(`${agent.id} (${agent.mode})` + EOL)
      process.stdout.write(`  ${JSON.stringify(agent.permissions, null, 2)}` + EOL)
    }
  }),
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentListCommand).demandCommand(),
  async handler() {},
})
