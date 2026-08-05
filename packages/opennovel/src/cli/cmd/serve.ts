import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opennovel-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "启动无头 opennovel 服务器",
  // 服务器通过 x-opennovel-directory 请求头按需加载实例 ——
  // 启动时不需要全局项目 InstanceContext。
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENNOVEL_SERVER_PASSWORD) {
      console.log("警告: 未设置 OPENNOVEL_SERVER_PASSWORD；服务器未受保护。")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opennovel 服务器监听于 http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
