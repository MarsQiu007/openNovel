/**
 * 候选/冲突处理工具失败类别映射测试（tool-failure-semantics 4.1）。
 *
 * store 层 accept/reject/merge/resolveConflict 返回 { ok:false, error }（与 UI 端点
 * 共用，不能 throw）；工具层按稳定错误文案映射 D2 类别后抛出。本文件直接经工具
 * execute 验证类别映射与关键文案（not_found / state_conflict / param_error），
 * 含顺序敏感的跨书合并分支（不可落 state_conflict）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { WorldEntryTable } from "@opennovel-ai/novel-store"
import {
  getDb,
  NovelTable,
  PendingSettingTable,
  WorldEntryConflictTable,
} from "../../src/novel-writer/session-store.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `pending-tool-failure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // getDb 连接缓存持有 DB 文件，Windows 下尽力清理
  }
})

async function insertNovel(id: string, title: string) {
  await getDb(projectDir)
    .insert(NovelTable)
    .values({ id, title, genre: "玄幻", created_at: 1, updated_at: 1 })
    .run()
}

async function insertPendingNamed(novelId: string, status: string, name: string) {
  const id = crypto.randomUUID()
  await getDb(projectDir)
    .insert(PendingSettingTable)
    .values({
      id,
      novel_id: novelId,
      candidate_type: "character",
      display_title: name,
      payload_json: JSON.stringify({ name, description: "测试描述。" }),
      status,
      created_at: Date.now(),
    })
    .run()
  return id
}

async function insertPending(novelId: string, status: string) {
  const id = crypto.randomUUID()
  await getDb(projectDir)
    .insert(PendingSettingTable)
    .values({
      id,
      novel_id: novelId,
      candidate_type: "character",
      display_title: `候选-${id.slice(0, 6)}`,
      payload_json: JSON.stringify({ name: "测试角色", description: "测试描述。" }),
      status,
      created_at: Date.now(),
    })
    .run()
  return id
}

const tools = () => createWritingTools()
const ctx = () => createToolContext(projectDir, { sessionID: "ses-pending-failure", agent: "director" })

describe("pending 工具失败类别映射", () => {
  test("accept 不存在候选 → not_found", async () => {
    const err = await tools()
      .accept_pending_setting.execute({ pending_id: "no-such-id" }, ctx())
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("not_found")
    expect(err?.message).toContain("候选不存在")
  })

  test("accept 非 pending 状态 → state_conflict", async () => {
    await insertNovel("novel-pf", "映射书")
    const id = await insertPending("novel-pf", "accepted")
    const err = await tools()
      .accept_pending_setting.execute({ pending_id: id }, ctx())
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("state_conflict")
    expect(err?.message).toContain("不可接受")
  })

  test("reject 已拒绝候选重复拒绝 → state_conflict", async () => {
    await insertNovel("novel-pf", "映射书")
    const id = await insertPending("novel-pf", "rejected")
    const err = await tools()
      .reject_pending_setting.execute({ pending_id: id }, ctx())
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("state_conflict")
    expect(err?.message).toContain("不可拒绝")
  })

  test("merge 跨书候选 → param_error（先于 不可合并 的状态分支）", async () => {
    await insertNovel("novel-pf-a", "甲书")
    await insertNovel("novel-pf-b", "乙书")
    const idA = await insertPending("novel-pf-a", "pending")
    const idB = await insertPending("novel-pf-b", "pending")
    const err = await tools()
      .merge_pending_settings.execute({ pending_ids: [idA, idB] }, ctx())
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("param_error")
    expect(err?.message).toContain("不可跨书合并")
  })

  test("resolve_conflict revise_chapters 无受影响章节 → param_error", async () => {
    await insertNovel("novel-pf", "映射书")
    const db = getDb(projectDir)
    const entryId = crypto.randomUUID()
    db.insert(WorldEntryTable)
      .values({
        id: entryId,
        novel_id: "novel-pf",
        category: "地理",
        title: "映射雪原",
        content: "常年风雪。",
        created_at: Date.now(),
      })
      .run()
    const conflictId = crypto.randomUUID()
    db.insert(WorldEntryConflictTable)
      .values({
        id: conflictId,
        novel_id: "novel-pf",
        world_entry_id: entryId,
        conflict_kind: "semantic_conflict",
        conflict_note: "边界描述冲突",
        created_at: Date.now(),
      })
      .run()
    const err = await tools()
      .resolve_conflict.execute({ conflict_id: conflictId, action: "revise_chapters" }, ctx())
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("param_error")
    expect(err?.message).toContain("没有受影响的章节")
  })
})


describe("batch_accept_pending_settings 工具", () => {
  test("批量接受全部成功", async () => {
    await insertNovel("novel-batch-ok", "批量书")
    const id1 = await insertPendingNamed("novel-batch-ok", "pending", "批量角色一")
    const id2 = await insertPendingNamed("novel-batch-ok", "pending", "批量角色二")
    const id3 = await insertPendingNamed("novel-batch-ok", "pending", "批量角色三")
    const result = await tools().batch_accept_pending_settings.execute(
      { novel_id: "novel-batch-ok", pending_ids: [id1, id2, id3] },
      ctx(),
    )
    expect(result.metadata?.accepted).toBe(3)
    const results = result.metadata?.results as { ok: boolean }[]
    expect(results).toHaveLength(3)
    for (const r of results) expect(r.ok).toBe(true)
  })

  test("批量接受部分失败不回滚已成功的候选", async () => {
    await insertNovel("novel-batch-partial", "批量部分书")
    const id1 = await insertPendingNamed("novel-batch-partial", "pending", "部分角色一")
    const id2 = await insertPendingNamed("novel-batch-partial", "pending", "部分角色二")
    const id3 = "no-such-id"
    const result = await tools().batch_accept_pending_settings.execute(
      { novel_id: "novel-batch-partial", pending_ids: [id1, id2, id3] },
      ctx(),
    )
    expect(result.metadata?.accepted).toBe(2)
    const results = result.metadata?.results as { pending_id: string; ok: boolean }[]
    expect(results).toHaveLength(3)
    const failed = results.filter((r) => !r.ok)
    expect(failed).toHaveLength(1)
    expect(failed[0]?.pending_id).toBe(id3)
    // 已成功的候选状态应为 accepted
    const [row1] = await getDb(projectDir).select().from(PendingSettingTable).where(eq(PendingSettingTable.id, id1)).all()
    expect(row1?.status).toBe("accepted")
    const [row2] = await getDb(projectDir).select().from(PendingSettingTable).where(eq(PendingSettingTable.id, id2)).all()
    expect(row2?.status).toBe("accepted")
  })
})
