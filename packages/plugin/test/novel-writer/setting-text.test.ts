/**
 * 设定长文本纯文本格式校验测试
 *
 * 设定阅读器使用纯文本段落渲染，写入端必须拦截 Markdown，避免污染段落锚点。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { getDb, NovelTable, WorldEntryTable } from "../../src/novel-writer/session-store.js"
import { architectAgent } from "../../src/novel-writer/agents/architect.js"
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"
import { observerAgent } from "../../src/novel-writer/agents/observer.js"
import { paragraphFormatError, plainTextFormatError } from "../../src/novel-writer/setting-text.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `setting-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
    sessionID: "ses-setting-text",
    messageID: "msg_test",
    agent: "architect",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

async function seed() {
  const db = getDb(projectDir)
  await db.insert(NovelTable).values({ id: "novel-text", title: "纯文本测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  await db.insert(WorldEntryTable).values({
    id: "world-text",
    novel_id: "novel-text",
    category: "力量体系",
    title: "锻体期",
    content: "锻体期是第一境界。\n\n主要强化肉身。",
  }).run()
  const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
  return { db, hooks: hooks.tool! }
}

describe("plainTextFormatError", () => {
  test("拦截常见 Markdown 语法", () => {
    expect(plainTextFormatError("## 标题")).toContain("Markdown 标题")
    expect(plainTextFormatError("**加粗**")).toContain("Markdown 加粗")
    expect(plainTextFormatError("- 项目")).toContain("Markdown 无序列表")
    expect(plainTextFormatError("[文本](https://example.com)")).toContain("Markdown 链接")
    expect(plainTextFormatError("> 引用")).toContain("Markdown 引用")
  })

  test("允许普通纯文本和空行分段", () => {
    expect(plainTextFormatError("这是第一段。\n\n这是第二段。")).toBeNull()
  })
})

describe("paragraphFormatError", () => {
  test("接受 300 字的连贯单段", () => {
    const text = "这是一段完整的人物描述。".repeat(25)
    expect(text.length).toBe(300)
    expect(plainTextFormatError(text)).toBeNull()
    expect(paragraphFormatError(text)).toBeNull()
  })

  test("接受恰好 600 字的单段", () => {
    expect(paragraphFormatError("字".repeat(600))).toBeNull()
  })

  test("拒绝超过 600 字的单段", () => {
    expect(paragraphFormatError("字".repeat(650))).toContain("第 1 段（650 字）")
    expect(paragraphFormatError("字".repeat(650))).toContain("600 字")
  })

  test("只拒绝多段内容中的超长段落", () => {
    const text = `第一段。\n\n${"字".repeat(650)}`
    expect(paragraphFormatError(text)).toContain("第 2 段（650 字）")
  })

  test("不限制多个合格段落的总字数", () => {
    const text = Array.from({ length: 3 }, () => "字".repeat(250)).join("\n\n")
    expect(text.length).toBeGreaterThan(600)
    expect(paragraphFormatError(text)).toBeNull()
  })

  test("短内容或已有空行分段的内容通过", () => {
    expect(paragraphFormatError("短内容。")).toBeNull()
    expect(paragraphFormatError("第一段。\n\n第二段。")).toBeNull()
  })
})

describe("setting paragraph prompts", () => {
  test("架构师、观察者和编排者提示使用相同阈值", () => {
    expect(architectAgent.systemPrompt).toContain("约 80–220 字")
    expect(architectAgent.systemPrompt).toContain("600 字")
    expect(observerAgent.prompt).toContain("约 80–220 字")
    expect(observerAgent.prompt).toContain("600 字")
    expect(directorAgentConfig.systemPrompt).toContain("600 字")
  })
})

describe("setting write tools", () => {
  test("save_novel_settings 拒绝 Markdown 内容", async () => {
    const { db, hooks } = await seed()
    const result = await hooks.save_novel_settings!.execute(
      {
        novel_id: "novel-text",
        settings_json: JSON.stringify([
          { type: "world_entry", data: { category: "力量体系", title: "炼气期", content: "## 炼气期\n\n**吸纳灵气。**" } },
        ]),
      },
      toolCtx(),
    )
    expect(result.output).toContain("设定文本格式校验失败")
    expect(result.metadata.count).toBe(0)
    const rows = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.title, "炼气期")).all()
    expect(rows).toHaveLength(0)
  })

  test("update_setting 拒绝 Markdown 内容", async () => {
    const { db, hooks } = await seed()
    const result = await hooks.update_setting!.execute(
      {
        entity_type: "world_entry",
        entity_id: "world-text",
        fields_json: JSON.stringify({ content: "- 第一境界\n- 第二境界" }),
      },
      toolCtx(),
    )
    expect(result.output).toContain("设定文本格式校验失败")
    const [row] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-text")).all()
    expect(row.content).toBe("锻体期是第一境界。\n\n主要强化肉身。")
  })

  test("save_novel_settings 接受 300 字的单段内容", async () => {
    const content = "这是一段完整的人物描述。".repeat(24)
    const { db, hooks } = await seed()
    const result = await hooks.save_novel_settings!.execute(
      {
        novel_id: "novel-text",
        settings_json: JSON.stringify([
          { type: "world_entry", data: { category: "力量体系", title: "连贯段落", content } },
        ]),
      },
      toolCtx(),
    )
    expect(result.output).toContain("已保存")
    expect(result.metadata.count).toBe(1)
    expect((await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.title, "连贯段落")).all()).length).toBe(1)
  })

  test("save_novel_settings 接受总长超过 600 字的多段内容", async () => {
    const content = ["字".repeat(250), "字".repeat(250), "字".repeat(250)].join("\n\n")
    const { db, hooks } = await seed()
    const result = await hooks.save_novel_settings!.execute(
      {
        novel_id: "novel-text",
        settings_json: JSON.stringify([
          { type: "world_entry", data: { category: "力量体系", title: "多段长文", content } },
        ]),
      },
      toolCtx(),
    )
    expect(result.output).toContain("已保存")
    expect(result.metadata.count).toBe(1)
    expect((await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.title, "多段长文")).all()).length).toBe(1)
  })

  test("save_novel_settings 拒绝超过 600 字的单段内容", async () => {
    const content = "字".repeat(650)
    const { hooks } = await seed()
    const result = await hooks.save_novel_settings!.execute(
      {
        novel_id: "novel-text",
        settings_json: JSON.stringify([
          { type: "world_entry", data: { category: "力量体系", title: "单段长文", content } },
        ]),
      },
      toolCtx(),
    )
    expect(result.output).toContain("超过 600 字")
    expect(result.metadata.count).toBe(0)
  })

  test("update_setting 拒绝超过 600 字的单段内容", async () => {
    const content = "字".repeat(650)
    const { hooks } = await seed()
    const result = await hooks.update_setting!.execute(
      {
        entity_type: "world_entry",
        entity_id: "world-text",
        fields_json: JSON.stringify({ content }),
      },
      toolCtx(),
    )
    expect(result.output).toContain("超过 600 字")
  })

  test("update_setting 将单个换行规范化为空行分段", async () => {
    const { db, hooks } = await seed()
    const result = await hooks.update_setting!.execute(
      {
        entity_type: "world_entry",
        entity_id: "world-text",
        fields_json: JSON.stringify({ content: "第一段。\n第二段。" }),
      },
      toolCtx(),
    )
    expect(result.output).toContain("已更新 world_entry")
    const [row] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-text")).all()
    expect(row.content).toBe("第一段。\n\n第二段。")
  })
})
