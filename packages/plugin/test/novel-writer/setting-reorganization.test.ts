import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import {
  DescriptionHistoryTable,
  EntityRefTable,
  getDb,
  NovelTable,
  WorldEntryTable,
} from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"
import {
  analyzeWorldEntries,
  executeOrganizePlan,
  parseOrganizePlan,
  titleSimilarity,
  validateOrganizePlan,
  type WorldEntryRecord,
} from "../../src/novel-writer/setting-reorganization.js"
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `setting-reorg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function toolCtx(ask?: ToolContext["ask"]): ToolContext {
  return {
    sessionID: "ses-setting-reorg",
    messageID: "msg_test",
    agent: "director",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    ask: ask ?? (async () => {}),
  }
}

function entry(overrides: Partial<WorldEntryRecord> & Pick<WorldEntryRecord, "id">): WorldEntryRecord {
  return {
    novel_id: "novel-reorg",
    category: "力量体系",
    title: "标准设定",
    content: "第一段。\n\n第二段。",
    created_at: 1,
    ...overrides,
  }
}

async function seed() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-reorg", title: "设定整理测试", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  return db
}

async function insertEntry(values: Partial<WorldEntryRecord> & Pick<WorldEntryRecord, "id" | "title">) {
  const db = getDb(projectDir)
  await db
    .insert(WorldEntryTable)
    .values({
      novel_id: "novel-reorg",
      category: "力量体系",
      title: "待整理设定",
      content: "第一段。\n\n第二段。",
      created_at: Date.now(),
      ...values,
    })
    .run()
}

async function hooks() {
  const db = await seed()
  const plugin = await NovelWriterPlugin(createPluginInput(projectDir))
  return { db, tool: plugin.tool! }
}

describe("world entry analyzer", () => {
  test("识别格式、分类和空字段问题", () => {
    const rows = [
      entry({ id: "bad-category", category: "重要设定" }),
      entry({ id: "markdown", content: "- 第一项\n- 第二项" }),
      entry({ id: "long", content: "这是一段很长的设定内容。".repeat(25) }),
      entry({ id: "empty", title: "", content: "" }),
    ]
    const issues = analyzeWorldEntries(rows)
    expect(issues.map((issue) => issue.type)).toContain("nonstandard_category")
    expect(issues.map((issue) => issue.type)).toContain("markdown_syntax")
    expect(issues.map((issue) => issue.type)).toContain("long_single_paragraph")
    expect(issues.map((issue) => issue.type)).toContain("empty_field")
    expect(issues.every((issue) => issue.issue_id && issue.evidence && issue.suggestion)).toBe(true)
  })

  test("识别同标题和相似标题，但不自动判定删除", () => {
    const rows = [
      entry({ id: "dup-a", title: "爵位体系" }),
      entry({ id: "dup-b", title: "爵位体系" }),
      entry({ id: "similar-a", title: "上古修真等级体系" }),
      entry({ id: "similar-b", title: "上古修真等级体制" }),
    ]
    const issues = analyzeWorldEntries(rows)
    const duplicate = issues.find((issue) => issue.type === "duplicate_title")
    const similar = issues.find((issue) => issue.type === "similar_title")
    expect(duplicate?.entry_ids).toEqual(["dup-a", "dup-b"])
    expect(similar?.entry_ids).toEqual(["similar-a", "similar-b"])
    expect(similar?.suggestion).toContain("不要自动删除")
  })

  test("相似度规则跳过单字标题并排除低相似度", () => {
    expect(titleSimilarity("上古修真等级体系", "上古修真等级体制")).toBeGreaterThanOrEqual(0.85)
    expect(titleSimilarity("上古修真等级体系", "完全不同名称设定")).toBeLessThan(0.85)
    expect(titleSimilarity("A", "B")).toBe(0)
  })

  test("无问题数据返回空列表", () => {
    expect(analyzeWorldEntries([entry({ id: "clean" })])).toEqual([])
  })
})

describe("organize plan validation", () => {
  test("解析并校验合法计划", () => {
    const raw = JSON.stringify({
      version: 1,
      entity_type: "world_entry",
      operations: [
        { action: "update", id: "entry-1", fields: { category: "地理", title: "城市", content: "第一段。\n第二段。" }, reason: "归类和分段" },
        { action: "delete", id: "entry-2", reason: "删除无引用空条目" },
      ],
    })
    const parsed = parseOrganizePlan(raw)
    expect(parsed.errors).toEqual([])
    const validation = validateOrganizePlan({
      plan: parsed.plan!,
      entries: [entry({ id: "entry-1" }), entry({ id: "entry-2", content: "" })],
      referencedIds: new Set(),
    })
    expect(validation.ok).toBe(true)
    expect(parsed.plan!.operations[0]!.action === "update" && parsed.plan!.operations[0]!.fields.content).toBe("第一段。\n\n第二段。")
  })

  test("拒绝未知实体、非法字段、重复 ID 和危险文本", () => {
    const raw = JSON.stringify({
      version: 1,
      entity_type: "character",
      operations: [
        { action: "update", id: "entry-1", fields: { category: "自造分类", content: "## 标题" }, reason: "" },
        { action: "delete", id: "entry-1", reason: "重复使用 ID" },
      ],
    })
    const parsed = parseOrganizePlan(raw)
    expect(parsed.errors.join("\n")).toContain("仅支持 world_entry")
    const validation = validateOrganizePlan({
      plan: parsed.plan!,
      entries: [entry({ id: "entry-1" })],
      referencedIds: new Set(),
    })
    expect(validation.ok).toBe(false)
    expect(validation.errors.join("\n")).toContain("非标准")
    expect(validation.errors.join("\n")).toContain("纯文本")
    expect(validation.errors.join("\n")).toContain("被多个操作使用")
  })

  test("删除被引用条目时返回引用冲突", () => {
    const parsed = parseOrganizePlan(JSON.stringify({ version: 1, operations: [{ action: "delete", id: "entry-1", reason: "重复" }] }))
    const validation = validateOrganizePlan({
      plan: parsed.plan!,
      entries: [entry({ id: "entry-1" })],
      referencedIds: new Set(["entry-1"]),
    })
    expect(validation.ok).toBe(false)
    expect(validation.errors.join("\n")).toContain("仍被活跃引用")
  })
})

describe("organize_settings tool", () => {
  test("analyze 返回问题报告且不修改数据", async () => {
    const { db, tool } = await hooks()
    await insertEntry({ id: "world-bad", category: "重要设定", title: "王朝制度", content: "## 王朝\n\n贵族分五等。" })
    const result = await tool.organize_settings!.execute({ action: "analyze", novel_id: "novel-reorg" }, toolCtx())
    expect(result.output).toContain("markdown_syntax")
    expect(result.output).toContain("nonstandard_category")
    expect(await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-bad")).all()).toHaveLength(1)
  })

  test("dry_run 校验合法计划但不修改数据库", async () => {
    const { db, tool } = await hooks()
    await insertEntry({ id: "world-target", title: "旧标题", content: "旧内容。" })
    const plan = JSON.stringify({
      version: 1,
      operations: [{ action: "update", id: "world-target", fields: { title: "新标题", content: "新内容。" }, reason: "整理标题" }],
    })
    const result = await tool.organize_settings!.execute({ action: "dry_run", novel_id: "novel-reorg", plan_json: plan }, toolCtx())
    expect(result.output).toContain("校验通过")
    const [row] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-target")).all()
    expect(row.title).toBe("旧标题")
    expect(row.content).toBe("旧内容。")
  })

  test("apply 更新内容、写入历史并支持单换行规范化", async () => {
    const { db, tool } = await hooks()
    await insertEntry({ id: "world-update", category: "重要设定", title: "旧标题", content: "## 旧内容" })
    const plan = JSON.stringify({
      version: 1,
      operations: [
        { action: "update", id: "world-update", fields: { category: "社会制度", title: "新标题", content: "第一段。\n第二段。" }, reason: "修复格式" },
      ],
    })
    const result = await tool.organize_settings!.execute({ action: "apply", novel_id: "novel-reorg", plan_json: plan }, toolCtx())
    expect(result.output).toContain("执行完成")
    const [row] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-update")).all()
    expect(row.category).toBe("社会制度")
    expect(row.content).toBe("第一段。\n\n第二段。")
    const history = await db.select().from(DescriptionHistoryTable).where(eq(DescriptionHistoryTable.entity_id, "world-update")).all()
    expect(history.length).toBeGreaterThanOrEqual(3)
  })

  test("用户拒绝运行时确认时不修改数据", async () => {
    const { db, tool } = await hooks()
    await insertEntry({ id: "world-denied", title: "旧标题" })
    const plan = JSON.stringify({
      version: 1,
      operations: [{ action: "update", id: "world-denied", fields: { title: "新标题" }, reason: "改名" }],
    })
    const result = await tool.organize_settings!.execute(
      { action: "apply", novel_id: "novel-reorg", plan_json: plan },
      toolCtx(async () => {
        throw new Error("rejected")
      }),
    )
    expect(result.output).toContain("拒绝执行")
    const [row] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-denied")).all()
    expect(row.title).toBe("旧标题")
  })

  test("merge 更新目标并删除未引用源条目", async () => {
    const { db, tool } = await hooks()
    await insertEntry({ id: "merge-target", title: "爵位体系", content: "目标内容。" })
    await insertEntry({ id: "merge-source", title: "爵位体系", content: "源内容。" })
    const plan = JSON.stringify({
      version: 1,
      operations: [
        { action: "merge", target_id: "merge-target", source_ids: ["merge-source"], fields: { content: "目标内容。\n\n源内容。" }, reason: "合并重复" },
      ],
    })
    const result = await tool.organize_settings!.execute({ action: "apply", novel_id: "novel-reorg", plan_json: plan }, toolCtx())
    expect(result.output).toContain("执行完成")
    expect(await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "merge-target")).all()).toHaveLength(1)
    expect(await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "merge-source")).all()).toHaveLength(0)
  })

  test("删除被引用条目的计划不会执行", async () => {
    const { db, tool } = await hooks()
    await insertEntry({ id: "referenced", content: "" })
    await db.insert(EntityRefTable).values({
      id: "ref-1",
      novel_id: "novel-reorg",
      source_type: "chapter",
      source_id: "chapter-1",
      target_type: "world_entry",
      target_id: "referenced",
      ref_field: "content",
      ref_text: "引用片段",
    })
    const plan = JSON.stringify({ version: 1, operations: [{ action: "delete", id: "referenced", reason: "清理空条目" }] })
    const result = await tool.organize_settings!.execute({ action: "apply", novel_id: "novel-reorg", plan_json: plan }, toolCtx())
    expect(result.output).toContain("仍被活跃引用")
    expect(await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "referenced")).all()).toHaveLength(1)
  })

  test("执行失败时停止后续操作", async () => {
    await seed()
    const plan = parseOrganizePlan(
      JSON.stringify({
        version: 1,
        operations: [
          { action: "update", id: "missing", fields: { title: "新标题" }, reason: "触发失败" },
          { action: "delete", id: "missing", reason: "不应执行" },
        ],
      }),
    )
    const execution = await executeOrganizePlan(plan.plan!, { directory: projectDir, novelId: "novel-reorg" })
    expect(execution.ok).toBe(false)
    expect(execution.results[0]!.status).toBe("failed")
  })
})

describe("director organization prompt", () => {
  test("tool description 约束整理流程与确认", async () => {
    const { tool } = await hooks()
    const description = tool.organize_settings!.description
    expect(description).toContain("analyze")
    expect(description).toContain("dry_run")
    expect(description).toContain("请求用户确认")
    expect(description).toContain("analyze 复查")
    expect(description).toContain("不跳过确认")
  })

  test("约束完整流程、确认和禁止自动删除", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain('organize_settings(action="analyze")')
    expect(prompt).toContain('organize_settings(action="dry_run")')
    expect(prompt).toContain("等待用户明确确认")
    expect(prompt).toContain("禁止虚构 ID")
    expect(prompt).toContain("禁止自动删除相似标题条目")
  })
})
