/**
 * 顺序门禁（review 模式逐章串行）测试（chapter-sequential-gate）
 *
 * review 模式下，前置章节（order 更小）未全部通过审批（final/published）时，
 * write_chapter / revise_chapter 对后续章节的正文写入被硬拦截（sequential_blocked）；
 * auto 模式不拦；重写被驳回的目标章节自身放行（驳回重写循环无死锁）。
 *
 * 仿 chapter-length-limit.test.ts 的临时目录 SQLite + 全工具装配模式，
 * 走真实工具调用不打 mock；前置章节手工置状态、不写正文，避免触发重复率门禁。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
// @ts-ignore - bun:sqlite 类型仅在 bun 运行时可用
import { Database as BunSqlite } from "bun:sqlite"

const testDir = join(tmpdir(), `novel-writer-sequential-gate-${Date.now()}`)
const projectDir = join(testDir, "novel-project")
// db 必须放在真实布局 <projectDir>/.novel/novel.db：projectDirFromCtx 从 db 路径反推项目根，
// OPENNOVEL_DB 指到别处会让 readNovelConfig 读错 config.json 路径、顺序门禁静默降级 auto
const dbPath = join(projectDir, ".novel", "novel.db")
let prevOpenNovelDb: string | undefined
mkdirSync(join(projectDir, ".novel"), { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
import { ChapterTable, closeDb, getDb, WorldEntryTable } from "@opennovel-ai/novel-store"
import { and, eq } from "drizzle-orm"

// 约 250 汉字的叙事段落（无控制层坐标/编号/标签，可安全通过提纲标签与坐标泄漏检查）
const PARAGRAPH =
  "林天盘坐在青石之上，闭目内视，感受着经脉中缓缓流转的灵力。山风拂过松林，带来阵阵清冽的草木气息。他一遍遍运转功法，将散乱的灵力归入气海，再引导其沿经脉周天运行。每一次循环，灵力都凝实一分，气海中的混沌符文也随之明亮一分。远处传来瀑布轰鸣，惊起几只山雀，掠过晨雾弥漫的山谷。林天不为所动，依旧保持着均匀的吐纳节奏，仿佛与整座山峦的呼吸融为一体。不知过了多久，他缓缓睁开双眼，眸中闪过一丝微光，随即内敛于瞳孔深处。他站起身，活动了一下筋骨，望向云海深处，心中默默盘算着接下来的修炼计划。"

function hanCount(text: string): number {
  return (text.match(/\p{Script=Han}/gu) ?? []).length
}

/** 合成约 2600 汉字的正文（高于缺省目标 2500 的下限，通过篇幅门禁） */
function makeContent(): string {
  return PARAGRAPH.repeat(Math.ceil(2600 / hanCount(PARAGRAPH)))
}

function setWritingMode(mode: "auto" | "review") {
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  writeFileSync(join(projectDir, ".novel", "config.json"), JSON.stringify({ writing_mode: mode }))
}

function setChapterStatus(novelId: string, order: number, status: string) {
  const db = getDb(projectDir)
  db.update(ChapterTable)
    .set({ status, updated_at: Date.now() })
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, order)))
    .run()
}

/** 手工插入后续章（不生成章纲，测试只关心状态与顺序） */
function insertChapter(novelId: string, order: number, title: string, status: string, content = "") {
  const db = getDb(projectDir)
  db.insert(ChapterTable)
    .values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      title,
      content,
      word_count: content.length,
      status,
      outline: "",
      order,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()
}

function getChapterId(novelId: string, order: number): string {
  const sqlite = new BunSqlite(dbPath)
  const row = sqlite.query(`SELECT id FROM chapters WHERE novel_id = ? AND "order" = ?`).get(novelId, order) as {
    id: string
  }
  sqlite.close()
  return row.id
}

/** 建书 + 第 1 章章纲 + 最小世界观设定（过 write_chapter 初始化门禁），返回书籍 ID */
async function setupBook(title: string, mode: "auto" | "review"): Promise<string> {
  const novelId = await createBook(title, "玄幻", "顺序门禁测试用书籍。")
  setWritingMode(mode)
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
  return novelId
}

const novelWriterTools = createWritingTools()

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-sequential-gate", messageID: "msg-sequential-gate", agent: "writer" })
}

function writeChapter(chapterId: string, content: string) {
  return novelWriterTools.write_chapter.execute({ chapter_id: chapterId, content }, toolCtx())
}

function reviseChapter(chapterId: string, revision: string) {
  return novelWriterTools.revise_chapter.execute({ chapter_id: chapterId, revision }, toolCtx())
}

// beforeAll/afterAll 置于文件顶层：两个 describe 共享同一临时库与 OPENNOVEL_DB 设置，
// 否则后续 describe 在未设 env 时会把测试书写进 CWD 的 .novel/novel.db（污染真实目录）
beforeAll(() => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = dbPath
  const result = initNovelProject(projectDir)
  // .novel 已预建（保证 db 落在真实布局）时 initNovelProject 走幂等分支，消息不同，只断言动作本身
  expect(result).toContain("初始化")
})

afterAll(() => {
  closeDb(projectDir)
  if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = prevOpenNovelDb
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
})

