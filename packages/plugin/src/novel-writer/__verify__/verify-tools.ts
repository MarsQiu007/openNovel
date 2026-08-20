/**
 * 工具落库验证脚本（非测试框架，直接用 bun 跑）
 *
 * 目的：证明 write_chapter / revise_chapter / manage_characters 三个工具
 * 的 execute 真正能读写 novel.db，不依赖 opennovel 运行时。
 *
 * 运行：cd packages/plugin && bun run src/novel-writer/__verify__/verify-tools.ts
 *
 * 退出码：0 全部通过，1 有失败。
 */
import { eq } from "drizzle-orm"
import { rmSync } from "fs"
import { NovelWriterPlugin } from "../../novel-writer.js"
import { getDb, NovelTable, ChapterTable, ChapterVersionTable, CharacterTable } from "../session-store.js"

// ─── 临时 DB：用环境变量强制 session-store 指向一个临时文件 ───
const DB_PATH = `${import.meta.dirname}/verify.db`
rmSync(DB_PATH, { force: true })
process.env.OPENNOVEL_DB = DB_PATH

// ─── 极简断言 ───
let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

// ─── 加载插件，拿到工具 ───
const hooks = await NovelWriterPlugin({
  client: {} as never,
  clientV2: {} as never,
  project: {} as never,
  directory: import.meta.dirname,
  worktree: import.meta.dirname,
  experimental_workspace: { register() {} },
  serverUrl: new URL("http://localhost"),
  $: {} as never,
})

const tools = hooks.tool!
const dir = import.meta.dirname // 作为 ctx.directory

async function main() {
  const db = getDb(dir)

  // ── 准备：一本小说 + 一个空章节 + 一个已有正文章节 ──
  const novelId = crypto.randomUUID()
  await db
    .insert(NovelTable)
    .values({ id: novelId, title: "验证之书", genre: "玄幻", synopsis: "测试用", status: "draft" })
    .run()

  const emptyChapterId = crypto.randomUUID()
  await db
    .insert(ChapterTable)
    .values({
      id: emptyChapterId,
      novel_id: novelId,
      title: "第一章 初入江湖",
      content: "",
      word_count: 0,
      status: "draft",
      order: 1,
    })
    .run()

  const filledChapterId = crypto.randomUUID()
  await db
    .insert(ChapterTable)
    .values({
      id: filledChapterId,
      novel_id: novelId,
      title: "第二章 旧文",
      content: "这是旧的正文内容",
      word_count: 8,
      status: "draft",
      order: 2,
    })
    .run()

  // ───────────────────────────────────────────────
  console.log("\n[1/4] write_chapter 写入空章节")
  // ───────────────────────────────────────────────
  const content1 = "清晨，薄雾笼罩着青石小镇。少年林风推开木门，望向远方连绵的群山，心中涌起一股难以抑制的冲动。"
  const r1 = await tools.write_chapter.execute(
    { chapter_id: emptyChapterId, content: content1 },
    {
      sessionID: "s",
      messageID: "m",
      agent: "writer",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  console.log("  返回:", r1)
  const [ch1] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, emptyChapterId)).all()
  assert(ch1.content === content1, "空章节正文已写入")
  assert(ch1.word_count === content1.replace(/\s/g, "").length, "字数已统计并写入")
  assert(ch1.status === "draft", "状态为 draft")
  const versions1 = await db
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, emptyChapterId))
    .all()
  assert(versions1.length === 0, "空章节首次写入不产生历史版本（无旧正文）")

  // ───────────────────────────────────────────────
  console.log("\n[2/4] write_chapter 覆盖已有正文章节")
  // ───────────────────────────────────────────────
  const content2 = "新写的第二章正文，完全不同的内容。"
  const r2 = await tools.write_chapter.execute(
    { chapter_id: filledChapterId, content: content2 },
    {
      sessionID: "s",
      messageID: "m",
      agent: "writer",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  console.log("  返回:", r2)
  const [ch2] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, filledChapterId)).all()
  assert(ch2.content === content2, "已有正文被覆盖")
  const versions2 = await db
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, filledChapterId))
    .all()
  assert(versions2.length === 1, "覆盖前归档了 1 个历史版本")
  assert(versions2[0].content === "这是旧的正文内容", "历史版本保留了旧正文")
  assert(versions2[0].version === 1, "历史版本号为 1")
  assert(versions2[0].created_by === "writer", "版本 created_by 记录了 agent")

  // ───────────────────────────────────────────────
  console.log("\n[3/4] revise_chapter 修订章节")
  // ───────────────────────────────────────────────
  const revised = "这是修订后的第二章正文，质量更高。"
  const r3 = await tools.revise_chapter.execute(
    { chapter_id: filledChapterId, revision: revised },
    {
      sessionID: "s",
      messageID: "m",
      agent: "reviser",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  console.log("  返回:", r3)
  const [ch3] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, filledChapterId)).all()
  assert(ch3.content === revised, "修订正文已覆盖")
  assert(ch3.status === "revised", "状态标记为 revised")
  const versions3 = await db
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, filledChapterId))
    .all()
  assert(versions3.length === 2, "修订又归档了 1 个版本（共 2 个）")
  assert(versions3.find((v) => v.version === 2)?.content === content2, "第 2 版保留了 write_chapter 写入的内容")
  assert(versions3.find((v) => v.version === 2)?.created_by === "reviser", "第 2 版 created_by 为 reviser")

  // ───────────────────────────────────────────────
  console.log("\n[4/4] manage_characters 新增 + 更新角色")
  // ───────────────────────────────────────────────
  const r4 = await tools.manage_characters.execute(
    {
      character_id: "",
      update: JSON.stringify({ novel_id: novelId, name: "林风", role: "主角", description: "少年天才" }),
    },
    {
      sessionID: "s",
      messageID: "m",
      agent: "writer",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  console.log("  新增返回:", r4)
  const chars = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
  assert(chars.length === 1, "新增了 1 个角色")
  assert(chars[0].name === "林风", "角色名为林风")
  assert(chars[0].role === "主角", "角色为主角")

  const charId = chars[0].id
  const r5 = await tools.manage_characters.execute(
    { character_id: charId, update: JSON.stringify({ description: "更新后的描述：觉醒了上古血脉" }) },
    {
      sessionID: "s",
      messageID: "m",
      agent: "writer",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  console.log("  更新返回:", r5)
  const [char2] = await db.select().from(CharacterTable).where(eq(CharacterTable.id, charId)).all()
  assert(char2.description === "更新后的描述：觉醒了上古血脉", "描述已更新")
  assert(char2.name === "林风", "未传 name 时保留原名")

  // ── 错误路径 ──
  console.log("\n[5/5] 错误路径")
  const re1 = await tools.write_chapter.execute(
    { chapter_id: "不存在的id", content: "x" },
    {
      sessionID: "s",
      messageID: "m",
      agent: "writer",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  assert(typeof re1 === "object" && (re1 as any).output.includes("章节不存在"), "write_chapter 不存在章节返回错误")

  const re2 = await tools.manage_characters.execute(
    { character_id: "", update: "不是json" },
    {
      sessionID: "s",
      messageID: "m",
      agent: "writer",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        return Promise.resolve()
      },
    },
  )
  assert(
    typeof re2 === "object" && (re2 as any).output.includes("不是合法 JSON"),
    "manage_characters 非法 JSON 返回错误",
  )

  // ─── 收尾 ───
  console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`)
  rmSync(DB_PATH, { force: true })
  process.exit(failures === 0 ? 0 : 1)
}

await main()
