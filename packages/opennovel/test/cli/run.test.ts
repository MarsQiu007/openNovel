// CLI `run` V2 执行链的子进程测试：create → prompt → wait → 读尾消息。
// 走真实二进制 + TestLLMServer，覆盖 argv → V2 SDK → 事件消费 → 退出码全链。
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { cliIt, type CliFixture } from "../lib/cli-process"

// V2 SessionRunner 经 core Catalog 解析模型，而 core Config 只从磁盘加载
// （全局配置目录 + 项目向上查找），不读 OPENNOVEL_CONFIG_CONTENT。
// 把 V2 形状的测试 provider 配置写进全局配置目录，让 catalog 能解析 test/test-model。
const writeGlobalConfig = (input: CliFixture) =>
  Effect.promise(async () => {
    const dir = path.join(input.home, ".config", "opennovel")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(
      path.join(dir, "opennovel.json"),
      JSON.stringify({
        provider: {
          test: {
            name: "Test",
            id: "test",
            env: [],
            npm: "@ai-sdk/openai-compatible",
            models: {
              "test-model": {
                id: "test-model",
                name: "Test Model",
                tool_call: true,
                limit: { context: 100_000, output: 10_000 },
                cost: { input: 0, output: 0 },
              },
            },
            options: { apiKey: "test-key", baseURL: input.llm.url },
          },
        },
      }),
    )
  })

describe("cli run (V2)", () => {
  cliIt.live(
    "default 模式打印模型文本并以 0 退出",
    (input) =>
      Effect.gen(function* () {
        yield* writeGlobalConfig(input)
        yield* input.llm.text("hello from test model")
        const result = yield* input.opennovel.run("hi")
        input.opennovel.expectExit(result, 0)
        expect(result.stdout).toContain("hello from test model")
      }),
    90_000,
  )

  cliIt.live(
    "json 模式输出会话范围的 V2 事件包络",
    (input) =>
      Effect.gen(function* () {
        yield* writeGlobalConfig(input)
        yield* input.llm.text("json hello")
        const result = yield* input.opennovel.run("hi", { format: "json" })
        input.opennovel.expectExit(result, 0)

        const events = input.opennovel.parseJsonEvents(result.stdout)
        const types = events.map((event) => event.type)
        expect(types).toContain("session.next.step.started")
        expect(types).toContain("session.next.text.ended")

        const texts = events.flatMap((event) => {
          if (event.type !== "session.next.text.ended") return []
          const data: unknown = event.data
          if (typeof data !== "object" || data === null || !("text" in data)) return []
          return typeof data.text === "string" ? [data.text] : []
        })
        expect(texts.join(" ")).toContain("json hello")

        for (const event of events) {
          expect(event.data).toMatchObject({ sessionID: expect.any(String) })
        }
      }),
    90_000,
  )
})
