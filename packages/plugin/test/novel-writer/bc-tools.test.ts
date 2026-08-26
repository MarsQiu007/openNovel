/**
 * B/C 阶段 agent 工具测试
 *
 * 验证 plan_story_arc / record_arc_beat / review_volume / editorial_review /
 * annotate_chapter / list_annotations / resolve_annotation / polish_paragraph /
 * read_outline_canvas / write_outline_canvas 的端到端流程。
 */
import { eq } from "drizzle-orm"
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { getDb, NovelTable, VolumeTable, ChapterTable, CharacterTable } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string
const SESSION_ID = "ses-bc-test"

beforeEach(() => {
  projectDir = join(tmpdir(), `bc-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function toolCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: SESSION_ID,
    messageID: "msg_test",
    agent: "director",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
    ...overrides,
  }
}

async function setupNovel() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-bc", title: "BC测试", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
  await db
    .insert(VolumeTable)
    .values({ id: "vol-1", novel_id: "novel-bc", title: "第一卷", summary: "", order: 1, created_at: 1 })
    .run()
  await db
    .insert(ChapterTable)
    .values({
      id: "ch-1",
      novel_id: "novel-bc",
      volume_id: "vol-1",
      title: "第一章",
      content: "段落一原文\n\n段落二原文\n\n段落三原文",
      word_count: 12,
      status: "draft",
      order: 1,
      created_at: 1,
      updated_at: 1,
    })
    .run()
  await db
    .insert(CharacterTable)
    .values({ id: "char-1", novel_id: "novel-bc", name: "主角", role: "protagonist", description: "", status: "active" })
    .run()
  // Bind session to novel
  const { tagNovelSession } = await import("../../src/novel-writer/session-store.js")
  await tagNovelSession(SESSION_ID, "novel-bc", projectDir)
}

async function getHooks() {
  return NovelWriterPlugin(createPluginInput(projectDir))
}

describe("B/C tools", () => {
  test("plan_story_arc 创建结构线", async () => {
    await setupNovel()
    const hooks = await getHooks()
    const result = await hooks.tool!.plan_story_arc!.execute(
      { action: "create", arc_type: "narrative", title: "主线", summary: "主角成长", status: "active", planned_start_chapter: 1, planned_end_chapter: 50 },
      toolCtx(),
    )
    expect(result).toMatchObject({ title: "plan_story_arc" })
    const meta = "metadata" in result ? result.metadata : undefined
    expect(meta?.arc_id).toBeDefined()
    expect(meta?.arc_type).toBe("narrative")
  })

  test("plan_story_arc 角色弧接受角色名并解析为角色 ID", async () => {
    await setupNovel()
    const hooks = await getHooks()
    // 传入角色名而非 UUID，工具应自动解析，避免外键约束失败
    const result = await hooks.tool!.plan_story_arc!.execute(
      { action: "create", arc_type: "character", title: "主角成长弧", target_character_id: "主角" },
      toolCtx(),
    )
    expect(result).toMatchObject({ title: "plan_story_arc" })
    const arcId = ("metadata" in result ? result.metadata : {})?.arc_id as string
    const db = getDb(projectDir)
    const { StoryArcTable } = await import("../../src/novel-writer/session-store.js")
    const arc = db.select().from(StoryArcTable).where(eq(StoryArcTable.id, arcId)).get()!
    expect(arc.target_character_id).toBe("char-1")
  })

  test("plan_story_arc 角色弧引用不存在的角色名时返回清晰错误", async () => {
    await setupNovel()
    const hooks = await getHooks()
    const result = await hooks.tool!.plan_story_arc!.execute(
      { action: "create", arc_type: "character", title: "弧光", target_character_id: "林小满" },
      toolCtx(),
    )
    expect(result.output).toContain("未找到角色")
    expect(result.output).toContain("林小满")
  })

  test("record_arc_beat 创建节点", async () => {
    await setupNovel()
    const hooks = await getHooks()
    const arcResult = await hooks.tool!.plan_story_arc!.execute(
      { action: "create", arc_type: "narrative", title: "主线" },
      toolCtx(),
    )
    const arcId = ("metadata" in arcResult ? arcResult.metadata : {})?.arc_id as string
    const beatResult = await hooks.tool!.record_arc_beat!.execute(
      { action: "create", arc_id: arcId, label: "开场", kind: "setup", chapter_order: 1, summary: "引入主角" },
      toolCtx(),
    )
    expect(beatResult).toMatchObject({ title: "record_arc_beat" })
    const meta = "metadata" in beatResult ? beatResult.metadata : undefined
    expect(meta?.kind).toBe("setup")
  })

  test("editorial_review 运行结构检查并保存报告", async () => {
    await setupNovel()
    const hooks = await getHooks()
    // Create an arc without climax that reaches planned end
    await hooks.tool!.plan_story_arc!.execute(
      { action: "create", arc_type: "narrative", title: "主线", planned_end_chapter: 1 },
      toolCtx(),
    )
    const result = await hooks.tool!.editorial_review!.execute({}, toolCtx())
    expect(result).toMatchObject({ title: "editorial_review" })
    const meta = "metadata" in result ? result.metadata : undefined
    expect(meta?.issue_count).toBeGreaterThanOrEqual(0)
    expect(meta?.report_id).toBeDefined()
  })

  test("annotate_chapter + list_annotations 批注流程", async () => {
    await setupNovel()
    const hooks = await getHooks()
    await hooks.tool!.annotate_chapter!.execute(
      { chapter_id: "ch-1", source: "user", paragraph_index: 0, quote: "段落一原文", comment: "需要加强冲突" },
      toolCtx(),
    )
    const listResult = await hooks.tool!.list_annotations!.execute({ chapter_id: "ch-1" }, toolCtx())
    const meta = "metadata" in listResult ? listResult.metadata : undefined
    expect(meta?.total).toBe(1)
    expect(meta?.annotations[0].comment).toBe("需要加强冲突")
  })

  test("resolve_annotation 标记批注状态", async () => {
    await setupNovel()
    const hooks = await getHooks()
    await hooks.tool!.annotate_chapter!.execute(
      { chapter_id: "ch-1", source: "user", paragraph_index: 1, quote: "段落二", comment: "检查" },
      toolCtx(),
    )
    const listResult = await hooks.tool!.list_annotations!.execute({ chapter_id: "ch-1" }, toolCtx())
    const annId = ("metadata" in listResult ? listResult.metadata : {})?.annotations[0].id as string
    const resolveResult = await hooks.tool!.resolve_annotation!.execute(
      { annotation_id: annId, status: "resolved" },
      toolCtx(),
    )
    expect(resolveResult).toMatchObject({ title: "resolve_annotation" })
    const resolved = await hooks.tool!.list_annotations!.execute({ chapter_id: "ch-1", status: "resolved" }, toolCtx())
    expect(("metadata" in resolved ? resolved.metadata : {})?.total).toBe(1)
  })

  test("polish_paragraph 生成润色建议", async () => {
    await setupNovel()
    const hooks = await getHooks()
    const result = await hooks.tool!.polish_paragraph!.execute(
      { chapter_id: "ch-1", paragraph_index: 0, comment: "更紧凑", suggested_replacement: "改写后的段落一" },
      toolCtx(),
    )
    const meta = "metadata" in result ? result.metadata : undefined
    expect(meta?.annotation_id).toBeDefined()
    expect(meta?.quote).toBe("段落一原文")
  })

  test("read/write_outline_canvas 画布布局读写", async () => {
    await setupNovel()
    const hooks = await getHooks()
    const writeResult = await hooks.tool!.write_outline_canvas!.execute(
      { layout: JSON.stringify({ columns: [{ id: "vol-1", x: 0, width: 300 }], cards: [{ id: "ch-1", x: 0, y: 0, columnId: "vol-1" }], viewport: { x: 0, y: 0, zoom: 1 } }) },
      toolCtx(),
    )
    expect(writeResult).toMatchObject({ title: "write_outline_canvas" })

    const readResult = await hooks.tool!.read_outline_canvas!.execute({}, toolCtx())
    const meta = "metadata" in readResult ? readResult.metadata : undefined
    expect(meta?.layout.columns).toHaveLength(1)
    expect(meta?.layout.cards).toHaveLength(1)
  })

  test("review_volume 卷末复盘", async () => {
    await setupNovel()
    const hooks = await getHooks()
    const result = await hooks.tool!.review_volume!.execute(
      { volume_id: "vol-1", overall: "结构完整", score: 8, strengths: ["节奏好"], weaknesses: ["配角薄"], open_threads: ["谜题"], recommendations: ["深化配角"] },
      toolCtx(),
    )
    const meta = "metadata" in result ? result.metadata : undefined
    expect(meta?.round).toBe(1)
    expect(meta?.score).toBe(8)
  })
})