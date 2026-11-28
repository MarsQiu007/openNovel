/**
 * 章节清理修订提案工具测试（chapter-cleanup-review · tasks 3.3）
 *
 * 覆盖：
 * - propose_cleanup：绑定会话落库成功、校验拒绝整批不落库、未绑定会话报 not_found
 * - list_cleanup：计数与明细输出、按状态过滤
 * - director 导入整理指令含 propose_cleanup 落库与 list_cleanup 汇总要求
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  getDb,
  NovelTable,
  SessionNovelTable,
  ChapterTable,
  ChapterCleanupProposalTable,
  tagNovelSession,
  createChapter,
} from "../../src/novel-writer/session-store.js"
import type { ToolResult } from "../../src/v2/effect/tool.js"
import type { SessionDomain } from "../../src/v2/effect/session.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

const SESSION_ID = "ses-cleanup-tools"

let projectDir: string
let novelId: string
let chapterId: string

const CONTENT = "他说道：“今天天气不错。”\n这是一段完全正常的内容。\n他昨天的昨候就到了。\n　　本章节由爬虫自动生成免责声明。"

beforeEach(async () => {
  projectDir = join(tmpdir(), `cleanup-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = "novel-cleanup"
  await db.insert(NovelTable).values({ id: novelId, title: "清理测试书", genre: "玄幻", created_at: 1, updated_at: 1 }).run()
  // 第二本无绑定书：避免单书目录触发「恰好一本小说」懒绑定短路，未绑定会话才能稳定报 not_found
  await db.insert(NovelTable).values({ id: "novel-other", title: "另一本书", genre: "科幻", created_at: 1, updated_at: 1 }).run()
  await tagNovelSession(SESSION_ID, novelId, projectDir)
  chapterId = (await createChapter(novelId, "第一章", 1, null, projectDir)).id
  await db.update(ChapterTable).set({ content: CONTENT }).where(eq(ChapterTable.id, chapterId)).run()
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function sessionStub(): SessionDomain {
  return { get: async (id) => ({ id, parentID: undefined }) }
}

function toolCtx() {
  return createToolContext(projectDir, { sessionID: SESSION_ID, messageID: "msg_cleanup", agent: "director" })
}

function outputOf(result: ToolResult): string {
  return typeof result === "string" ? result : result.output
}

const validProposal = {
  kind: "typo_replace" as const,
  paragraph_index: 2,
  start_offset: 4,
  end_offset: 6,
  quote: "昨候",
  replacement: "时候",
  reason: "错别字",
  confidence: 0.98,
}

describe("propose_cleanup 工具", () => {
  test("合法提案批量落库为待审状态，正文不变", async () => {
    const tools = createWritingTools(sessionStub())
    const result = await tools.propose_cleanup.execute(
      { chapter_id: chapterId, proposals: [validProposal] },
      toolCtx(),
    )
    expect(outputOf(result)).toContain("1 条修订提案")
    const rows = getDb(projectDir).select().from(ChapterCleanupProposalTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("pending")
    expect(getDb(projectDir).select({ content: ChapterTable.content }).from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!.content).toBe(CONTENT)
  })

  test("校验拒绝整批不落库", async () => {
    const tools = createWritingTools(sessionStub())
    const err = await tools.propose_cleanup
      .execute(
        {
          chapter_id: chapterId,
          proposals: [validProposal, { ...validProposal, kind: "rewrite_all" as never }],
        },
        toolCtx(),
      )
      .then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    expect(String(err)).toContain("修订提案校验失败")
    const rows = getDb(projectDir).select().from(ChapterCleanupProposalTable).all()
    expect(rows).toHaveLength(0)
  })

  test("未绑定会话报 not_found", async () => {
    const unbound = "ses-cleanup-unbound"
    const tools = createWritingTools(sessionStub())
    const err = await tools.propose_cleanup
      .execute({ chapter_id: chapterId, proposals: [validProposal] }, createToolContext(projectDir, { sessionID: unbound, messageID: "msg", agent: "director" }))
      .then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    expect(String(err)).toContain("未找到当前小说项目")
  })
})

describe("list_cleanup 工具", () => {
  test("落库后计数与明细可见，按状态过滤生效", async () => {
    const tools = createWritingTools(sessionStub())
    await tools.propose_cleanup.execute({ chapter_id: chapterId, proposals: [validProposal] }, toolCtx())
    const listed = outputOf(await tools.list_cleanup.execute({}, toolCtx()))
    expect(listed).toContain("pending=1")
    expect(listed).toContain("昨候")
    const filtered = outputOf(await tools.list_cleanup.execute({ status: "applied" }, toolCtx()))
    expect(filtered).toContain("无修订提案记录")
  })
})

describe("director 指令", () => {
  test("导入整理流程含 propose_cleanup 落库与 list_cleanup 汇总要求", async () => {
    const text = await Bun.file(new URL("../../src/novel-writer/agents/director.ts", import.meta.url)).text()
    expect(text).toContain("propose_cleanup")
    expect(text).toContain("list_cleanup")
    expect(text).toContain("清理修订")
    expect(text).toContain("禁止直改章节正文")
  })
})
