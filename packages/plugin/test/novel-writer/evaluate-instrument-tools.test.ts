/**
 * 自评价埋点 — 写作工具判定点（1.3）
 *
 * 只断埋点键与计数，不断工具业务行为本身（行为回归由既有工具测试负责）：
 * - write_chapter：driftguard.checked / driftguard.finding（称谓守卫）
 * - update_chapter：进入 pending_review 计 approval.requested（重复进入不重复计）
 * - diff_chapter_version：paragraph.diff.checked / added_chars / removed_chars
 * - restore_chapter_version：version.rollback
 * - list_annotations：annotation.listed / annotation.issues.<status|all>
 * - read_outline：只读路径的 scene.compile.checked / scene.compile.null
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  NovelTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterTable,
  CharacterStateTable,
  RelationshipTable,
  createAnnotation,
} from "../../src/novel-writer/session-store.js"
import { readMetrics } from "../../src/novel-writer/evaluate/metrics.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string
let tools: ReturnType<typeof createWritingTools>

beforeEach(() => {
  projectDir = join(tmpdir(), `eval-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
  tools = createWritingTools()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function ctx() {
  return createToolContext(projectDir, { sessionID: "ses-eval-tools", agent: "writer" })
}

function seedNovel() {
  const db = getDb(projectDir)
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: "novel-1", title: "埋点书", genre: "都市", synopsis: "母亲和儿子的日常。", status: "draft", created_at: now, updated_at: now })
    .run()
  return db
}

function domainEntries(domain: string) {
  return readMetrics(projectDir).entries.filter((e) => e.domain === domain)
}

function sumByKey(entries: Array<{ key: string; delta: number }>, prefix: string) {
  return entries.filter((e) => e.key.startsWith(prefix)).reduce((sum, e) => sum + e.delta, 0)
}

describe("write_chapter 埋点", () => {
  function seedFamilyChapter() {
    const db = seedNovel()
    const now = Date.now()
    db.insert(CharacterTable)
      .values([
        { id: "char-a", novel_id: "novel-1", name: "李四" },
        { id: "char-b", novel_id: "novel-1", name: "张三" },
      ])
      .run()
    db.insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", order: 1, created_at: now, updated_at: now })
      .run()
    db.insert(CharacterStateTable)
      .values([
        { id: "state-a", character_id: "char-a", chapter_id: "ch-1", active: 1 },
        { id: "state-b", character_id: "char-b", chapter_id: "ch-1", active: 1 },
      ])
      .run()
    db.insert(RelationshipTable)
      .values({ id: "rel-1", novel_id: "novel-1", char_a_id: "char-a", char_b_id: "char-b", type: "母子", description: "李四抚养张三。" })
      .run()
    return db
  }

  test("称谓守卫：checked 每次写作都计，finding 只在命中时计", async () => {
    seedFamilyChapter()
    // 第一次：无称谓漂移（checked +1，无 finding）。默认目标字数下限 2500，须足字才过长度门
    const plainContent = "李四在厨房忙碌，窗外落雨，锅里的汤冒着热气。".repeat(200)
    await tools.write_chapter.execute({ chapter_id: "ch-1", content: plainContent }, ctx())
    // 第二次：引入未解析的亲属称谓（checked +1，finding +1）
    const driftContent = "王五成了李四的儿子，众人愕然，厅堂里一片死寂。".repeat(200)
    await tools.write_chapter.execute({ chapter_id: "ch-1", content: driftContent }, ctx())

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "driftguard.checked")).toBe(2)
    expect(sumByKey(c2, "driftguard.finding")).toBe(1)
  })
})

describe("update_chapter 埋点", () => {
  test("首次进入 pending_review 计 approval.requested，重复进入不重复计", async () => {
    const db = seedNovel()
    const now = Date.now()
    db.insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", content: "正文", word_count: 2, status: "draft", order: 1, created_at: now, updated_at: now })
      .run()

    await tools.update_chapter.execute({ chapter_id: "ch-1", status: "pending_review" }, ctx())
    await tools.update_chapter.execute({ chapter_id: "ch-1", status: "pending_review" }, ctx())

    expect(sumByKey(domainEntries("c2-prompt-control"), "approval.requested")).toBe(1)
  })
})

describe("版本工具埋点", () => {
  function seedVersions() {
    const db = seedNovel()
    const now = Date.now()
    db.insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", content: "新版正文", word_count: 4, status: "draft", order: 1, created_at: now, updated_at: now })
      .run()
    db.insert(ChapterVersionTable)
      .values({ id: "cv-1", chapter_id: "ch-1", version: 1, content: "旧版正文甲", word_count: 6, created_at: now, created_by: "ai" })
      .run()
    db.insert(ChapterVersionTable)
      .values({ id: "cv-2", chapter_id: "ch-1", version: 2, content: "旧版正文乙，多一段。", word_count: 10, created_at: now, created_by: "ai" })
      .run()
    return db
  }

  test("diff：checked/added_chars/removed_chars 三键齐计", async () => {
    seedVersions()
    await tools.diff_chapter_version.execute({ chapter_id: "ch-1", from_version: 1 }, ctx())

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "paragraph.diff.checked")).toBe(1)
    expect(sumByKey(c2, "paragraph.diff.added_chars")).toBeGreaterThan(0)
    expect(sumByKey(c2, "paragraph.diff.removed_chars")).toBeGreaterThan(0)
  })

  test("restore：回滚计 version.rollback，并追加为新 latest 版本", async () => {
    seedVersions()
    await tools.restore_chapter_version.execute({ chapter_id: "ch-1", target_version: 1 }, ctx())

    expect(sumByKey(domainEntries("c5-flow"), "version.rollback")).toBe(1)
    const db = getDb(projectDir)
    const latest = db
      .select()
      .from(ChapterVersionTable)
      .where(eq(ChapterVersionTable.chapter_id, "ch-1"))
      .all()
      .reduce((max, r) => (r.version > max.version ? r : max))
    expect(latest.version).toBe(3)
    expect(latest.content).toBe("旧版正文甲")
  })
})

describe("list_annotations 埋点", () => {
  test("listed 计 1，issues 按筛选状态分键；未筛选走 all", async () => {
    const db = seedNovel()
    const now = Date.now()
    db.insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", content: "正文", word_count: 2, status: "draft", order: 1, created_at: now, updated_at: now })
      .run()
    for (let i = 0; i < 2; i++) {
      await createAnnotation(
        {
          novelId: "novel-1",
          targetType: "chapter",
          targetId: "ch-1",
          field: "content",
          source: "user",
          anchorType: "paragraph",
          paragraphIndex: i,
          startOffset: null,
          endOffset: null,
          endParagraphIndex: null,
          quote: "正文",
          comment: `批注${i}`,
          suggestedReplacement: null,
          authorSessionId: null,
        },
        projectDir,
      )
    }

    await tools.list_annotations.execute({ target_type: "chapter", target_id: "ch-1" }, ctx())
    await tools.list_annotations.execute({ target_type: "chapter", target_id: "ch-1", status: "open" }, ctx())

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "annotation.listed")).toBe(2)
    expect(sumByKey(c2, "annotation.issues.all")).toBe(2)
    expect(sumByKey(c2, "annotation.issues.open")).toBe(2)
  })
})

describe("read_outline 埋点", () => {
  const SCENE_OUTLINE = `# 第一章大纲

## 关键场景
### 场景1
- **地点**：青石城
- **场景概要**：主角登场
`

  function seedOutlineChapter(outline: string) {
    const db = seedNovel()
    db.insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "第一章", content: "", word_count: 0, status: "draft", order: 1, outline, created_at: Date.now(), updated_at: Date.now() })
      .run()
    return db
  }

  test("可编译章纲：只读路径计 checked，不计 injected/null", async () => {
    seedOutlineChapter(SCENE_OUTLINE)
    const result = await tools.read_outline.execute({ type: "chapter", number: 1, novel_id: "novel-1" }, ctx())
    expect(result.output).toContain("章纲场景硬约束清单")

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "scene.compile.checked")).toBe(1)
    expect(sumByKey(c2, "scene.compile.null")).toBe(0)
    expect(sumByKey(c2, "scene.injected")).toBe(0)
  })

  test("无章纲场景段：checked + null", async () => {
    seedOutlineChapter("# 第一章大纲\n\n平铺直叙的一章。\n")
    await tools.read_outline.execute({ type: "chapter", number: 1, novel_id: "novel-1" }, ctx())

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "scene.compile.checked")).toBe(1)
    expect(sumByKey(c2, "scene.compile.null")).toBe(1)
  })
})
