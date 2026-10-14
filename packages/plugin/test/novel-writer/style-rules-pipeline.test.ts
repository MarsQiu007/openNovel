/**
 * style-rules-pipeline — 读取侧与端到端回归测试
 *
 * 覆盖：check_novel_settings 对历史形态 rules 的展平输出；
 * （后续任务将在此文件追加端到端回归用例）
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { getDb, NovelTable, StyleGuideTable } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `style-rules-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function toolCtx(): ToolContext {
  return {
    sessionID: "ses-style-rules",
    messageID: "msg_style_rules",
    agent: "director",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

async function seed() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-check", title: "检查测试", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  return db
}

describe("check_novel_settings 读取归一化", () => {
  test("历史嵌套/数组规则以展平行输出，不再输出原始 JSON 或占位符", async () => {
    const db = await seed()
    // 直接写入历史嵌套形态（模拟旧数据或外部写入）
    await db
      .insert(StyleGuideTable)
      .values({
        id: "sg-check",
        novel_id: "novel-check",
        rules: { "异能体系": { "等级严格": "三级" }, "叙事节奏": ["紧凑", "留白"] },
        tone: "热血",
        pov: "第三人称",
        tense: "过去时",
      })
      .run()

    const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
    const result = await hooks.tool!.check_novel_settings!.execute(
      { novel_id: "novel-check", scope: "style_guide" },
      toolCtx(),
    )

    expect(result.output).toContain("- 异能体系.等级严格: 三级")
    expect(result.output).toContain("- 叙事节奏.0: 紧凑")
    expect(result.output).toContain("- 叙事节奏.1: 留白")
    expect(result.output).not.toContain("[object Object]")
    expect(result.output).not.toContain('{"')
  })
})
