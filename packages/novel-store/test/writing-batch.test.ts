/**
 * writing_batch 批量写作任务 CRUD 测试（agent-background-job-recovery）
 *
 * 断点续跑的持久化地基：
 * - begin 创建/整体替换 running 记录（一书一批量）
 * - advance 单调推进完成指针（重跑同章幂等、区间外不推进、末章转 completed）
 * - cancel 仅 running 可取消，终态不可逆
 * - writingBatchCompleted 派生边界
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  getDb,
  closeDb,
  NovelTable,
  beginWritingBatch,
  advanceWritingBatch,
  cancelWritingBatch,
  getWritingBatch,
  writingBatchCompleted,
} from "../src/index.js"

let projectDir: string

beforeEach(async () => {
  projectDir = join(tmpdir(), `writing-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  await getDb(projectDir)
    .insert(NovelTable)
    .values({ id: "novel-1", title: "测试书", genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败，进程退出后系统会回收临时文件
  }
})

const beginInput = { novelId: "novel-1", sessionId: "ses_director", startChapter: 1, total: 10 }

describe("beginWritingBatch", () => {
  test("创建 running 记录，完成指针为空", async () => {
    await beginWritingBatch(beginInput, projectDir)
    const batch = await getWritingBatch("novel-1", projectDir)
    expect(batch).toMatchObject({
      novel_id: "novel-1",
      session_id: "ses_director",
      start_chapter: 1,
      total: 10,
      last_completed_chapter: null,
      status: "running",
    })
    expect(writingBatchCompleted(batch!)).toBe(0)
  })

  test("同书新批量整体替换旧记录（含终态）", async () => {
    await beginWritingBatch(beginInput, projectDir)
    await advanceWritingBatch("novel-1", 1, projectDir)
    await beginWritingBatch({ ...beginInput, sessionId: "ses_new", startChapter: 5, total: 3 }, projectDir)
    const batch = await getWritingBatch("novel-1", projectDir)
    expect(batch).toMatchObject({ session_id: "ses_new", start_chapter: 5, total: 3, last_completed_chapter: null, status: "running" })
  })
})

describe("advanceWritingBatch", () => {
  test("单调推进：重跑同章幂等、乱序取 max", async () => {
    await beginWritingBatch(beginInput, projectDir)
    await advanceWritingBatch("novel-1", 3, projectDir)
    await advanceWritingBatch("novel-1", 3, projectDir)
    await advanceWritingBatch("novel-1", 2, projectDir)
    const batch = await getWritingBatch("novel-1", projectDir)
    expect(batch!.last_completed_chapter).toBe(3)
    expect(writingBatchCompleted(batch!)).toBe(3)
    expect(batch!.status).toBe("running")
  })

  test("批量区间外的章节完成不推进指针", async () => {
    await beginWritingBatch(beginInput, projectDir)
    await advanceWritingBatch("novel-1", 15, projectDir)
    await advanceWritingBatch("novel-1", 0, projectDir)
    const batch = await getWritingBatch("novel-1", projectDir)
    expect(batch!.last_completed_chapter).toBeNull()
    expect(batch!.status).toBe("running")
  })

  test("无 running 记录时静默跳过（单章写作场景）", async () => {
    await advanceWritingBatch("novel-1", 1, projectDir)
    expect(await getWritingBatch("novel-1", projectDir)).toBeUndefined()
  })

  test("末章到达转 completed，此后 advance 不再变化", async () => {
    await beginWritingBatch({ ...beginInput, total: 2 }, projectDir)
    await advanceWritingBatch("novel-1", 1, projectDir)
    await advanceWritingBatch("novel-1", 2, projectDir)
    const done = await getWritingBatch("novel-1", projectDir)
    expect(done!.status).toBe("completed")
    expect(writingBatchCompleted(done!)).toBe(2)
    await advanceWritingBatch("novel-1", 2, projectDir)
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("completed")
  })
})

describe("cancelWritingBatch", () => {
  test("running 可取消", async () => {
    await beginWritingBatch(beginInput, projectDir)
    await cancelWritingBatch("novel-1", projectDir)
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("cancelled")
  })

  test("终态不可逆：completed 不受 cancel 影响", async () => {
    await beginWritingBatch({ ...beginInput, total: 1 }, projectDir)
    await advanceWritingBatch("novel-1", 1, projectDir)
    await cancelWritingBatch("novel-1", projectDir)
    expect((await getWritingBatch("novel-1", projectDir))!.status).toBe("completed")
  })
})

describe("writingBatchCompleted", () => {
  test("空指针 0、部分完成按跨度、超出 total 截断", async () => {
    await beginWritingBatch({ ...beginInput, startChapter: 5, total: 3 }, projectDir)
    const empty = (await getWritingBatch("novel-1", projectDir))!
    expect(writingBatchCompleted(empty)).toBe(0)
    await advanceWritingBatch("novel-1", 6, projectDir)
    const partial = (await getWritingBatch("novel-1", projectDir))!
    expect(writingBatchCompleted(partial)).toBe(2)
    expect(writingBatchCompleted({ ...partial, last_completed_chapter: 99 })).toBe(3)
  })
})
