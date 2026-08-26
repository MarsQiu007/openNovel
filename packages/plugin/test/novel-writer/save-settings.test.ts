/**
 * save_novel_settings 回归测试
 *
 * 重点覆盖 style_guide 单条覆盖语义：必须 update-in-place（保留原行 id），
 * 不允许先删后插——insert 失败时旧数据会丢失（曾发生的 bug）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { getDb, NovelTable, StyleGuideTable } from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `save-settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
    sessionID: "ses-save-test",
    messageID: "msg_test",
    agent: "architect",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

async function seed() {
  const db = getDb(projectDir)
  await db.insert(NovelTable).values({ id: "novel-save", title: "保存测试", genre: "玄幻", synopsis: "", status: "draft" }).run()
  return db
}

async function saveStyle(settings: Array<{ type: string; data: Record<string, unknown> }>) {
  const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
  return hooks.tool!.save_novel_settings!.execute({ novel_id: "novel-save", settings_json: JSON.stringify(settings) }, toolCtx())
}

describe("save_novel_settings style_guide", () => {
  test("首次保存插入风格指南", async () => {
    const db = await seed()
    await saveStyle([{ type: "style_guide", data: { tone: "热血", pov: "第三人称限制", tense: "过去时", rules: { chapter_length: 3000 } } }])
    const rows = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-save")).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].tone).toBe("热血")
  })

  test("覆盖写入是 update-in-place：保留原行 id，不经过删除中间态", async () => {
    const db = await seed()
    await saveStyle([{ type: "style_guide", data: { tone: "热血", pov: "第三人称限制", tense: "过去时" } }])
    const [before] = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-save")).all()

    await saveStyle([{ type: "style_guide", data: { tone: "轻松", pov: "第一人称", tense: "现在时", rules: { chapter_length: 2500 } } }])
    const after = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, "novel-save")).all()

    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
    expect(after[0].tone).toBe("轻松")
    expect(after[0].pov).toBe("第一人称")
  })
})
