/**
 * 设定影响面写作门禁集成测试：验证 pending_updates 存在时阻断正文写入。
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { closeDb, getDb, ChapterTable, NovelTable, PendingUpdateTable, WorldEntryTable } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

const testDir = join(tmpdir(), `setting-impact-gate-${Date.now()}`)
let hooks: NonNullable<Awaited<ReturnType<typeof NovelWriterPlugin>>["tool"]>

const ctx: ToolContext = {
  sessionID: "ses-impact-gate",
  messageID: "msg_test",
  agent: "writer",
  directory: testDir,
  worktree: testDir,
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  const db = getDb(testDir)
  await db.insert(NovelTable).values({ id: "novel-gate", title: "门禁测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  await db.insert(WorldEntryTable).values({ id: "world-gate", novel_id: "novel-gate", category: "力量体系", title: "剑气九重", content: "剑修境界分九重。" }).run()
  await db.insert(ChapterTable).values({ id: "chapter-gate", novel_id: "novel-gate", title: "第一章", content: "已有正文。", word_count: 5, status: "drafted", order: 1 }).run()
  await db.insert(PendingUpdateTable).values({
    id: "pending-gate",
    novel_id: "novel-gate",
    source_type: "chapter",
    source_id: "chapter-gate",
    trigger_type: "character",
    trigger_id: "char-gate",
    trigger_field: "name",
    old_value: "旧名",
    new_value: "新名",
    reason: "角色改名",
    status: "pending",
    priority: "high",
  }).run()
  const plugin = await NovelWriterPlugin(createPluginInput(testDir))
  hooks = plugin.tool!
})

afterAll(() => {
  closeDb()
  try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
})

describe("设定影响面写作门禁", () => {
  test("write_chapter 被 pending 任务阻断并提示待处理数量", async () => {
    const result = await hooks.write_chapter!.execute(
      { chapter_id: "chapter-gate", content: "第一章正文" },
      ctx,
    )
    expect(result.output).toContain("1 个未完成影响任务")
    expect(result.output).toContain("高优先级 1 个")
    expect(result.output).toContain("cascade_list_pending")
  })

  test("revise_chapter 被 pending 任务阻断", async () => {
    const result = await hooks.revise_chapter!.execute(
      { chapter_id: "chapter-gate", revision: "修订正文" },
      ctx,
    )
    expect(result.output).toContain("1 个未完成影响任务")
  })
})
