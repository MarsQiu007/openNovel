/**
 * 设定批注 agent 工具测试
 *
 * 覆盖 annotate_setting / list_setting_annotations /
 * resolve_setting_annotation / report_setting_annotation_execution 的真实锚点、
 * 状态筛选、错误路径和描述历史关联。
 */
import { eq } from "drizzle-orm"
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import {
  getDb,
  NovelTable,
  WorldEntryTable,
  WorldEntryAnnotationTable,
  DescriptionHistoryTable,
  createWorldEntryAnnotationRound,
  getWorldEntryAnnotationRounds,
} from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string
const SESSION_ID = "ses-setting-annotation"

beforeEach(() => {
  projectDir = join(tmpdir(), `setting-annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
    sessionID: SESSION_ID,
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
  await db.insert(NovelTable).values({
    id: "novel-annotation",
    title: "设定批注测试",
    genre: "玄幻",
    synopsis: "",
    status: "draft",
    created_at: 1,
    updated_at: 1,
  }).run()
  await db.insert(WorldEntryTable).values({
    id: "world-old-city",
    novel_id: "novel-annotation",
    category: "地点",
    title: "旧城",
    content: "城墙很高。\n\n城内禁卫森严。",
    created_at: 1,
  }).run()
  const { tagNovelSession } = await import("../../src/novel-writer/session-store.js")
  await tagNovelSession(SESSION_ID, "novel-annotation", projectDir)
  const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
  return { db, hooks: hooks.tool! }
}

describe("setting annotation tools", () => {
  test("annotate_setting 使用真实条目和锚点创建批注", async () => {
    const { hooks } = await seed()
    const result = await hooks.annotate_setting!.execute(
      {
        entry_id: "world-old-city",
        paragraph_index: 0,
        start_offset: 0,
        end_offset: 5,
        quote: "城墙很高。",
        comment: "强调城墙的压迫感",
      },
      toolCtx(),
    )
    expect(result).toMatchObject({ title: "annotate_setting", output: "已创建设定批注" })
    const meta = "metadata" in result ? result.metadata : undefined
    expect(meta?.world_entry_id).toBe("world-old-city")
    expect(meta?.status).toBe("open")
  })

  test("annotate_setting 拒绝非原文引用和不存在的条目", async () => {
    const { hooks } = await seed()
    const badQuote = await hooks.annotate_setting!.execute(
      { entry_id: "world-old-city", quote: "城墙不高", comment: "错误锚点" },
      toolCtx(),
    )
    expect(badQuote.output).toContain("quote 不是当前")
    const missing = await hooks.annotate_setting!.execute(
      { entry_id: "world-missing", quote: "城墙很高。", comment: "错误条目" },
      toolCtx(),
    )
    expect(missing.output).toContain("world_entry 不存在")
  })

  test("annotate_setting 支持跨段锚点并落库 end_paragraph_index", async () => {
    const { hooks } = await seed()
    const result = await hooks.annotate_setting!.execute(
      {
        entry_id: "world-old-city",
        anchor_type: "paragraph",
        paragraph_index: 0,
        start_offset: 2,
        end_offset: 2,
        end_paragraph_index: 1,
        quote: "很高。\n\n城内",
        comment: "城墙与禁卫的描写需要统一基调",
      },
      toolCtx(),
    )
    const meta = "metadata" in result ? result.metadata : undefined
    expect(result.output).toBe("已创建设定批注")
    expect(meta?.end_paragraph_index).toBe(1)

    const db = getDb(projectDir)
    const row = await db
      .select()
      .from(WorldEntryAnnotationTable)
      .where(eq(WorldEntryAnnotationTable.id, meta?.annotation_id as string))
      .get()
    expect(row?.end_paragraph_index).toBe(1)
    expect(row?.end_offset).toBe(2)
  })

  test("annotate_setting 拒绝结束段落索引小于起始段落索引", async () => {
    const { hooks } = await seed()
    const result = await hooks.annotate_setting!.execute(
      {
        entry_id: "world-old-city",
        paragraph_index: 1,
        start_offset: 0,
        end_offset: 2,
        end_paragraph_index: 0,
        quote: "城内",
        comment: "倒挂区间",
      },
      toolCtx(),
    )
    expect(result.output).toBe("段落索引或偏移量与原文不一致")
  })

  test("annotate_setting 拒绝结束段落索引越界", async () => {
    const { hooks } = await seed()
    const result = await hooks.annotate_setting!.execute(
      {
        entry_id: "world-old-city",
        paragraph_index: 0,
        start_offset: 0,
        end_offset: 2,
        end_paragraph_index: 9,
        quote: "城墙很高。",
        comment: "越界区间",
      },
      toolCtx(),
    )
    expect(result.output).toBe("段落索引或偏移量与原文不一致")
  })

  test("annotate_setting 拒绝跨段引用与原文不一致", async () => {
    const { hooks } = await seed()
    const result = await hooks.annotate_setting!.execute(
      {
        entry_id: "world-old-city",
        paragraph_index: 0,
        start_offset: 2,
        end_offset: 2,
        end_paragraph_index: 1,
        quote: "很高。\n\n皇宫",
        comment: "引用不匹配",
      },
      toolCtx(),
    )
    // 严格 includes 检查先拦截（"皇宫"不在原文中）
    expect(result.output).toBe("quote 不是当前 world_entry 原文中的精确片段")
  })

  test("list_setting_annotations 支持状态筛选", async () => {
    const { hooks } = await seed()
    const created = await hooks.annotate_setting!.execute(
      { entry_id: "world-old-city", quote: "城墙很高。", comment: "强化描写" },
      toolCtx(),
    )
    const annotationId = ("metadata" in created ? created.metadata : {})?.annotation_id as string
    const open = await hooks.list_setting_annotations!.execute(
      { entry_id: "world-old-city", status: "open" },
      toolCtx(),
    )
    const openRows = (open.metadata as any).annotations
    expect(openRows).toHaveLength(1)
    expect(openRows[0].id).toBe(annotationId)
    expect(openRows[0].quote).toBe("城墙很高。")

    await hooks.resolve_setting_annotation!.execute({ annotation_id: annotationId, status: "wontfix" }, toolCtx())
    const resolved = await hooks.list_setting_annotations!.execute(
      { entry_id: "world-old-city", status: "wontfix" },
      toolCtx(),
    )
    const resolvedRows = (resolved.metadata as any).annotations
    expect(resolvedRows).toHaveLength(1)
    expect(resolvedRows[0].status).toBe("wontfix")
  })

  test("report_setting_annotation_execution 成功后关联最近描述历史", async () => {
    const { db, hooks } = await seed()
    const round = await createWorldEntryAnnotationRound(
      {
        novel_id: "novel-annotation",
        world_entry_id: "world-old-city",
        prompt_snapshot: "prompt",
        annotations_snapshot: "[]",
        result_summary: "",
      },
      projectDir,
    )
    await db.insert(DescriptionHistoryTable).values({
      id: "history-old",
      novel_id: "novel-annotation",
      entity_type: "world_entry",
      entity_id: "world-old-city",
      field: "content",
      old_value: "旧内容",
      new_value: "新内容",
      created_at: 1,
    }).run()
    await db.insert(DescriptionHistoryTable).values({
      id: "history-new",
      novel_id: "novel-annotation",
      entity_type: "world_entry",
      entity_id: "world-old-city",
      field: "content",
      old_value: "新内容",
      new_value: "最新内容",
      created_at: 2,
    }).run()

    const result = await hooks.report_setting_annotation_execution!.execute(
      { execution_round_id: round.id, status: "completed", result_summary: "已按批注修改" },
      toolCtx(),
    )
    expect(result.output).toContain("completed")
    const rounds = await getWorldEntryAnnotationRounds("world-old-city", projectDir)
    expect(rounds[0].status).toBe("completed")
    expect(rounds[0].content_history_id).toBe("history-new")
  })

  test("completed 回填缺少描述历史时被拒绝", async () => {
    const { hooks } = await seed()
    const round = await createWorldEntryAnnotationRound(
      {
        novel_id: "novel-annotation",
        world_entry_id: "world-old-city",
        prompt_snapshot: "prompt",
        annotations_snapshot: "[]",
        result_summary: "",
      },
      projectDir,
    )
    const result = await hooks.report_setting_annotation_execution!.execute(
      { execution_round_id: round.id, status: "completed", result_summary: "声称完成" },
      toolCtx(),
    )
    expect(result.output).toContain("completed 需要存在")
  })

  test("report_setting_annotation_execution 拒绝不存在的轮次", async () => {
    const { hooks } = await seed()
    const result = await hooks.report_setting_annotation_execution!.execute(
      { execution_round_id: "wear-missing", status: "failed", result_summary: "错误轮次" },
      toolCtx(),
    )
    expect(result.output).toBe("设定批注执行轮次不存在")
  })
})