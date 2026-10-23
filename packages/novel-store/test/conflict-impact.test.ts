import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  ChapterTable,
  closeDb,
  EntityRefTable,
  getDb,
  MemoryFactTable,
  NovelTable,
  WorldEntryTable,
} from "../src/index.js"
import { buildConflictImpact, conflictImpactChapters, parseConflictImpact } from "../src/conflict-impact.js"

// agent-memory-system Wave 7：冲突单两方向影响成本对比（方向 A 动 N 张卡 / 方向 B 受影响章节清单）。

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `conflict-impact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  db.insert(NovelTable).values({ id: "novel-1", title: "测试小说", genre: "玄幻", created_at: 1, updated_at: 1 }).run()
  for (let order = 1; order <= 3; order++) {
    db.insert(ChapterTable)
      .values({ id: `ch-${order}`, novel_id: "novel-1", title: `第${order}章`, order, created_at: 1, updated_at: 1 })
      .run()
  }
  db.insert(WorldEntryTable)
    .values({ id: "we-1", novel_id: "novel-1", category: "地理", title: "断魂崖", content: "万丈深渊。", created_at: 1 })
    .run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

function seedFact(id: string, entityHint: string | null, chapterId: string | null, status = "pending") {
  const db = getDb(projectDir)
  db.insert(MemoryFactTable)
    .values({
      id,
      novel_id: "novel-1",
      chapter_id: chapterId,
      fact_type: "timeline",
      text: `事实 ${id}`,
      entity_hint: entityHint,
      status,
      created_at: 1,
      updated_at: 1,
    })
    .run()
}

describe("冲突影响成本对比", () => {
  test("方向 A 计引用卡数（id/标题双键命中，retired 排除，含设定本体），方向 B 双源去重按章序", () => {
    seedFact("f-id", "we-1", "ch-2")
    seedFact("f-title", "断魂崖", "ch-3")
    seedFact("f-retired", "we-1", "ch-1", "retired")
    seedFact("f-other", "we-other", "ch-1")

    const db = getDb(projectDir)
    // entity_refs：ch-3 与 ch-1 的正文引用了该条目
    for (const [id, chapterId] of [
      ["ref-1", "ch-3"],
      ["ref-2", "ch-1"],
    ] as const) {
      db.insert(EntityRefTable)
        .values({
          id,
          novel_id: "novel-1",
          source_type: "chapter",
          source_id: chapterId,
          target_type: "world_entry",
          target_id: "we-1",
          ref_field: "content",
          created_at: 1,
        })
        .run()
    }

    const impact = buildConflictImpact(db, "novel-1", "we-1")

    // 方向 A：f-id + f-title 两张事实卡 + 设定本体 = 3；retired 与他实体不计
    expect(impact.directionA.cards).toBe(3)
    expect(impact.directionA.factIds).toEqual(expect.arrayContaining(["f-id", "f-title"]))

    // 方向 B：entity_refs（ch-1/ch-3）∪ 事实所属章（ch-2/ch-3）→ 去重后按章序 [1, 2, 3]
    expect(impact.directionB.chapters.map((c) => c.id)).toEqual(["ch-1", "ch-2", "ch-3"])
    expect(impact.directionB.chapters[0]?.title).toBe("第1章")
  })

  test("无引用时方向 B 为空清单，条目缺失时仅按 id 匹配", () => {
    const db = getDb(projectDir)
    const empty = buildConflictImpact(db, "novel-1", "we-1")
    expect(empty.directionA.cards).toBe(1)
    expect(empty.directionB.chapters).toEqual([])

    const missing = buildConflictImpact(db, "novel-1", "we-missing")
    expect(missing.directionA.cards).toBe(1)
    expect(missing.directionB.chapters).toEqual([])
  })

  test("parseConflictImpact 坏 JSON / 缺字段返回 null；conflictImpactChapters 缓存命中与现算兜底", () => {
    expect(parseConflictImpact("not json")).toBeNull()
    expect(parseConflictImpact("{}")).toBeNull()
    expect(parseConflictImpact('{"directionA":{"cards":"x","factIds":[]},"directionB":{"chapters":[]}}')).toBeNull()

    seedFact("f-1", "we-1", "ch-2")
    const db = getDb(projectDir)
    const impact = buildConflictImpact(db, "novel-1", "we-1")
    const parsed = parseConflictImpact(JSON.stringify(impact))
    expect(parsed?.directionA.cards).toBe(2)

    // 缓存命中：直接用缓存章节，不重算
    const cached = JSON.stringify({
      directionA: { cards: 9, factIds: [] },
      directionB: { chapters: [{ id: "ch-9", order: 9, title: "缓存章" }] },
    })
    expect(conflictImpactChapters(db, "novel-1", "we-1", cached).map((c) => c.id)).toEqual(["ch-9"])
    // 缓存损坏：现算兜底（f-1 所属 ch-2）
    expect(conflictImpactChapters(db, "novel-1", "we-1", "{}").map((c) => c.id)).toEqual(["ch-2"])
  })
})
