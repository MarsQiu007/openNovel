/**
 * 复测隔离插件上下文测试（任务 3.1）：临时 Location 携带 internal purpose 时，
 * novel-writer 装载工具与 agent，但不进入常规上下文、事件采集、命令和对账路径。
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdirSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import plugin from "../../src/novel-writer-v2.js"
import type { PluginContext } from "../../src/v2/effect/context.js"

interface TestAgentDraft {
  remove(id: string): void
  update(id: string, update: (agent: unknown) => void): void
  default(id: string | undefined): void
}

describe("复测临时 Location purpose", () => {
  test("purpose 存在时跳过常规注册与启动对账", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "tool-insight-purpose-project-"))
    mkdirSync(join(projectDir, ".novel"), { recursive: true })
    const calls: string[] = []
    const agentCalls: string[] = []
    const tools: string[] = []
    const ctx = {
      purpose: "tool-insight",
      agent: {
        transform: (callback: (draft: TestAgentDraft) => Effect.Effect<void>) =>
          Effect.sync(() => {
            callback({
              remove: (id) => agentCalls.push(`remove:${id}`),
              update: (id) => agentCalls.push(`update:${id}`),
              default: (id) => agentCalls.push(`default:${String(id)}`),
            })
          }),
      },
      tool: {
        transform: (callback: (editor: { add: (name: string, tool: unknown) => void }) => Effect.Effect<void>) =>
          Effect.sync(() => {
            callback({ add: (name, tool) => tools.push(`${name}:${String(typeof tool.execute === "function")}`) })
          }),
      },
      systemContext: { register: () => Effect.sync(() => calls.push("context")) },
      command: { transform: () => Effect.sync(() => calls.push("command")) },
      event: { subscribe: () => Effect.die("purpose 隔离不应订阅常规事件") },
      location: { directory: projectDir },
      paths: { config: projectDir },
    } as unknown as PluginContext

    try {
      await Effect.runPromise(Effect.scoped(plugin.effect(ctx) as Effect.Effect<void, never, never>))
      expect(agentCalls).toContain("default:director")
      expect(tools).toContain("tool_insight:true")
      expect(calls).toEqual([])
    } finally {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })
})