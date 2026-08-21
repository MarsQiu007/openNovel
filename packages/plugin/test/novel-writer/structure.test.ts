/**
 * structure.ts 确定性结构检查测试
 */
import { describe, test, expect } from "bun:test"
import { checkStructure, checkArcCoverage, type StoryArcLite, type ArcBeatLite, type PlotThreadLite, type ForeshadowingLite, type ChapterLite } from "../../src/novel-writer/structure.js"

function makeArc(overrides: Partial<StoryArcLite> = {}): StoryArcLite {
  return {
    id: "arc-1",
    arc_type: "narrative",
    title: "主线",
    status: "active",
    planned_start_chapter: 1,
    planned_end_chapter: 50,
    actual_start_chapter: null,
    actual_end_chapter: null,
    ...overrides,
  }
}

function makeBeat(overrides: Partial<ArcBeatLite> = {}): ArcBeatLite {
  return {
    id: "beat-1",
    arc_id: "arc-1",
    chapter_id: "ch-1",
    chapter_order: 1,
    kind: "setup",
    status: "drafted",
    ...overrides,
  }
}

describe("checkArcCoverage", () => {
  test("检测高潮和结局节点", () => {
    const arcs = [makeArc()]
    const beats = [
      makeBeat({ kind: "setup", chapter_order: 1 }),
      makeBeat({ id: "beat-2", kind: "climax", chapter_order: 48 }),
      makeBeat({ id: "beat-3", kind: "resolution", chapter_order: 50 }),
    ]
    const coverage = checkArcCoverage(arcs, beats)
    expect(coverage[0].hasClimax).toBe(true)
    expect(coverage[0].hasResolution).toBe(true)
    expect(coverage[0].beatCount).toBe(3)
    expect(coverage[0].actualRange).toEqual({ start: 1, end: 50 })
  })

  test("缺少高潮和结局时标记", () => {
    const arcs = [makeArc()]
    const beats = [makeBeat({ kind: "setup" })]
    const coverage = checkArcCoverage(arcs, beats)
    expect(coverage[0].hasClimax).toBe(false)
    expect(coverage[0].hasResolution).toBe(false)
  })
})

describe("checkStructure", () => {
  test("已到规划终点但缺高潮报 high", () => {
    const arcs = [makeArc({ planned_end_chapter: 10 })]
    const beats = [makeBeat({ kind: "setup", chapter_order: 1 })]
    const chapters: ChapterLite[] = Array.from({ length: 12 }, (_, i) => ({
      id: `ch-${i + 1}`,
      order: i + 1,
      status: "draft",
    }))
    const report = checkStructure({ arcs, beats, threads: [], foreshadowing: [], chapters })
    const issue = report.issues.find((i) => i.category === "arc_missing_climax")
    expect(issue?.severity).toBe("high")
  })

  test("高优先级线索超过3条报 medium", () => {
    const threads: PlotThreadLite[] = Array.from({ length: 4 }, (_, i) => ({
      id: `t-${i}`,
      title: `线索${i}`,
      status: "open",
      priority: "high",
    }))
    const report = checkStructure({ arcs: [], beats: [], threads, foreshadowing: [], chapters: [] })
    expect(report.issues.some((i) => i.category === "too_many_high_priority_threads")).toBe(true)
    expect(report.openThreadCount).toBe(4)
  })

  test("伏笔超过30章未回收报 medium", () => {
    const foreshadowing: ForeshadowingLite[] = [
      { id: "fs-1", content: "神秘钥匙", state: "planted", planted_chapter_id: "ch-1", resolved_chapter_id: null },
    ]
    const chapters: ChapterLite[] = Array.from({ length: 35 }, (_, i) => ({
      id: `ch-${i + 1}`,
      order: i + 1,
      status: "draft",
    }))
    const report = checkStructure({ arcs: [], beats: [], threads: [], foreshadowing, chapters })
    expect(report.issues.some((i) => i.category === "foreshadowing_stale")).toBe(true)
    expect(report.unresolvedForeshadowingCount).toBe(1)
  })

  test("结构线标记完成但缺结局节点报 high", () => {
    const arcs = [makeArc({ status: "completed", planned_end_chapter: 10 })]
    const beats = [
      makeBeat({ kind: "setup", chapter_order: 1 }),
      makeBeat({ id: "beat-2", kind: "climax", chapter_order: 9 }),
    ]
    const report = checkStructure({ arcs, beats, threads: [], foreshadowing: [], chapters: [] })
    expect(
      report.issues.some((i) => i.category === "arc_completed_without_resolution"),
    ).toBe(true)
  })

  test("正常结构无 high 问题", () => {
    const arcs = [makeArc()]
    const beats = [
      makeBeat({ kind: "setup", chapter_order: 1 }),
      makeBeat({ id: "beat-2", kind: "climax", chapter_order: 48 }),
      makeBeat({ id: "beat-3", kind: "resolution", chapter_order: 50 }),
    ]
    const report = checkStructure({ arcs, beats, threads: [], foreshadowing: [], chapters: [] })
    expect(report.issues.filter((i) => i.severity === "high")).toHaveLength(0)
  })
})