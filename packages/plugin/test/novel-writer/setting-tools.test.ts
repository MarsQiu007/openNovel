/**
 * read_setting / search_settings 回归测试
 *
 * 覆盖设定全文读取、搜索结果上下文、类型过滤与参数校验。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { getDb, NovelTable, WorldEntryTable, PlotThreadTable } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `setting-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
    sessionID: "ses-setting-tools",
    messageID: "msg_test",
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
  await db.insert(NovelTable).values({ id: "novel-tools", title: "设定工具测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  await db.insert(WorldEntryTable).values({
    id: "world-ranks",
    novel_id: "novel-tools",
    category: "社会制度",
    title: "爵位体系",
    content: "旧王朝采用五等爵位传承制度，爵位不可越级继承。",
  }).run()
  await db.insert(PlotThreadTable).values({
    id: "plot-ranks",
    novel_id: "novel-tools",
    title: "爵位之争",
    description: "主角卷入爵位继承案，逐渐发现旧王朝的秘密。",
  }).run()
  const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
  return { db, hooks: hooks.tool! }
}

describe("read_setting", () => {
  test("返回 world_entry 全字段内容", async () => {
    const { hooks } = await seed()
    const result = await hooks.read_setting!.execute(
      { novel_id: "novel-tools", entity_type: "world_entry", entity_id: "world-ranks" },
      toolCtx(),
    )
    const row = JSON.parse(result.output)
    expect(row.id).toBe("world-ranks")
    expect(row.category).toBe("社会制度")
    expect(row.title).toBe("爵位体系")
    expect(row.content).toContain("五等爵位传承制度")
  })

  test("记录不存在时返回错误信息", async () => {
    const { hooks } = await seed()
    const result = await hooks.read_setting!.execute(
      { novel_id: "novel-tools", entity_type: "world_entry", entity_id: "world-missing" },
      toolCtx(),
    )
    expect(result.output).toContain("记录不存在")
  })

  test("不支持的类型返回类型列表", async () => {
    const { hooks } = await seed()
    const result = await hooks.read_setting!.execute(
      { novel_id: "novel-tools", entity_type: "artifact", entity_id: "anything" },
      toolCtx(),
    )
    expect(result.output).toContain("不支持的实体类型")
    expect(result.output).toContain("world_entry")
  })
})

describe("search_settings", () => {
  test("搜索 world_entry 内容并返回上下文片段", async () => {
    const { hooks } = await seed()
    const result = await hooks.search_settings!.execute({ novel_id: "novel-tools", query: "传承" }, toolCtx())
    const rows = JSON.parse(result.output)
    expect(rows).toHaveLength(1)
    const world = rows.find((row: { id: string }) => row.id === "world-ranks")
    expect(world.matched_field).toBe("content")
    expect(world.title).toBe("爵位体系")
    expect(world.snippet).toContain("五等爵位传承制度")
  })

  test("按类型过滤后只返回匹配类型", async () => {
    const { hooks } = await seed()
    const result = await hooks.search_settings!.execute(
      { novel_id: "novel-tools", query: "爵位", entity_type: "plot_thread" },
      toolCtx(),
    )
    const rows = JSON.parse(result.output)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe("plot-ranks")
    expect(rows[0].entity_type).toBe("plot_thread")
  })

  test("无匹配时返回空结果提示", async () => {
    const { hooks } = await seed()
    const result = await hooks.search_settings!.execute({ novel_id: "novel-tools", query: "不存在关键词" }, toolCtx())
    expect(result.output).toContain("未找到")
  })

  test("空关键词返回参数校验错误", async () => {
    const { hooks } = await seed()
    const result = await hooks.search_settings!.execute({ novel_id: "novel-tools", query: "  " }, toolCtx())
    expect(result.output).toContain("query 不能为空")
  })
})
