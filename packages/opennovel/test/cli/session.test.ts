// CLI session 读取/删除命令的子进程测试：list/delete 走 V2 HTTP 面（内嵌 server SDK）。
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("cli session (V2)", () => {
  cliIt.live(
    "list 展示 run 创建的会话，delete 后消失",
    (input) =>
      Effect.gen(function* () {
        yield* input.llm.text("session list probe")
        const run = yield* input.opennovel.run("hi")
        input.opennovel.expectExit(run, 0)

        const listed = yield* input.opennovel.spawn(["session", "list", "--format", "json"])
        input.opennovel.expectExit(listed, 0, "session list")
        const parsed: unknown = JSON.parse(listed.stdout)
        if (!Array.isArray(parsed)) throw new Error(`unexpected session list: ${listed.stdout}`)
        const sessions = parsed.flatMap((item: unknown) => {
          if (typeof item !== "object" || item === null || !("id" in item) || !("directory" in item)) return []
          return typeof item.id === "string" && typeof item.directory === "string"
            ? [{ id: item.id, directory: item.directory }]
            : []
        })
        expect(sessions.length).toBe(1)
        expect(sessions[0].directory).toContain("oc-cli-")

        const deleted = yield* input.opennovel.spawn(["session", "delete", sessions[0].id])
        input.opennovel.expectExit(deleted, 0, "session delete")
        expect(deleted.stderr).toContain("deleted")

        const after = yield* input.opennovel.spawn(["session", "list", "--format", "json"])
        input.opennovel.expectExit(after, 0, "session list after delete")
        expect(after.stdout.trim()).toBe("")
      }),
    120_000,
  )

  cliIt.live(
    "delete 缺失会话报错并以 1 退出",
    (input) =>
      Effect.gen(function* () {
        const result = yield* input.opennovel.spawn(["session", "delete", "ses_missing"])
        input.opennovel.expectExit(result, 1, "session delete missing")
        expect(result.stdout + result.stderr).toContain("Session not found")
      }),
    60_000,
  )
})
