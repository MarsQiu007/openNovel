// CLI stats 命令的子进程测试：聚合走 V2 HTTP 面（会话列表 + 每会话消息）。
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("cli stats (V2)", () => {
  cliIt.live(
    "汇总 run 创建的会话并按模型分组",
    (input) =>
      Effect.gen(function* () {
        yield* input.llm.text("stats probe")
        const run = yield* input.opennovel.run("hi")
        input.opennovel.expectExit(run, 0)

        const stats = yield* input.opennovel.spawn(["stats", "--models"])
        input.opennovel.expectExit(stats, 0, "stats")
        expect(stats.stdout).toContain("OVERVIEW")
        expect(stats.stdout).toContain("Sessions")
        expect(stats.stdout).toContain("MODEL USAGE")
        expect(stats.stdout).toContain("test/test-model")
      }),
    90_000,
  )
})
