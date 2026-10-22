// CLI export 命令的子进程测试：导出走 V2 HTTP 面，--sanitize 按 V2 消息形状打码。
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

function sessionIDs(stdout: string): string[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item)) return []
    return typeof item.id === "string" ? [item.id] : []
  })
}

describe("cli export (V2)", () => {
  cliIt.live(
    "导出 V2 会话 JSON，--sanitize 打码文本",
    (input) =>
      Effect.gen(function* () {
        yield* input.llm.text("export probe text")
        const run = yield* input.opennovel.run("hello export")
        input.opennovel.expectExit(run, 0)

        const listed = yield* input.opennovel.spawn(["session", "list", "--format", "json"])
        input.opennovel.expectExit(listed, 0, "session list")
        const ids = sessionIDs(listed.stdout)
        expect(ids.length).toBe(1)

        const exported = yield* input.opennovel.spawn(["export", ids[0]])
        input.opennovel.expectExit(exported, 0, "export")
        expect(exported.stdout).toContain("export probe text")
        expect(exported.stdout).toContain('"type": "assistant"')

        const sanitized = yield* input.opennovel.spawn(["export", ids[0], "--sanitize"])
        input.opennovel.expectExit(sanitized, 0, "export --sanitize")
        expect(sanitized.stdout).not.toContain("export probe text")
        expect(sanitized.stdout).not.toContain("hello export")
        expect(sanitized.stdout).toContain("[redacted:text:")
      }),
    120_000,
  )

  cliIt.live(
    "导出缺失会话报错并以 1 退出",
    (input) =>
      Effect.gen(function* () {
        const result = yield* input.opennovel.spawn(["export", "ses_missing"])
        input.opennovel.expectExit(result, 1, "export missing")
        expect(result.stdout + result.stderr).toContain("Session not found")
      }),
    60_000,
  )
})
