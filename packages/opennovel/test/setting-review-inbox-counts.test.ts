/**
 * setting-review-inbox countsOf 徽标过滤测试（pending-setting-tool-usability 5.1）。
 *
 * 验证 counts() 只统计 pending 状态的候选，accepted/rejected/merged 不计入徽标。
 * 使用真实 SQLite 临时数据库，不 mock。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  getDb,
  NovelTable,
  PendingSettingTable,
} from "@opennovel-ai/plugin/novel-writer/session-store"
import { createSettingReviewInboxService } from "../src/setting-review-inbox"

let projectDir: string
let novelId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `inbox-counts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

async function insertCandidates() {
  novelId = crypto.randomUUID()
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "徽标测试小说", genre: "玄幻", created_at: 1, updated_at: 1 })
    .run()
  const statuses = ["pending", "pending", "pending", "accepted", "accepted", "accepted", "accepted", "accepted", "rejected", "rejected", "merged"]
  for (const status of statuses) {
    await db
      .insert(PendingSettingTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        candidate_type: "character",
        display_title: `角色-${status}-${crypto.randomUUID().slice(0, 6)}`,
        payload_json: JSON.stringify({ name: `角色-${status}`, description: "" }),
        status,
        created_at: Date.now(),
      })
      .run()
  }
}

describe("countsOf 徽标过滤", () => {
  test("徽标只计 pending 候选，已处理不计入", async () => {
    await insertCandidates()
    const service = createSettingReviewInboxService()
    const counts = await service.counts(novelId, projectDir)
    expect(counts.candidates).toBe(3)
    expect(counts.total).toBe(3)
  })

  test("接受后徽标递减", async () => {
    await insertCandidates()
    const db = getDb(projectDir)
    const pendingRows = db.select().from(PendingSettingTable).all()
    const firstPending = pendingRows.find((row) => row.status === "pending" && row.novel_id === novelId)
    expect(firstPending).toBeDefined()
    if (!firstPending) return
    db
      .update(PendingSettingTable)
      .set({ status: "accepted", resolved_at: Date.now() })
      .where(eq(PendingSettingTable.id, firstPending.id))
      .run()
    // 直接验证 DB 内的 pending 计数
    const afterUpdate = db.select().from(PendingSettingTable).all()
    const pendingCount = afterUpdate.filter((row) => row.status === "pending" && row.novel_id === novelId).length
    expect(pendingCount).toBe(2)
    const service = createSettingReviewInboxService()
    const counts = await service.counts(novelId, projectDir)
    expect(counts.candidates).toBe(2)
    expect(counts.total).toBe(2)
  })
})
