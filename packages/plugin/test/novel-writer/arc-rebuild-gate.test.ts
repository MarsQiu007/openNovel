/**
 * backfill_story_arcs replace 模式删除确认门回归测试
 *
 * create_only 不触发确认；replace_all / replace_matching 删除前必须通过
 * 独立权限键 arc_rebuild 确认，拒绝时中止且既有弧光保持原样。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import {
  getDb,
  NovelTable,
  CharacterTable,
  StoryArcTable,
} from "../../src/novel-writer/session-store.js"
import type { ToolContext } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `arc-rebuild-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

type AskRecord = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
}

function toolCtx(ask?: (input: AskRecord) => Promise<void>): ToolContext {
  return {
    sessionID: "ses-arc-gate",
    messageID: "msg_test",
    agent: "architect",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask(input) {
      if (ask) await ask(input)
    },
  }
}

async function seed() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-gate", title: "弧光确认门测试", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  await db.insert(CharacterTable).values({ id: "char-lin", novel_id: "novel-gate", name: "林晚" }).run()
  await db.insert(CharacterTable).values({ id: "char-jiu", novel_id: "novel-gate", name: "九爷" }).run()
  await db
    .insert(StoryArcTable)
    .values({ id: "arc-main", novel_id: "novel-gate", arc_type: "narrative", title: "旧主线", summary: "" })
    .run()
  await db
    .insert(StoryArcTable)
    .values({ id: "arc-lin", novel_id: "novel-gate", arc_type: "character", title: "林晚成长弧", summary: "", target_character_id: "char-lin" })
    .run()
  await db
    .insert(StoryArcTable)
    .values({ id: "arc-jiu", novel_id: "novel-gate", arc_type: "character", title: "九爷救赎弧", summary: "", target_character_id: "char-jiu" })
    .run()
  const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
  return { db, hooks: hooks.tool! }
}

const newArcs = [
  {
    arc_type: "narrative",
    title: "新主线",
    beats: [{ label: "开端", kind: "setup" }],
  },
]

const arcTitles = (rows: { title: string }[]) => rows.map((r) => r.title).sort()

describe("backfill_story_arcs 删除确认门", () => {
  test("create_only 不触发确认", async () => {
    const { db, hooks } = await seed()
    const askCalls: AskRecord[] = []
    const result = await hooks.backfill_story_arcs.execute(
      { arcs: newArcs },
      toolCtx(async (input) => {
        askCalls.push(input)
      }),
    )
    expect(askCalls.length).toBe(0)
    expect(result).toMatchObject({ title: "backfill_story_arcs" })
    const titles = arcTitles(await db.select({ title: StoryArcTable.title }).from(StoryArcTable).all())
    expect(titles).toContain("新主线")
    expect(titles).toContain("旧主线")
  })

  test("replace_all 删除前确认且请求形状正确", async () => {
    const { db, hooks } = await seed()
    const askCalls: AskRecord[] = []
    const result = await hooks.backfill_story_arcs.execute(
      { arcs: newArcs, mode: "replace_all" },
      toolCtx(async (input) => {
        askCalls.push(input)
      }),
    )
    expect(askCalls.length).toBe(1)
    expect(askCalls[0].permission).toBe("arc_rebuild")
    expect(askCalls[0].patterns).toEqual(["replace_all"])
    expect(askCalls[0].always).toEqual(["replace_all"])
    expect(askCalls[0].metadata).toMatchObject({ toolId: "backfill_story_arcs", mode: "replace_all", arcs_to_delete: 3 })
    expect(result).toMatchObject({ title: "backfill_story_arcs" })
    const titles = arcTitles(await db.select({ title: StoryArcTable.title }).from(StoryArcTable).all())
    expect(titles).toEqual(["新主线"])
  })

  test("replace_matching 确认只计匹配弧光", async () => {
    const { db, hooks } = await seed()
    const askCalls: AskRecord[] = []
    await hooks.backfill_story_arcs.execute(
      {
        arcs: [{ arc_type: "character", title: "林晚黑化弧", target_character_name: "林晚", beats: [{ label: "转折", kind: "turn" }] }],
        mode: "replace_matching",
        replace_match: { arc_type: "character", target_character_name: "林晚" },
      },
      toolCtx(async (input) => {
        askCalls.push(input)
      }),
    )
    expect(askCalls.length).toBe(1)
    expect(askCalls[0].metadata).toMatchObject({ mode: "replace_matching", arcs_to_delete: 1 })
    const titles = arcTitles(await db.select({ title: StoryArcTable.title }).from(StoryArcTable).all())
    expect(titles).toEqual(["九爷救赎弧", "旧主线", "林晚黑化弧"])
  })

  test("拒绝确认时中止且既有弧光保持原样", async () => {
    const { db, hooks } = await seed()
    await expect(
      hooks.backfill_story_arcs.execute(
        { arcs: newArcs, mode: "replace_all" },
        toolCtx(async () => {
          throw new Error("用户拒绝删除弧光")
        }),
      ),
    ).rejects.toThrow("用户拒绝删除弧光")
    const titles = arcTitles(await db.select({ title: StoryArcTable.title }).from(StoryArcTable).all())
    expect(titles).toEqual(["九爷救赎弧", "旧主线", "林晚成长弧"])
  })

  test("replace_matching 缺少 replace_match 时直接返回，不发起确认", async () => {
    const { hooks } = await seed()
    const askCalls: AskRecord[] = []
    const result = await hooks.backfill_story_arcs.execute(
      { arcs: newArcs, mode: "replace_matching" },
      toolCtx(async (input) => {
        askCalls.push(input)
      }),
    )
    expect(askCalls.length).toBe(0)
    expect(result).toMatchObject({ output: expect.stringContaining("需要提供 replace_match") })
  })
})