describe("chapter-sequential-gate review 模式逐章串行", () => {
  test("前置待审拦截：第 1 章 pending_review 时 write 第 2 章被拒", async () => {
    const novelId = await setupBook("待审拦截书", "review")
    setChapterStatus(novelId, 1, "pending_review")
    insertChapter(novelId, 2, "夜雨初停", "outline")
    const result = await writeChapter(getChapterId(novelId, 2), makeContent())
    const typed = result as { output?: string; metadata?: { blocked?: boolean; reason?: string; blocked_by_order?: number; blocked_by_title?: string } }
    expect(typed.metadata?.blocked).toBe(true)
    expect(typed.metadata?.reason).toBe("sequential_blocked")
    expect(typed.metadata?.blocked_by_order).toBe(1)
    expect(typed.output).toContain("第 1 章")
    expect(typed.output).toContain("尚未通过审批")
  })

  test("前置驳回拦截：第 1 章 rejected 时 revise 第 2 章被拒", async () => {
    const novelId = await setupBook("驳回拦截书", "review")
    setChapterStatus(novelId, 1, "rejected")
    insertChapter(novelId, 2, "旧稿残章", "draft", "这是第 2 章的旧稿内容，供修订覆盖。")
    const result = await reviseChapter(getChapterId(novelId, 2), makeContent())
    const typed = result as { metadata?: { blocked?: boolean; reason?: string } }
    expect(typed.metadata?.blocked).toBe(true)
    expect(typed.metadata?.reason).toBe("sequential_blocked")
  })

  test("前置大纲态拦截：第 1 章 outline（无正文）时 write 第 2 章被拒", async () => {
    const novelId = await setupBook("大纲态拦截书", "review")
    setChapterStatus(novelId, 1, "outline")
    insertChapter(novelId, 2, "第二章", "outline")
    const result = await writeChapter(getChapterId(novelId, 2), makeContent())
    const typed = result as { metadata?: { blocked?: boolean; reason?: string } }
    expect(typed.metadata?.blocked).toBe(true)
    expect(typed.metadata?.reason).toBe("sequential_blocked")
  })

  test("前置全部通过放行：第 1 章 final 时 write 第 2 章成功", async () => {
    const novelId = await setupBook("全通过放行书", "review")
    setChapterStatus(novelId, 1, "final")
    insertChapter(novelId, 2, "第二章", "outline")
    const result = await writeChapter(getChapterId(novelId, 2), makeContent())
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
  })

  test("前置 published 也放行：第 1 章 published 时 write 第 2 章成功", async () => {
    const novelId = await setupBook("发布态放行书", "review")
    setChapterStatus(novelId, 1, "published")
    insertChapter(novelId, 2, "第二章", "outline")
    const result = await writeChapter(getChapterId(novelId, 2), makeContent())
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
  })

  test("重写驳回的目标章自身放行：第 1 章 final、第 2 章 rejected 时 write 第 2 章成功", async () => {
    const novelId = await setupBook("重写驳回章书", "review")
    setChapterStatus(novelId, 1, "final")
    insertChapter(novelId, 2, "驳回旧稿", "rejected", "被驳回的第 2 章旧稿内容。")
    const result = await writeChapter(getChapterId(novelId, 2), makeContent())
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
  })

  test("多章未通过报最小 order：第 1 章 rejected、第 2 章 draft 时 write 第 3 章报第 1 章", async () => {
    const novelId = await setupBook("多章未通过书", "review")
    setChapterStatus(novelId, 1, "rejected")
    setChapterStatus(novelId, 2, "draft")
    insertChapter(novelId, 3, "第三章", "outline")
    const result = await writeChapter(getChapterId(novelId, 3), makeContent())
    const typed = result as { output?: string; metadata?: { blocked_by_order?: number } }
    expect(typed.metadata?.blocked_by_order).toBe(1)
    expect(typed.output).toContain("第 1 章")
  })

  test("拒绝消息含未通过章标题与处理指引", async () => {
    const novelId = await setupBook("消息指引书", "review")
    setChapterStatus(novelId, 1, "final")
    insertChapter(novelId, 2, "夜雨初停", "pending_review")
    insertChapter(novelId, 3, "第三章", "outline")
    const result = await writeChapter(getChapterId(novelId, 3), makeContent())
    const typed = result as { output?: string; metadata?: { blocked_by_order?: number; blocked_by_title?: string } }
    expect(typed.metadata?.blocked_by_order).toBe(2)
    expect(typed.metadata?.blocked_by_title).toBe("夜雨初停")
    expect(typed.output).toContain("夜雨初停")
    expect(typed.output).toContain("pending_review")
    expect(typed.output).toContain("请先处理第 2 章")
  })
})

describe("chapter-sequential-gate auto 模式不拦", () => {
  test("auto 模式前置 draft 时 write 第 2 章放行", async () => {
    const novelId = await setupBook("auto 放行书", "auto")
    setChapterStatus(novelId, 1, "draft")
    insertChapter(novelId, 2, "第二章", "outline")
    const result = await writeChapter(getChapterId(novelId, 2), makeContent())
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
  })
})
