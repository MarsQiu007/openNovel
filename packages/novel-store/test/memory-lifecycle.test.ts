import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  ChapterTable,
  CharacterTable,
  closeDb,
  getDb,
  MemoryFactTable,
  MemoryInjectionSnapshotTable,
  NovelTable,
  TechniqueTable,
  WorldEntryTable,
} from "../src/index.js"
import {
  buildMaintenanceReport,
  consolidateChapterFacts,
  consolidateChapterFactsTx,
  invalidateChapterFactsByQuote,
  markChapterFactsReviewed,
  PLANNED_STALL_CHAPTER_THRESHOLD,
  rebuildNextChapterSnapshot,
  retireFactsForEntity,
} from "../src/memory-lifecycle.js"
import { withTransaction } from "../src/tx.js"

// agent-memory-system Wave 6：生命周期状态机流转（pending→reviewed / stale / retired）与审批预计算。

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `memory-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  db.insert(NovelTable).values({ id: "novel-1", title: "测试小说", genre: "玄幻", created_at: 1, updated_at: 1 }).run()
  for (let order = 1; order <= 3; order++) {
    db.insert(ChapterTable)
      .values({ id: `ch-${order}`, novel_id: "novel-1", title: `第${order}章`, order, created_at: 1, updated_at: 1 })
      .run()
  }
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function seedFact(id: string, overrides: Partial<typeof MemoryFactTable.$inferInsert> = {}) {
  const db = getDb(projectDir)
  db.insert(MemoryFactTable)
    .values({
      id,
      novel_id: "novel-1",
      chapter_id: "ch-1",
      fact_type: "timeline",
      text: `事实 ${id}`,
      created_at: 1,
      updated_at: 1,
      ...overrides,
    })
    .run()
}

function factStatus(id: string): string {
  const db = getDb(projectDir)
  const row = db.select({ status: MemoryFactTable.status }).from(MemoryFactTable).where(eq(MemoryFactTable.id, id)).get()
  return row!.status
}

describe("记忆生命周期", () => {
  test("审计校准：本章 observer 未决事实 pending → reviewed，作者手记与他章不动", () => {
    seedFact("f-observer", { status: "pending", created_by: "observer" })
    seedFact("f-author", { status: "pending", created_by: "author" })
    seedFact("f-reviewed", { status: "reviewed", created_by: "observer" })
    seedFact("f-other-chapter", { status: "pending", created_by: "observer", chapter_id: "ch-2" })

    const db = getDb(projectDir)
    expect(markChapterFactsReviewed(db, "novel-1", "ch-1")).toBe(1)

    expect(factStatus("f-observer")).toBe("reviewed")
    expect(factStatus("f-author")).toBe("pending")
    expect(factStatus("f-reviewed")).toBe("reviewed")
    expect(factStatus("f-other-chapter")).toBe("pending")
    // 幂等：再次流转无未决事实
    expect(markChapterFactsReviewed(db, "novel-1", "ch-1")).toBe(0)
  })

  test("文本变更失效：引句命中正文不动，未命中 → stale；无引句与 retired 不动", () => {
    seedFact("f-hit", { quote: "断魂崖上风雪大作" })
    seedFact("f-miss", { quote: "银瞳在月下泛起微光" })
    seedFact("f-no-quote", {})
    seedFact("f-retired", { quote: "已退休的引句", status: "retired" })

    const db = getDb(projectDir)
    const content = "……断魂崖上风雪大作，林天裹紧了斗篷……"
    const stale = invalidateChapterFactsByQuote(db, "novel-1", "ch-1", content)

    expect(stale).toEqual(["f-miss"])
    expect(factStatus("f-hit")).toBe("pending")
    expect(factStatus("f-miss")).toBe("stale")
    expect(factStatus("f-no-quote")).toBe("pending")
    expect(factStatus("f-retired")).toBe("retired")
  })

  test("设定被删：entity_hint 命中的事实 → retired 留痕，不删行不误伤", () => {
    seedFact("f-by-id", { entity_hint: "char-1" })
    seedFact("f-by-name", { entity_hint: "林天" })
    seedFact("f-other", { entity_hint: "char-2" })
    seedFact("f-already-retired", { entity_hint: "char-1", status: "retired" })

    const db = getDb(projectDir)
    expect(retireFactsForEntity(db, "novel-1", "char-1")).toBe(1)
    expect(retireFactsForEntity(db, "novel-1", "林天")).toBe(1)

    expect(factStatus("f-by-id")).toBe("retired")
    expect(factStatus("f-by-name")).toBe("retired")
    expect(factStatus("f-other")).toBe("pending")
    expect(factStatus("f-already-retired")).toBe("retired")

    // 留痕不删行：四行俱在
    const db2 = getDb(projectDir)
    expect(db2.select({ id: MemoryFactTable.id }).from(MemoryFactTable).all()).toHaveLength(4)
    // 幂等：重复退休返回 0
    expect(retireFactsForEntity(db, "novel-1", "char-1")).toBe(0)
  })

  test("章审批预计算：为下一章重建快照，末章与缺失章 no-op", async () => {
    const db = getDb(projectDir)

    expect(await rebuildNextChapterSnapshot(db, "novel-1", "ch-1")).toBe(true)
    const snapshot = db
      .select()
      .from(MemoryInjectionSnapshotTable)
      .where(eq(MemoryInjectionSnapshotTable.chapter_id, "ch-2"))
      .get()
    expect(snapshot?.novel_id).toBe("novel-1")

    // 末章（ch-3 之后无章节）与缺失章：no-op
    expect(await rebuildNextChapterSnapshot(db, "novel-1", "ch-3")).toBe(false)
    expect(await rebuildNextChapterSnapshot(db, "novel-1", "ch-missing")).toBe(false)
  })

  // ─── Wave 9：§6 整理与维护 ───────────────────────────────────────────────

  test("事件驱动整理：规范化文本相同的卡合并，高确认级别者优先保留", () => {
    // 同组三张卡：空白差异应被规范化折叠；approved > reviewed > pending
    seedFact("f-dup-pending", { text: "三日后抵达断魂崖", status: "pending", entity_hint: "林天" })
    seedFact("f-dup-approved", { text: "三日后 抵达断魂崖 ", status: "approved", entity_hint: "林天" })
    seedFact("f-dup-reviewed", { text: "三日后抵达断魂崖", status: "reviewed", entity_hint: "林天" })
    // 不并：不同实体提示 / 不同事实类型 / 不同文本
    seedFact("f-other-hint", { text: "三日后抵达断魂崖", entity_hint: "路人" })
    seedFact("f-other-type", { text: "三日后抵达断魂崖", fact_type: "setting", entity_hint: "林天" })
    seedFact("f-other-text", { text: "五日后抵达断魂崖", entity_hint: "林天" })
    // retired 终态不参与分组
    seedFact("f-retired-dup", { text: "三日后抵达断魂崖", status: "retired", entity_hint: "林天" })

    const db = getDb(projectDir)
    const merged = consolidateChapterFacts(db, "novel-1", "ch-1")
    expect(merged).toEqual([{ kept: "f-dup-approved", retired: expect.arrayContaining(["f-dup-pending", "f-dup-reviewed"]) }])

    expect(factStatus("f-dup-approved")).toBe("approved")
    expect(factStatus("f-dup-pending")).toBe("retired")
    expect(factStatus("f-dup-reviewed")).toBe("retired")
    // 留痕可撤销：被并卡指向保留卡，行不删除
    const retiredRow = db
      .select({ retired_into: MemoryFactTable.retired_into })
      .from(MemoryFactTable)
      .where(eq(MemoryFactTable.id, "f-dup-pending"))
      .get()
    expect(retiredRow?.retired_into).toBe("f-dup-approved")
    expect(db.select({ id: MemoryFactTable.id }).from(MemoryFactTable).all()).toHaveLength(7)

    // 不并的三张卡与原 retired 不动
    expect(factStatus("f-other-hint")).toBe("pending")
    expect(factStatus("f-other-type")).toBe("pending")
    expect(factStatus("f-other-text")).toBe("pending")
    expect(factStatus("f-retired-dup")).toBe("retired")

    // 幂等：再次整理无重复组
    expect(consolidateChapterFacts(db, "novel-1", "ch-1")).toEqual([])
  })

  test("事件驱动整理：同状态按创建时间/id 确定性决胜，Tx 组合形态可嵌外层事务", () => {
    seedFact("f-late", { text: "同文事实", created_at: 2 })
    seedFact("f-early", { text: "同文事实", created_at: 1 })

    const db = getDb(projectDir)
    const merged = withTransaction(db, (tx) => consolidateChapterFactsTx(tx, "novel-1", "ch-1"))
    expect(merged).toEqual([{ kept: "f-early", retired: ["f-late"] }])
    expect(factStatus("f-late")).toBe("retired")
  })

  test("定时兜底报告：僵尸卡 + planned 滞留分界 + retired 归档统计（报告制不删行）", () => {
    // 僵尸卡：stale（带章 / 无章）与 approved（不计入）
    seedFact("f-stale-1", { status: "stale", chapter_id: "ch-2", text: "失效事实一" })
    seedFact("f-stale-2", { status: "stale", chapter_id: null, text: "失效事实二" })
    seedFact("f-ok", { status: "approved" })
    // retired 归档：事实 1 张 + 技巧 1 条
    seedFact("f-retired", { status: "retired" })
    const db = getDb(projectDir)
    db.insert(TechniqueTable)
      .values({
        id: "tech-retired",
        name: "已固化技法",
        principle: "p",
        instruction: "i",
        level: "scene",
        status: "retired",
        novel_id: "novel-1",
        created_at: 1,
        updated_at: 1,
      })
      .run()

    // planned：老设定（创建后新增章数达阈值 → 滞留）与新设定（未达阈值）
    db.insert(CharacterTable)
      .values({ id: "char-old", novel_id: "novel-1", name: "老设定角色", establishment: "planned", created_at: 1 })
      .run()
    db.insert(WorldEntryTable)
      .values({ id: "we-new", novel_id: "novel-1", category: "物品", title: "新设定", establishment: "planned", created_at: 1000 })
      .run()
    // 既有三章 created_at=1（与老设定同时，不计入）；补阈值数量级的新章
    for (let i = 0; i < PLANNED_STALL_CHAPTER_THRESHOLD; i++) {
      db.insert(ChapterTable)
        .values({ id: `ch-new-${i}`, novel_id: "novel-1", title: `新章${i}`, order: 100 + i, created_at: 2, updated_at: 2 })
        .run()
    }

    const report = buildMaintenanceReport(db, "novel-1")

    expect(report.zombieFacts.map((z) => z.id)).toEqual(["f-stale-1", "f-stale-2"])
    expect(report.zombieFacts[0].chapterOrder).toBe(2)
    expect(report.zombieFacts[1].chapterOrder).toBeNull()

    const oldChar = report.planned.find((p) => p.id === "char-old")
    expect(oldChar).toMatchObject({ kind: "character", title: "老设定角色", chaptersSince: PLANNED_STALL_CHAPTER_THRESHOLD, stalled: true })
    const newEntry = report.planned.find((p) => p.id === "we-new")
    expect(newEntry).toMatchObject({ kind: "world_entry", chaptersSince: 0, stalled: false })
    // 滞留者优先
    expect(report.planned[0].id).toBe("char-old")

    expect(report.retiredStats).toEqual({ facts: 1, techniques: 1 })

    // 报告制：只读不删，所有行保持原状
    expect(factStatus("f-stale-1")).toBe("stale")
    expect(db.select({ id: MemoryFactTable.id }).from(MemoryFactTable).all()).toHaveLength(4)
  })
})
