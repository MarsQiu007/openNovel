// CLI agent 命令的子进程测试：list 走 AgentV2 面（内嵌 server SDK）。
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../lib/cli-process"

describe("cli agent (V2)", () => {
  cliIt.live(
    "list 输出全局配置目录 agents/ 下的 markdown agent 定义",
    (input) =>
      Effect.gen(function* () {
        // AgentV2 注册表无内置 agent，全部来自配置/插件注册；markdown agent 由
        // config-agent 插件发现（测试 env 禁用了项目配置，写全局配置目录）
        yield* Effect.promise(() =>
          Bun.write(
            path.join(input.home, ".config", "opennovel", "agents", "tester.md"),
            ["---", "description: Test agent", "mode: primary", "---", "You are a test agent.", ""].join("\n"),
          ),
        )

        const result = yield* input.opennovel.spawn(["agent", "list"])
        input.opennovel.expectExit(result, 0, "agent list")
        expect(result.stdout).toContain("tester (primary)")
      }),
    60_000,
  )
})
