/**
 * cleaner 设定线索自动入库测试（narrative-unit-split 任务 3.3/3.4，design D5）
 *
 * 覆盖：cleaner 产出的设定经 save_novel_settings 自动入库（无确认闸门，绕过
 * 审阅收件箱）、同主体按名合并不重复新建、描述变更轨迹落档案可追溯。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { and, eq } from "drizzle-orm"
import {
  CharacterTable,
  DescriptionHistoryTable,
  getDb,
  NovelTable,
  WorldEntryTable,
} from "../../src/novel-writer/session-store.js"
import { settingsTools } from "../../src/novel-writer/tools/settings.js"
import { createToolContext } from "./runtime-assembly-helpers.js"

const NOVEL_ID = "novel-cleaner-ingest"
const LONG_DESC = "李明是这座城市的普通职员，白天沉默寡言，夜里独自巡逻旧城区。他对雨夜格外敏感，总在暴雨后出门查看巷子深处。"
const MERGED_DESC = "李明是这座城市的普通职员，白天沉默寡言，夜里独自巡逻旧城区，对雨夜格外敏感。"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), "cleaner-ingest-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8))
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  getDb(projectDir)
    .insert(NovelTable)
    .values({ id: NOVEL_ID, title: "清洗入库测试", genre: "都市", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

function toolCtx() {
  return createToolContext(projectDir)
}

function saveSettings(entries: unknown[]) {
  return settingsTools.save_novel_settings.execute(
    { novel_id: NOVEL_ID, settings_json: JSON.stringify(entries) },
    toolCtx(),
  )
}

function characters() {
  return getDb(projectDir).select().from(CharacterTable).where(eq(CharacterTable.novel_id, NOVEL_ID)).all()
}

describe("cleaner 设定线索自动入库（design D5）", () => {
  test("首次入库创建，同名再次入库合并不重复新建", async () => {
    const first = await saveSettings([{ type: "character", data: { name: "李明", role: "主角", description: LONG_DESC } }])
    expect(first.metadata?.errors).toEqual([])
    expect(characters()).toHaveLength(1)
    expect(characters()[0].description).toBe(LONG_DESC)

    const second = await saveSettings([{ type: "character", data: { name: "李明", role: "主角", description: MERGED_DESC } }])
    expect(second.metadata?.errors).toEqual([])
    expect(characters()).toHaveLength(1)
    expect(characters()[0].description).toBe(MERGED_DESC)
  })

  test("描述变更轨迹落档案可追溯", async () => {
    await saveSettings([{ type: "character", data: { name: "李明", role: "主角", description: LONG_DESC } }])
    await saveSettings([{ type: "character", data: { name: "李明", role: "主角", description: MERGED_DESC } }])
    const traces = getDb(projectDir)
      .select()
      .from(DescriptionHistoryTable)
      .where(and(eq(DescriptionHistoryTable.novel_id, NOVEL_ID), eq(DescriptionHistoryTable.entity_type, "character")))
      .all()
    expect(traces).toHaveLength(1)
    expect(traces[0].old_value).toBe(LONG_DESC)
    expect(traces[0].new_value).toBe(MERGED_DESC)
  })

  test("world_entry 线索直接落库，无审阅收件箱中转", async () => {
    const result = await saveSettings([
      { type: "world_entry", data: { category: "地点", title: "旧城区", content: "旧城区位于城市边缘，雨夜路灯昏黄。" } },
    ])
    expect(result.metadata?.errors).toEqual([])
    const entries = getDb(projectDir).select().from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, NOVEL_ID)).all()
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("旧城区")
  })
})
