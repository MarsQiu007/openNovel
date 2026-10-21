/**
 * style-rules-pipeline — 提示词与工具描述契约测试
 *
 * 工具描述 / architect / observer 提示词必须说明规则扁平映射契约（值需为标量、
 * 嵌套对象按 父.子 展平、数组按索引展平），防止链路单侧改名造成静默断裂。
 */
import { describe, test, expect } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { architectAgent } from "../../src/novel-writer/agents/architect.js"
import { observerAgent } from "../../src/novel-writer/agents/observer.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

describe("风格规则格式契约提示词", () => {
  test("save_novel_settings 工具描述包含扁平映射契约", async () => {
    const dir = join(tmpdir(), `style-rules-prompts-${Date.now()}`)
    mkdirSync(join(dir, ".novel"), { recursive: true })
    try {
      const hooks = await NovelWriterPlugin(createPluginInput(dir))
      const description = hooks.tool!.save_novel_settings!.description ?? ""
      expect(description).toContain("扁平字符串映射")
      expect(description).toContain("展平")
      expect(description).toContain("数组按索引展平")
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // 忽略清理失败
      }
    }
  })

  test("architect 提示词说明 rules 的扁平映射与展平语义", () => {
    expect(architectAgent.prompt).toContain("扁平字符串映射")
    expect(architectAgent.prompt).toContain("展平")
  })

  test("observer 提示词说明 rules 的展平语义", () => {
    expect(observerAgent.prompt).toContain("扁平字符串映射")
    expect(observerAgent.prompt).toContain("展平")
  })
})
