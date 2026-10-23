import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { ChapterTable, closeDb, getDb, MemoryFactTable, MemoryInjectionSnapshotTable, NovelTable } from "../src/index.js"
import {
  invalidateChapterFactsByQuote,
  markChapterFactsReviewed,
  rebuildNextChapterSnapshot,
  retireFactsForEntity,
} from "../src/memory-lifecycle.js"

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
})
