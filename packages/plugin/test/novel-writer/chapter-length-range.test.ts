/**
 * 章节字数区间门禁测试（chapter_length / chapter_length_max 显式上下限语义）
 *
 * 验证 write_chapter / revise_chapter 的两态门禁行为：
 * 下限常驻拒绝（too_short，消息含「还差」与补足方向）；上限存在时区间双向拒绝
 * （too_long，消息提示优先删除注水内容而非砍剧情主线）；上限留空/非法按不设上限处理。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
// @ts-ignore - bun:sqlite 类型仅在 bun 运行时可用
import { Database as BunSqlite } from "bun:sqlite"

const testDir = join(tmpdir(), `novel-writer-length-range-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const projectDir = join(testDir, "novel-project")
let prevOpenNovelDb: string | undefined
mkdirSync(testDir, { recursive: true })

import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateChapterOutline } from "../../src/novel-writer/outline.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"
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
  const novelId = await createBook(title, "玄幻", "章节字数区间测试用书籍。")
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

const novelWriterTools = createWritingTools()

function writeChapter(chapterId: string, content: string) {
  return novelWriterTools.write_chapter.execute({ chapter_id: chapterId, content }, toolCtx())
}

function reviseChapter(chapterId: string, revision: string) {
  return novelWriterTools.revise_chapter.execute({ chapter_id: chapterId, revision }, toolCtx())
}

function toolCtx() {
  return createToolContext(projectDir, { sessionID: "ses-length-range", messageID: "msg-length-range", agent: "writer" })
}

describe("chapter_length 章节字数区间门禁", () => {
  beforeAll(() => {
    prevOpenNovelDb = process.env.OPENNOVEL_DB
    process.env.OPENNOVEL_DB = dbPath
    const result = initNovelProject(projectDir)
    expect(result).toContain("小说项目初始化完成")
  })

  afterAll(() => {
    closeDb(projectDir)
    if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = prevOpenNovelDb
    try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
  })

  test("区间内通过：2000–5000 区间 3500 字写入成功", async () => {
    const chapterId = await setupBookWithChapter("区间内书", {
      chapter_length: "2000",
      chapter_length_max: "5000",
    })
    const result = await writeChapter(chapterId, makeContent(3500))
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
    expect(output).toContain("下限 2000 / 上限 5000")
  })

  test("低于下限拒绝：reason too_short，消息含「还差」与补足方向", async () => {
    const chapterId = await setupBookWithChapter("低于下限书", {
      chapter_length: "2000",
    })
    const result = await writeChapter(chapterId, makeContent(1800))
    const typed = result as { title?: string; output?: string; metadata?: { rejected?: boolean; reason?: string; lower_bound?: number; upper_bound?: number | null } }
    expect(typed.metadata?.rejected).toBe(true)
    expect(typed.metadata?.reason).toBe("too_short")
    expect(typed.metadata?.lower_bound).toBe(2000)
    expect(typed.metadata?.upper_bound).toBeNull()
    expect(typed.output).toContain("字数不足")
    expect(typed.output).toContain("还差")
    expect(typed.output).toContain("字数下限 2000 字")
    expect(typed.output).toContain("扩写正文补足字数")
  })

  test("高于上限拒绝：reason too_long，消息提示删注水而非砍主线", async () => {
    const chapterId = await setupBookWithChapter("高于上限书", {
      chapter_length: "2000",
      chapter_length_max: "5000",
    })
    const result = await writeChapter(chapterId, makeContent(5200))
    const typed = result as { title?: string; output?: string; metadata?: { rejected?: boolean; reason?: string; lower_bound?: number; upper_bound?: number | null } }
    expect(typed.metadata?.rejected).toBe(true)
    expect(typed.metadata?.reason).toBe("too_long")
    expect(typed.metadata?.lower_bound).toBe(2000)
    expect(typed.metadata?.upper_bound).toBe(5000)
    expect(typed.output).toContain("字数超标")
    expect(typed.output).toContain("字数上限 5000 字")
    expect(typed.output).toContain("优先删除注水内容")
    expect(typed.output).toContain("而非砍剧情主线")
  })

  test("修订受同等约束：revise_chapter 低于下限与高于上限均拒绝", async () => {
    const chapterId = await setupBookWithChapter("修订约束书", {
      chapter_length: "2000",
      chapter_length_max: "5000",
    })
    const written = (await writeChapter(chapterId, makeContent(3500))) as { output?: string }
    expect(written.output).toContain("已写入")

    const shortResult = await reviseChapter(chapterId, makeContent(1800))
    const shortTyped = shortResult as { metadata?: { rejected?: boolean; reason?: string } }
    expect(shortTyped.metadata?.rejected).toBe(true)
    expect(shortTyped.metadata?.reason).toBe("too_short")

    const longResult = await reviseChapter(chapterId, makeContent(5200))
    const longTyped = longResult as { output?: string; metadata?: { rejected?: boolean; reason?: string; upper_bound?: number | null } }
    expect(longTyped.metadata?.rejected).toBe(true)
    expect(longTyped.metadata?.reason).toBe("too_long")
    expect(longTyped.metadata?.upper_bound).toBe(5000)
    expect(longTyped.output).toContain("字数超标")
    expect(longTyped.output).toContain("请精炼压缩后重新调用 revise_chapter")
  })

  test("仅下限超长放行：2500 下限无上限，6000 字写入成功", async () => {
    const chapterId = await setupBookWithChapter("仅下限书", {
      chapter_length: "2500",
    })
    const result = await writeChapter(chapterId, makeContent(6000))
    const output = (result as { output?: string }).output ?? ""
    expect(output).toContain("已写入")
    expect(output).toContain("下限≥2500字")
  })

  test("非法上限按不设上限处理：≤下限/空串/纯空白/非数值", async () => {
    const illegalCases: Array<[string, string]> = [
      ["非法上限低于下限书", "1500"],
      ["空串上限书", ""],
      ["纯空白上限书", "   "],
      ["非数值上限书", "abc"],
    ]
    for (const [title, max] of illegalCases) {
      const chapterId = await setupBookWithChapter(title, {
        chapter_length: "2000",
        chapter_length_max: max,
      })
      // 3200 字若被当作 1500/0 等非法上限会触发 too_long；按不设上限处理时应写入成功
      const result = await writeChapter(chapterId, makeContent(3200))
      const typed = result as { output?: string; metadata?: { rejected?: boolean; reason?: string } }
      expect(typed.metadata?.rejected, `${title} 不应拒绝`).toBeUndefined()
      expect(typed.output).toContain("已写入")
      expect(typed.output).toContain("下限≥2000字")
    }
  })

  test("空白包夹上限按数值生效：\" 5000 \" 等价 5000", async () => {
    const chapterId = await setupBookWithChapter("包夹上限书", {
      chapter_length: "2000",
      chapter_length_max: " 5000 ",
    })
    const passResult = await writeChapter(chapterId, makeContent(3500))
    expect((passResult as { output?: string }).output).toContain("已写入")
    expect((passResult as { output?: string }).output).toContain("下限 2000 / 上限 5000")

    // 同一书重写超上限正文验证包夹值真实生效
    const longResult = await writeChapter(chapterId, makeContent(5600))
    const longTyped = longResult as { output?: string; metadata?: { rejected?: boolean; reason?: string; upper_bound?: number | null } }
    expect(longTyped.metadata?.rejected).toBe(true)
    expect(longTyped.metadata?.reason).toBe("too_long")
    expect(longTyped.metadata?.upper_bound).toBe(5000)
  })
})
