/**
 * event-arc-planning：跨章事件段规划的快照渲染与提示词对齐测试。
 *
 * 覆盖任务 1.2 的渲染边界（状态标注/推进目标/完结提示三态、note 备注不计入、
 * 窗口外推进目标补充行、角色弧不挂提示）与 loadActiveArcs 全量进度判定
 * （不受 ±3/+5 窗口与每弧 8 节点上限截断），以及任务 2.2 的 outlier/writer
 * 提示词结构断言。纯静态断言 + 内存 DB，不触 LLM。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  closeDb,
  getDb,
  NovelTable,
  StoryArcTable,
  ArcBeatTable,
} from "../../src/novel-writer/session-store.js"
import { loadActiveArcs, formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { outlinerAgent } from "../../src/novel-writer/agents/outliner.js"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `arc-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件句柄释放有延迟，尽力清理即可
  }
})

type Beat = {
  id: string
  label: string
  kind: string
  status: string
  chapterOrder: number | null
}

function makeArc(overrides: {
  id?: string
  arcType?: string
  status?: string
  beats: Beat[]
  total: number
  drafted: number
  nextUndrafted: { id: string; label: string; kind: string } | null
}) {
  return {
    id: overrides.id ?? "arc-1",
    arcType: overrides.arcType ?? "narrative",
    title: "测试事件",
    summary: "一个进行中大事件",
    status: overrides.status ?? "active",
    targetCharacterName: null,
    plannedStartChapter: null,
    plannedEndChapter: null,
    beats: overrides.beats.map((b) => ({ ...b, summary: "" })),
    beatProgress: {
      total: overrides.total,
      drafted: overrides.drafted,
      nextUndrafted: overrides.nextUndrafted,
    },
  }
}

function makeSnapshot(arcs: ReturnType<typeof makeArc>[]) {
  return {
    novelTitle: "测试",
    genre: "科幻",
    synopsis: "梗概",
    activeCharacters: [],
    departedCharacters: [],
    volumeSummary: null,
    recentChapterSummaries: [],
    segmentSummaries: [],
    recalledHistory: [],
    chapterOutline: null,
    prevChapterTail: null,
    targetWordCount: null,
    techniques: [],
    plotThreads: [],
    foreshadowing: [],
    activeArcs: arcs,
    worldEntries: [],
    worldEntryIndex: [],
    volumeList: [],
    relationships: [],
    protectedRelationships: [],
    relationshipContextTruncated: false,
    genreRules: [],
    styleGuide: null,
    characterBindingView: undefined,
  } as never
}

function render(arcs: ReturnType<typeof makeArc>[]) {
  return formatSnapshotToolOutput(makeSnapshot(arcs), { hooks: [] }).output
}

describe("结构线节点落地状态渲染（1.1/1.2）", () => {
  test("进行中事件：状态标注 + 推进目标 + 不得完结提示", () => {
    const arc = makeArc({
      beats: [
        { id: "b1", label: "事件开启", kind: "setup", status: "drafted", chapterOrder: 2 },
        { id: "b2", label: "冲突升温", kind: "rising", status: "drafted", chapterOrder: 3 },
        { id: "b3", label: "真相转折", kind: "turn", status: "planned", chapterOrder: 4 },
        { id: "b4", label: "事件高潮", kind: "climax", status: "planned", chapterOrder: 5 },
      ],
      total: 4,
      drafted: 2,
      nextUndrafted: { id: "b3", label: "真相转折", kind: "turn" },
    })
    const output = render([arc])
    expect(output).toContain("═══ 结构线/弧光（本章需推进）═══")
    expect(output).toContain("✅")
    expect(output).toContain("○")
    expect(output).toContain("👉本章推进目标 [转折]")
    expect(output).toContain("本章不得完结该事件（尚有 2 个未落地节点）")
    // 下一推进目标是 b3 而非 b4
    expect(output).not.toContain("👉本章推进目标 [高潮]")
  })

  test("仅剩最后一个未落地节点：提示变「本章可完结」（按全量节点判定）", () => {
    const arc = makeArc({
      beats: [
        // 窗口内只见最后一个未落地节点（前面 7 个已落地节点在窗口外被截断）
        { id: "b8", label: "事件高潮", kind: "climax", status: "planned", chapterOrder: 9 },
      ],
      total: 8,
      drafted: 7,
      nextUndrafted: { id: "b8", label: "事件高潮", kind: "climax" },
    })
    const output = render([arc])
    expect(output).toContain("本章可完结")
    expect(output).not.toContain("不得完结")
  })

  test("全部结构节点已落地：active 常驻也不挂提示（无结局节点事件）", () => {
    const arc = makeArc({
      beats: [{ id: "b1", label: "事件开启", kind: "setup", status: "drafted", chapterOrder: 2 }],
      total: 1,
      drafted: 1,
      nextUndrafted: null,
    })
    const output = render([arc])
    expect(output).toContain("✅")
    expect(output).not.toContain("不得完结")
    expect(output).not.toContain("本章可完结")
  })

  test("kind=note 备注不计入未落地判定", () => {
    const arc = makeArc({
      beats: [
        { id: "b1", label: "事件结局", kind: "resolution", status: "drafted", chapterOrder: 5 },
        { id: "n1", label: "作者备注", kind: "note", status: "planned", chapterOrder: null },
      ],
      total: 1,
      drafted: 1,
      nextUndrafted: null,
    })
    const output = render([arc])
    // 备注照常渲染状态标注，但不产生任何完结提示
    expect(output).toContain("○")
    expect(output).not.toContain("不得完结")
    expect(output).not.toContain("本章可完结")
  })

  test("无 active 弧光：无完结提示且其余结构不变", () => {
    const output = render([])
    expect(output).not.toContain("不得完结")
    expect(output).not.toContain("本章可完结")
    expect(output).not.toContain("结构线/弧光")
  })

  test("下一推进目标不在展示窗口内时输出补充行", () => {
    const arc = makeArc({
      beats: [{ id: "b1", label: "事件开启", kind: "setup", status: "drafted", chapterOrder: 2 }],
      total: 3,
      drafted: 1,
      nextUndrafted: { id: "b9", label: "事件高潮", kind: "climax" },
    })
    const output = render([arc])
    expect(output).toContain("👉本章推进目标 [高潮]（未在展示窗口内） 事件高潮")
  })

  test("character 角色弧不挂完结提示", () => {
    const arc = makeArc({
      arcType: "character",
      beats: [
        { id: "b1", label: "弧光开场", kind: "setup", status: "drafted", chapterOrder: 1 },
        { id: "b2", label: "弧光转折", kind: "turn", status: "planned", chapterOrder: 2 },
        { id: "b3", label: "弧光结局", kind: "resolution", status: "planned", chapterOrder: 3 },
      ],
      total: 3,
      drafted: 1,
      nextUndrafted: { id: "b2", label: "弧光转折", kind: "turn" },
    })
    const output = render([arc])
    expect(output).toContain("👉本章推进目标")
    expect(output).not.toContain("不得完结")
    expect(output).not.toContain("本章可完结")
  })
})

describe("loadActiveArcs 全量进度判定（1.1/1.2）", () => {
  async function seedArc(beatSpecs: { order: number | null; kind: string; status: string }[]) {
    const db = getDb(dir)
    await db
      .insert(NovelTable)
      .values({ id: "novel-1", title: "进度测试", genre: "玄幻", synopsis: "", status: "draft" })
      .run()
    await db
      .insert(StoryArcTable)
      .values({
        id: "arc-full",
        novel_id: "novel-1",
        arc_type: "narrative",
        title: "跨章事件",
        summary: "",
        status: "active",
        planned_start_chapter: 1,
        planned_end_chapter: 20,
      })
      .run()
    for (let i = 0; i < beatSpecs.length; i++) {
      const spec = beatSpecs[i]
      await db
        .insert(ArcBeatTable)
        .values({
          id: `beat-${i + 1}`,
          novel_id: "novel-1",
          arc_id: "arc-full",
          chapter_order: spec.order,
          label: `节点${i + 1}`,
          kind: spec.kind,
          status: spec.status,
        })
        .run()
    }
    return db
  }

  test("进度按全量节点判定，不受 ±3/+5 窗口与每弧 8 节点上限截断", async () => {
    // 10 个结构节点锚定 ch1..ch10，当前章 8：窗口内只见 ch5..ch10（6 个）
    const db = await seedArc(
      Array.from({ length: 10 }, (_, i) => ({
        order: i + 1,
        kind: i === 9 ? "resolution" : "rising",
        status: i < 7 ? "drafted" : "planned",
      })),
    )
    const arcs = await loadActiveArcs(db, "novel-1", 8, new Map())
    expect(arcs.length).toBe(1)
    const arc = arcs[0]
    // 窗口截断只影响展示
    expect(arc.beats.length).toBe(6)
    // 全量进度：10 个结构节点，7 已落地，下一个未落地是 ch8 的节点
    expect(arc.beatProgress.total).toBe(10)
    expect(arc.beatProgress.drafted).toBe(7)
    expect(arc.beatProgress.nextUndrafted).not.toBeNull()
    expect(arc.beatProgress.nextUndrafted!.label).toBe("节点8")
  })

  test("全部结构节点已落地（含无结局节点场景）时 nextUndrafted 为 null", async () => {
    const db = await seedArc(
      Array.from({ length: 4 }, (_, i) => ({ order: i + 1, kind: "rising", status: "drafted" as string })),
    )
    const arcs = await loadActiveArcs(db, "novel-1", 3, new Map())
    expect(arcs.length).toBe(1)
    expect(arcs[0].beatProgress.total).toBe(4)
    expect(arcs[0].beatProgress.drafted).toBe(4)
    expect(arcs[0].beatProgress.nextUndrafted).toBeNull()
  })

  test("kind=note 备注不计入进度统计", async () => {
    const db = await seedArc([
      { order: 1, kind: "setup", status: "drafted" },
      { order: 2, kind: "resolution", status: "drafted" },
      { order: null, kind: "note", status: "planned" },
    ])
    const arcs = await loadActiveArcs(db, "novel-1", 2, new Map())
    expect(arcs.length).toBe(1)
    expect(arcs[0].beatProgress.total).toBe(2)
    expect(arcs[0].beatProgress.drafted).toBe(2)
    expect(arcs[0].beatProgress.nextUndrafted).toBeNull()
  })
})

describe("outliner 跨章规划提示词（2.1/2.2）", () => {
  test("提示词包含跨章硬规则三要素：推进目标/禁止落地高潮结局/continuity 记录剩余进度", () => {
    const prompt = outlinerAgent.prompt
    expect(prompt).toContain("跨章事件段规划")
    expect(prompt).toContain("推进该事件的下一个未落地节点")
    expect(prompt).toContain("禁止")
    expect(prompt).toContain("高潮/结局节点")
    expect(prompt).toContain("记录事件剩余进度")
  })

  test("规则在存在/不存在进行中事件两种情形均可验证", () => {
    const prompt = outlinerAgent.prompt
    expect(prompt).toContain("未落地节点 ≥ 2")
    expect(prompt).toContain("本章可完结")
    expect(prompt).toContain("无进行中事件时")
  })

  test("author_intent 优先于默认规则", () => {
    const prompt = outlinerAgent.prompt
    expect(prompt).toContain("author_intent 优先")
    expect(prompt).toContain("此事件再写 2-3 章，不要提前结束")
    expect(prompt).toContain("以 author_intent 为准")
  })

  test("快照层级清单列出 P3b 结构线段", () => {
    expect(outlinerAgent.prompt).toContain("P3b 结构线/弧光")
  })

  test("输出格式 continuity 含 eventProgress 字段", () => {
    expect(outlinerAgent.prompt).toContain('"eventProgress"')
  })
})

describe("writer 章末钩子规则微调（3.1）", () => {
  test("钩子法则区分事件内章节与完结章节", () => {
    const prompt = writerAgentConfig.systemPrompt
    expect(prompt).toContain("本章不得完结")
    expect(prompt).toContain("事件内部的悬念升级或转折")
    expect(prompt).toContain("不得为了制造收束感提前落地事件的高潮/结局")
    expect(prompt).toContain("本章可完结")
  })
})