/**
 * 篇幅限制（chapter_length_limit）字数门槛测试
 *
 * 验证 style_guide.rules.chapter_length_limit 开关的双模式行为：
 * 启用时 write_chapter 按目标 ±15% 双向拒绝（too_short/too_long）；
 * 不启用（缺省）时维持现状仅拒绝低于目标 100%。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
// @ts-ignore - bun:sqlite 类型仅在 bun 运行时可用
import { Database as BunSqlite } from "bun:sqlite"

const testDir = join(tmpdir(), `novel-writer-length-limit-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const projectDir = join(testDir, "novel-project")
const originalOpenNovelDb = process.env.OPENNOVEL_DB
const novelWriterHooks = await NovelWriterPlugin(createPluginInput(projectDir))
process.env.OPENNOVEL_DB = dbPath
mkdirSync(testDir, { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"
import type { ToolContext } from "../../src/tool.js"
import { closeDb, getDb, WorldEntryTable, StyleGuideTable } from "@opennovel-ai/novel-store"
import { eq } from "drizzle-orm"

// 约 250 汉字的叙事段落（无控制层坐标/编号/标签，可安全通过提纲标签与坐标泄漏检查）
const PARAGRAPH =
  "林天盘坐在青石之上，闭目内视，感受着经脉中缓缓流转的灵力。山风拂过松林，带来阵阵清冽的草木气息。他一遍遍运转功法，将散乱的灵力归入气海，再引导其沿经脉周天运行。每一次循环，灵力都凝实一分，气海中的混沌符文也随之明亮一分。远处传来瀑布轰鸣，惊起几只山雀，掠过晨雾弥漫的山谷。林天不为所动，依旧保持着均匀的吐纳节奏，仿佛与整座山峦的呼吸融为一体。不知过了多久，他缓缓睁开双眼，眸中闪过一丝微光，随即内敛于瞳孔深处。他站起身，活动了一下筋骨，望向云海深处，心中默默盘算着接下来的修炼计划。"

function hanCount(text: string): number {
  return (text.match(/\p{Script=Han}/gu) ?? []).length
}

/** 合成约 targetHan 汉字的正文（误差 ±30） */
function makeContent(targetHan: number): string {
  const per = hanCount(PARAGRAPH)
  let text = PARAGRAPH.repeat(Math.ceil(targetHan / per))
  while (hanCount(text) > targetHan + 30) text = text.slice(0, -80)
  return text
}

function upsertStyleGuide(novelId: string, rules: Record<string, string>) {
  const db = getDb(projectDir)
  const [existing] = db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).all()
  if (existing) {
    db.update(StyleGuideTable).set({ rules }).where(eq(StyleGuideTable.novel_id, novelId)).run()
    return
  }
  db.insert(StyleGuideTable).values({ id: crypto.randomUUID(), novel_id: novelId, rules }).run()
}

/** 建书 + 章纲 + 最小世界观设定（write_chapter 初始化门禁前置），返回章节 ID */
async function setupBookWithChapter(title: string, rules?: Record<string, string>): Promise<string> {
  const novelId = await createBook(title, "玄幻", "篇幅限制测试用书籍。")
  if (rules) upsertStyleGuide(novelId, rules)
  await generateChapterOutline(novelId, 1, projectDir)
  const db = getDb(projectDir)
  db.insert(WorldEntryTable)
    .values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      category: "location",
      title: `${title} 山门`,
      content: "测试世界观条目。",
      created_at: Date.now(),
    })
    .run()
  const sqlite = new BunSqlite(dbPath)
  const row = sqlite.query(`SELECT id FROM chapters WHERE novel_id = ? AND "order" = 1`).get(novelId) as { id: string }
  sqlite.close()
  return row.id
}

function writeChapter(chapterId: string, content: string) {
  return novelWriterHooks.tool!.write_chapter.execute({ chapter_id: chapterId, content }, toolCtx())
}

function toolCtx(): ToolContext {
  return {
    sessionID: "ses-length-limit",
    messageID: "msg-length-limit",
    agent: "writer",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

describe("chapter_length_limit 篇幅限制", () => {
  beforeAll(() => {
    const result = initNovelProject(projectDir)
    expect(result).toContain("小说项目初始化完成")
  })

  afterAll(() => {
    closeDb(projectDir)
    if (originalOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = originalOpenNovelDb
    try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
  })

  test("不启用（缺省）时超长通过：上限不限维持现状", async () => {
    const chapterId = await setupBookWithChapter("缺省超长书")
    const result = await writeChapter(chapterId, makeContent(3200))
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
  })

  test("启用时区间内通过：低于 100% 但高于 85% 放行", async () => {
    const chapterId = await setupBookWithChapter("启用区间书", {
      chapter_length: "2500",
      chapter_length_limit: "true",
    })
    const result = await writeChapter(chapterId, makeContent(2300))
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
  })

  test("启用时低于 85% 拒绝：reason 为 too_short", async () => {
    const chapterId = await setupBookWithChapter("启用不足书", {
      chapter_length: "2500",
      chapter_length_limit: "true",
    })
    const result = await writeChapter(chapterId, makeContent(2000))
    const typed = result as { output?: string; metadata?: { rejected?: boolean; reason?: string } }
    expect(typed.metadata?.rejected).toBe(true)
    expect(typed.metadata?.reason).toBe("too_short")
    expect(typed.output).toContain("字数不足")
  })

  test("启用时高于 115% 拒绝：reason 为 too_long", async () => {
    const chapterId = await setupBookWithChapter("启用超标书", {
      chapter_length: "2500",
      chapter_length_limit: "true",
    })
    const result = await writeChapter(chapterId, makeContent(3200))
    const typed = result as { output?: string; metadata?: { rejected?: boolean; reason?: string } }
    expect(typed.metadata?.rejected).toBe(true)
    expect(typed.metadata?.reason).toBe("too_long")
    expect(typed.output).toContain("字数超标")
  })
})