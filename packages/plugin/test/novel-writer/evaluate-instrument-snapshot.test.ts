/**
 * 自评价埋点 — 快照装配与上下文渲染（1.3）
 *
 * 只断埋点键与计数，不断快照内容本身（内容回归由既有快照测试负责）：
 * - 场景清单编译率：scene.compile.checked / .null / scene.injected
 * - 三路召回：recall.zero（空召回）与 recall.route.<route>（命中分布）
 * - 预算：budget.<level>.occupied 占用计数
 * - context-source：context.render.full / context.render.incremental 渲染分支
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeDb, getDb, NovelTable, ChapterTable, ChapterSummaryTable, CharacterTable } from "../../src/novel-writer/session-store.js"
import { assembleWriterSnapshot } from "../../src/novel-writer/recall.js"
import { readMetrics } from "../../src/novel-writer/evaluate/metrics.js"
import { createNovelContextSource } from "../../src/novel-writer/context-source.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `eval-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function seedNovel() {
  const db = getDb(projectDir)
  const now = Date.now()
  db.insert(NovelTable)
    .values({ id: "novel-1", title: "埋点书", genre: "玄幻", synopsis: "一段梗概", status: "draft", created_at: now, updated_at: now })
    .run()
  return db
}

function seedChapter(order: number, outline: string) {
  const db = getDb(projectDir)
  const now = Date.now()
  db.insert(ChapterTable)
    .values({ id: `ch-${order}`, novel_id: "novel-1", title: `第${order}章`, content: "", word_count: 0, status: "draft", order, outline, created_at: now, updated_at: now })
    .run()
  return db
}

const SCENE_OUTLINE = `# 第一章大纲

## 关键场景
### 场景1
- **地点**：青石城
- **时间**：清晨
- **场景概要**：主角登场
`

const PLAIN_OUTLINE = `# 第一章大纲

本章完成主角登场与身世揭示。
`

function domainEntries(domain: string) {
  return readMetrics(projectDir).entries.filter((e) => e.domain === domain)
}

function sumByKey(entries: Array<{ key: string; delta: number }>, prefix: string) {
  return entries.filter((e) => e.key.startsWith(prefix)).reduce((sum, e) => sum + e.delta, 0)
}

describe("assembleWriterSnapshot 埋点", () => {
  test("可编译章纲：scene.compile.checked + scene.injected；空召回记 recall.zero", async () => {
    seedNovel()
    seedChapter(1, SCENE_OUTLINE)

    const snapshot = await assembleWriterSnapshot("novel-1", 1, projectDir)
    expect(snapshot).not.toBeNull()

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "scene.compile.checked")).toBe(1)
    expect(sumByKey(c2, "scene.injected")).toBe(1)
    expect(sumByKey(c2, "scene.compile.null")).toBe(0)

    // 无历史章节/线索/伏笔，三路召回必然落空
    expect(sumByKey(domainEntries("c3-recall"), "recall.zero")).toBe(1)
  })

  test("无章纲场景段：scene.compile.checked + scene.compile.null，不记 injected", async () => {
    seedNovel()
    seedChapter(1, PLAIN_OUTLINE)

    await assembleWriterSnapshot("novel-1", 1, projectDir)

    const c2 = domainEntries("c2-prompt-control")
    expect(sumByKey(c2, "scene.compile.checked")).toBe(1)
    expect(sumByKey(c2, "scene.compile.null")).toBe(1)
    expect(sumByKey(c2, "scene.injected")).toBe(0)
  })

  test("有角色时记 budget 占用；早期章 FTS 命中记 recall.route", async () => {
    const db = seedNovel()
    const now = Date.now()
    db.insert(CharacterTable)
      .values({ id: "char-1", novel_id: "novel-1", name: "林昭", role: "主角", description: "青石城少主" })
      .run()
    // 第 1 章为早期历史章（当前第 5 章的近 3 章窗口之外），FTS 正文含与章纲相同的三字短语
    db.insert(ChapterTable)
      .values({ id: "ch-1", novel_id: "novel-1", title: "序章", content: "正文", word_count: 2, status: "final", order: 1, created_at: now, updated_at: now })
      .run()
    db.insert(ChapterSummaryTable)
      .values({ id: "sum-1", chapter_id: "ch-1", summary: "林昭在青石城觉醒。" })
      .run()
    for (let order = 2; order <= 4; order++) {
      db.insert(ChapterTable)
        .values({ id: `ch-${order}`, novel_id: "novel-1", title: `第${order}章`, content: "正文", word_count: 2, status: "final", order, created_at: now, updated_at: now })
        .run()
    }
    const { sql } = await import("drizzle-orm")
    db.run(sql`INSERT INTO chapter_summary_fts (novel_id, chapter_id, chapter_order, title, body) VALUES (${"novel-1"}, ${"ch-1"}, ${1}, ${"序章"}, ${"林昭在青石城觉醒 青石城"})`)
    // 当前章章纲的场景字段带「青石城」→ 关键短语命中第 1 章 FTS 正文
    seedChapter(5, `# 第五章大纲

## 关键场景
### 场景1
- **地点**：青石城
- **场景概要**：林昭返城
`)

    await assembleWriterSnapshot("novel-1", 5, projectDir)

    const c4 = domainEntries("c4-context")
    // 角色在场 → P1 层有占用（具体级别随预算分层实现，只断 occupied 计数面非零且不为负）
    expect(sumByKey(c4, "budget.")).toBeGreaterThan(0)
    for (const e of c4.filter((e) => e.key.endsWith(".occupied"))) {
      expect(e.delta).toBeGreaterThan(0)
    }
    // 早期章被 FTS 路召回：记 route 分布而非 zero
    expect(sumByKey(domainEntries("c3-recall"), "recall.zero")).toBe(0)
    expect(sumByKey(domainEntries("c3-recall"), "recall.route.")).toBeGreaterThan(0)
  })
})

describe("context-source 渲染分支埋点", () => {
  test("baseline 记 full；语义变化 update 记 full，仅快照变化记 incremental", () => {
    const source = createNovelContextSource({
      session: { get: async () => undefined },
      directory: projectDir,
      configDir: projectDir,
    })

    source.baseline({ mode: "【模式】" })
    source.update({ mode: "【模式】" }, { mode: "【模式】", snapshot: "【快照v2】" })
    source.update({ mode: "【模式】", snapshot: "【快照v2】" }, { mode: "【新模式】", snapshot: "【快照v3】" })

    const c4 = domainEntries("c4-context")
    expect(sumByKey(c4, "context.render.full")).toBe(2)
    expect(sumByKey(c4, "context.render.incremental")).toBe(1)
  })
})
