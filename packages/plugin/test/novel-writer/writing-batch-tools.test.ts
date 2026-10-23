/**
 * 批量写作工具落库测试（agent-background-job-recovery D3）。
 *
 * 覆盖：
 * 1. begin_writing_batch 持久化批量记录并绑定发起会话（ctx.sessionID）；
 *    同书重复 begin 整体替换旧记录（一书一批量）。
 * 2. advance_chapter 同步推进持久化进度：单调 max、同章重复调用不重复计数（幂等）。
 * 3. 无 running 批量时 advance_chapter 静默跳过，输出不带批量进度后缀。
 * 4. 推进至末章自动转 completed，此后 advance 不再改写。
 * 5. 参数校验：非整数或小于 1 的起始章/总数被拒绝。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { getDb, getWritingBatch, NovelTable } from "../../src/novel-writer/session-store.js"
import type { ToolResult } from "../../src/v2/effect/tool.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

const NOVEL = "novel-batch"
const SESSION = "ses-batch-origin"

let projectDir: string

beforeEach(async () => {
  projectDir = join(tmpdir(), `writing-batch-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  await getDb(projectDir)
    .insert(NovelTable)
    .values({ id: NOVEL, title: "批量书", genre: "玄幻", created_at: 1, updated_at: 1 })
    .run()
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function outputOf(result: ToolResult): string {
  return typeof result === "string" ? result : result.output
}

const tools = () => createWritingTools()
const ctx = () => createToolContext(projectDir, { sessionID: SESSION })

describe("begin_writing_batch 登记", () => {
  test("落库批量记录并绑定发起会话", async () => {
    const result = await tools().begin_writing_batch.execute(
      { novel_id: NOVEL, start_chapter: 3, total: 5 },
      ctx(),
    )

    expect(outputOf(result)).toContain("第3章起共5章")
    const batch = await getWritingBatch(NOVEL, projectDir)
    expect(batch).toMatchObject({
      novel_id: NOVEL,
      session_id: SESSION,
      start_chapter: 3,
      total: 5,
      status: "running",
    })
    expect(batch!.last_completed_chapter).toBeNull()
  })

  test("同书重复登记整体替换旧记录", async () => {
    await tools().begin_writing_batch.execute({ novel_id: NOVEL, start_chapter: 1, total: 3 }, ctx())
    await tools().begin_writing_batch.execute(
      { novel_id: NOVEL, start_chapter: 7, total: 2 },
      createToolContext(projectDir, { sessionID: "ses-batch-restart" }),
    )

    const batch = await getWritingBatch(NOVEL, projectDir)
    expect(batch).toMatchObject({
      session_id: "ses-batch-restart",
      start_chapter: 7,
      total: 2,
      status: "running",
    })
  })

  test("起始章或总数非法时拒绝登记", async () => {
    const badStart = await tools().begin_writing_batch.execute(
      { novel_id: NOVEL, start_chapter: 0, total: 3 },
      ctx(),
    )
    expect(outputOf(badStart)).toContain("起始章序号无效")

    const badTotal = await tools().begin_writing_batch.execute(
      { novel_id: NOVEL, start_chapter: 1, total: 1.5 },
      ctx(),
    )
    expect(outputOf(badTotal)).toContain("批量总章数无效")
    expect(await getWritingBatch(NOVEL, projectDir)).toBeUndefined()
  })
})

describe("advance_chapter 落库幂等", () => {
  test("推进持久化进度且同章重复调用不重复计数", async () => {
    await tools().begin_writing_batch.execute({ novel_id: NOVEL, start_chapter: 1, total: 3 }, ctx())

    const first = await tools().advance_chapter.execute({ novel_id: NOVEL, chapter_number: 1 }, ctx())
    expect(outputOf(first)).toContain("下一章为第2章")
    expect(outputOf(first)).toContain("（批量进度 1/3）")

    // 重跑幂等：同章再次推进不重复计数
    const replay = await tools().advance_chapter.execute({ novel_id: NOVEL, chapter_number: 1 }, ctx())
    expect(outputOf(replay)).toContain("（批量进度 1/3）")

    const batch = await getWritingBatch(NOVEL, projectDir)
    expect(batch!.last_completed_chapter).toBe(1)
    expect(batch!.status).toBe("running")
  })

  test("推进至末章自动转 completed 且此后不再改写", async () => {
    await tools().begin_writing_batch.execute({ novel_id: NOVEL, start_chapter: 1, total: 2 }, ctx())
    await tools().advance_chapter.execute({ novel_id: NOVEL, chapter_number: 1 }, ctx())

    const last = await tools().advance_chapter.execute({ novel_id: NOVEL, chapter_number: 2 }, ctx())
    expect(outputOf(last)).toContain("（批量进度 2/2）")

    const done = await getWritingBatch(NOVEL, projectDir)
    expect(done!.status).toBe("completed")

    // 终态后重复推进不改写记录
    const updatedAt = done!.updated_at
    await tools().advance_chapter.execute({ novel_id: NOVEL, chapter_number: 2 }, ctx())
    const after = await getWritingBatch(NOVEL, projectDir)
    expect(after!.status).toBe("completed")
    expect(after!.updated_at).toBe(updatedAt)
  })

  test("无批量记录时静默跳过，输出不带批量进度", async () => {
    const result = await tools().advance_chapter.execute({ novel_id: NOVEL, chapter_number: 4 }, ctx())

    expect(outputOf(result)).toBe("流水线完成，下一章为第5章")
    expect(await getWritingBatch(NOVEL, projectDir)).toBeUndefined()
  })
})
