/**
 * 真实结果只读核验适配器测试（任务 3.3）。
 *
 * 覆盖 tasks.md 3.3 验证：自称成功但未落库、工具成功且状态已核实、无法安全核验
 * 标「未验证」、静态检查核验路径无写操作。全部查询走临时项目目录的真实 SQLite。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { closeDb, type Db } from "@opennovel-ai/novel-store"
import { CharacterTable, ChapterTable, ChapterVersionTable, ChapterReviewTable, NovelTable, getDb } from "../../src/novel-writer/session-store.js"
import { findToolInsightVerifyAdapter } from "../../src/tool-insight/verify.js"

// 核验按 projectDirectory 解析 DB：同进程其他测试文件可能残留 OPENNOVEL_DB，先存后清
let prevOpenNovelDb: string | undefined
beforeAll(() => {
  prevOpenNovelDb = process.env.OPENNOVEL_DB
  delete process.env.OPENNOVEL_DB
})
afterAll(() => {
  if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = prevOpenNovelDb
})

const now = Date.now()

function newProject(): string {
  return mkdtempSync(join(tmpdir(), "tool-insight-verify-"))
}

function cleanup(projectDir: string) {
  closeDb(projectDir)
  // Windows 下 SQLite 句柄释放有短暂延迟：清理失败不影响断言（与 review.test 同款吞异常）
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
}

async function seedNovelAndChapter(db: Db, chapterID: string, content: string) {
  const novelID = crypto.randomUUID()
  db.insert(NovelTable)
    .values({ id: novelID, title: "核验测试小说", genre: "玄幻", synopsis: "", created_at: now, updated_at: now, status: "draft" })
    .run()
  db.insert(ChapterTable)
    .values({ id: chapterID, novel_id: novelID, volume_id: null, title: "第1章", content, word_count: content.length, status: "drafting", order: 1, created_at: now, updated_at: now })
    .run()
  return novelID
}

describe("真实结果只读核验适配器", () => {
  test("自称成功但未落库：章节不存在 → verified_failure", async () => {
    const projectDir = newProject()
    try {
      getDb(projectDir)
      const adapter = findToolInsightVerifyAdapter("update_chapter")
      expect(adapter).toBeDefined()
      const result = await adapter!.verify({ directory: projectDir, identifiers: { chapter_id: "ch_missing" } })
      expect(result.status).toBe("verified_failure")
      expect(result.detail).toContain("不存在")
    } finally {
      cleanup(projectDir)
    }
  })

  test("自称成功但未落库：章节存在但没有任何内容版本 → verified_failure（write_chapter）", async () => {
    const projectDir = newProject()
    try {
      const db = getDb(projectDir)
      const chapterID = crypto.randomUUID()
      await seedNovelAndChapter(db, chapterID, "")
      const adapter = findToolInsightVerifyAdapter("write_chapter")!
      expect(adapter.extract({ callInput: { chapter_id: chapterID, content: "正文" }, resultStructured: {} })).toEqual({ chapter_id: chapterID })
      const result = await adapter.verify({ directory: projectDir, identifiers: { chapter_id: chapterID } })
      expect(result.status).toBe("verified_failure")
      expect(result.detail).toContain("没有")
    } finally {
      cleanup(projectDir)
    }
  })

  test("工具成功且状态已核实：章节与版本落库 → verified_success", async () => {
    const projectDir = newProject()
    try {
      const db = getDb(projectDir)
      const chapterID = crypto.randomUUID()
      const novelID = await seedNovelAndChapter(db, chapterID, "已落库正文")
      db.insert(ChapterVersionTable)
        .values({ id: crypto.randomUUID(), chapter_id: chapterID, version: 1, content: "第一版正文", word_count: 5, created_at: now, created_by: "writer" })
        .run()
      for (const tool of ["write_chapter", "revise_chapter", "update_chapter"]) {
        const result = await findToolInsightVerifyAdapter(tool)!.verify({ directory: projectDir, identifiers: { chapter_id: chapterID } })
        expect(result.status).toBe("verified_success")
        expect(result.detail).toContain("v1")
      }
      expect(db.select().from(NovelTable).all()).toHaveLength(1)
      expect(novelID).toBeTruthy()
    } finally {
      cleanup(projectDir)
    }
  })

  test("审批轨迹：评审记录存在 → verified_success，缺失 → verified_failure", async () => {
    const projectDir = newProject()
    try {
      const db = getDb(projectDir)
      const chapterID = crypto.randomUUID()
      await seedNovelAndChapter(db, chapterID, "正文")
      const adapter = findToolInsightVerifyAdapter("submit_chapter_review")!
      const missing = await adapter.verify({ directory: projectDir, identifiers: { chapter_id: chapterID } })
      expect(missing.status).toBe("verified_failure")
      db.insert(ChapterReviewTable)
        .values({ id: crypto.randomUUID(), chapter_id: chapterID, round: 1, source: "deterministic", overall: "PASS", pass_count: 1, total_count: 1, created_at: now })
        .run()
      const found = await adapter.verify({ directory: projectDir, identifiers: { chapter_id: chapterID } })
      expect(found.status).toBe("verified_success")
      expect(found.detail).toContain("round 1")
    } finally {
      cleanup(projectDir)
    }
  })

  test("设定入库：入库标识出现在设定正式表 → verified_success，缺失 → verified_failure", async () => {
    const projectDir = newProject()
    try {
      const db = getDb(projectDir)
      const createdID = crypto.randomUUID()
      const novelID = crypto.randomUUID()
      db.insert(NovelTable)
        .values({ id: novelID, title: "设定核验", genre: "玄幻", synopsis: "", created_at: now, updated_at: now, status: "draft" })
        .run()
      const adapter = findToolInsightVerifyAdapter("accept_pending_setting")!
      expect(adapter.extract({ callInput: {}, resultStructured: { created_id: createdID, candidate_type: "character" } })).toEqual({
        created_id: createdID,
        candidate_type: "character",
      })
      const missing = await adapter.verify({ directory: projectDir, identifiers: { created_id: createdID, candidate_type: "character" } })
      expect(missing.status).toBe("verified_failure")
      db.insert(CharacterTable).values({ id: createdID, novel_id: novelID, name: "林川", role: "主角", description: "", profile: "", status: "active" }).run()
      const found = await adapter.verify({ directory: projectDir, identifiers: { created_id: createdID, candidate_type: "character" } })
      expect(found.status).toBe("verified_success")
    } finally {
      cleanup(projectDir)
    }
  })

  test("无法安全核验：标识不足或没有适配器 → unverified", async () => {
    const projectDir = newProject()
    try {
      const adapter = findToolInsightVerifyAdapter("update_chapter")!
      // 调用输入缺 chapter_id：extract 拒绝提取
      expect(adapter.extract({ callInput: { content: "正文" }, resultStructured: {} })).toBeUndefined()
      // 标识对象缺字段：verify 返回未验证
      const result = await adapter.verify({ directory: projectDir, identifiers: {} })
      expect(result.status).toBe("unverified")
      // 未注册核验器的工具没有适配器：不根据工具返回推断成功
      expect(findToolInsightVerifyAdapter("list_chapters")).toBeUndefined()
    } finally {
      cleanup(projectDir)
    }
  })

  test("静态检查：核验路径无写操作，核验前后本地状态逐行不变", async () => {
    const projectDir = newProject()
    try {
      const db = getDb(projectDir)
      const chapterID = crypto.randomUUID()
      await seedNovelAndChapter(db, chapterID, "核验前正文")
      db.insert(ChapterVersionTable)
        .values({ id: crypto.randomUUID(), chapter_id: chapterID, version: 1, content: "第一版", word_count: 3, created_at: now, created_by: "writer" })
        .run()
      const snapshot = () =>
        JSON.stringify({
          chapters: db.select().from(ChapterTable).all(),
          versions: db.select().from(ChapterVersionTable).all(),
          novels: db.select().from(NovelTable).all(),
          characters: db.select().from(CharacterTable).all(),
          reviews: db.select().from(ChapterReviewTable).all(),
        })
      const before = snapshot()
      for (const tool of ["write_chapter", "revise_chapter", "update_chapter", "submit_chapter_review", "accept_pending_setting"]) {
        const adapter = findToolInsightVerifyAdapter(tool)!
        // 各种标识组合都走一遍：成功、失败与未验证路径都不得修改任何表
        await adapter.verify({ directory: projectDir, identifiers: { chapter_id: chapterID } })
        await adapter.verify({ directory: projectDir, identifiers: { chapter_id: "ch_missing" } })
        await adapter.verify({ directory: projectDir, identifiers: {} })
      }
      expect(snapshot()).toBe(before)
    } finally {
      cleanup(projectDir)
    }
  })
})
