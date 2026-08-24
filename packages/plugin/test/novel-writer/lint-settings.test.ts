/**
 * lint_settings / rename_world_category 工具测试
 *
 * 验证存量设定整理：体检报告（非标准分类/空字段/跨分类同标题）、
 * 批量归类（校验目标分类、记录 description_history、幂等提示）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { getDb, NovelTable, WorldEntryTable, CharacterTable } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `lint-settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
    sessionID: "ses-lint-test",
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
  await db.insert(NovelTable).values({ id: "novel-lint", title: "整理测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  // 非标准分类（存量旧数据）
  await db
    .insert(WorldEntryTable)
    .values({ id: "we-old-1", novel_id: "novel-lint", category: "力量", title: "灵根", content: "修行根基", created_at: 1 })
    .run()
  await db
    .insert(WorldEntryTable)
    .values({ id: "we-old-2", novel_id: "novel-lint", category: "力量", title: "境界划分", content: "炼气筑基金丹", created_at: 1 })
    .run()
  // 标准分类 + 跨分类同标题
  await db
    .insert(WorldEntryTable)
    .values({ id: "we-good", novel_id: "novel-lint", category: "势力/宗门", title: "星辰阁", content: "主角所在宗门", created_at: 1 })
    .run()
  await db
    .insert(WorldEntryTable)
    .values({ id: "we-dup", novel_id: "novel-lint", category: "地点", title: "星辰阁", content: "阁址在东域", created_at: 1 })
    .run()
  // 空 description 角色
  await db
    .insert(CharacterTable)
    .values({ id: "char-empty", novel_id: "novel-lint", name: "路人甲", role: "extra", description: "", status: "active" })
    .run()
  return db
}

async function getHooks() {
  return NovelWriterPlugin(createPluginInput(projectDir))
}

describe("lint_settings", () => {
  test("报告非标准分类、空字段、跨分类同标题与分类统计", async () => {
    await seed()
    const hooks = await getHooks()
    const result = await hooks.tool!.lint_settings!.execute({ novel_id: "novel-lint" }, toolCtx())
    expect(result.output).toContain("非标准分类")
    expect(result.output).toContain("「力量」× 2")
    expect(result.output).toContain("空字段")
    expect(result.output).toContain("路人甲")
    expect(result.output).toContain("跨分类同标题")
    expect(result.output).toContain("「星辰阁」")
    expect(result.output).toContain("分类统计")
    expect(result.metadata!.issues).toBe(2 + 1 + 1)
  })

  test("无问题时输出通过标记", async () => {
    const db = getDb(projectDir)
    await db.insert(NovelTable).values({ id: "novel-clean", title: "干净", genre: "玄幻", synopsis: "", status: "draft" }).run()
    await db
      .insert(WorldEntryTable)
      .values({ id: "we-ok", novel_id: "novel-clean", category: "地理", title: "东域", content: "大陆东部", created_at: 1 })
      .run()
    const hooks = await getHooks()
    const result = await hooks.tool!.lint_settings!.execute({ novel_id: "novel-clean" }, toolCtx())
    expect(result.output).toContain("未发现结构问题")
    expect(result.metadata!.issues).toBe(0)
  })
})

describe("rename_world_category", () => {
  test("批量归类到标准分类并记录历史", async () => {
    const db = await seed()
    const hooks = await getHooks()
    const result = await hooks
      .tool!.rename_world_category!.execute({ novel_id: "novel-lint", old_category: "力量", new_category: "力量体系" }, toolCtx())
    expect(result.metadata!.updated).toBe(2)
    const rows = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, "novel-lint")).all()
    expect(rows.find((r) => r.id === "we-old-1")!.category).toBe("力量体系")
    expect(rows.find((r) => r.id === "we-old-2")!.category).toBe("力量体系")
    expect(rows.find((r) => r.id === "we-good")!.category).toBe("势力/宗门")
    // 归类后 lint 不再报非标准分类
    const lint = await hooks.tool!.lint_settings!.execute({ novel_id: "novel-lint" }, toolCtx())
    expect(lint.output).not.toContain("非标准分类")
    // description_history 可回溯
    const { DescriptionHistoryTable } = await import("@opennovel-ai/novel-store")
    const history = await db.select().from(DescriptionHistoryTable).where(eq(DescriptionHistoryTable.entity_id, "we-old-1")).all()
    expect(history).toHaveLength(1)
    expect(history[0].field).toBe("category")
  })

  test("目标分类不在白名单且无逃生门时拒绝", async () => {
    await seed()
    const hooks = await getHooks()
    const result = await hooks
      .tool!.rename_world_category!.execute({ novel_id: "novel-lint", old_category: "力量", new_category: "乱七八糟" }, toolCtx())
    expect(result.output).toContain("乱七八糟")
    const db = getDb(projectDir)
    const rows = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.category, "力量")).all()
    expect(rows).toHaveLength(2)
  })

  test("allow_new_category=true 放行新分类", async () => {
    await seed()
    const hooks = await getHooks()
    const result = await hooks
      .tool!.rename_world_category!.execute(
        { novel_id: "novel-lint", old_category: "力量", new_category: "乱七八糟", allow_new_category: true },
        toolCtx(),
      )
    expect(result.metadata!.updated).toBe(2)
  })

  test("无匹配分类时不做任何修改", async () => {
    await seed()
    const hooks = await getHooks()
    const result = await hooks
      .tool!.rename_world_category!.execute({ novel_id: "novel-lint", old_category: "不存在", new_category: "地理" }, toolCtx())
    expect(result.output).toContain("未找到")
    expect(result.metadata).toBeUndefined()
  })
})
