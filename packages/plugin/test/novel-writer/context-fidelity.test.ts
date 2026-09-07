/**
 * context-fidelity 测试 — improve-context-fidelity 变更
 *
 * 覆盖：
 * - extractMoodShifts：key_events 情绪转移条目提取
 * - formatSnapshotToolOutput：P2 摘要段的结构化渲染与旧格式降级
 * - analyzeMoodConsistency：情绪转移条目优先 + 点状态比对回落（双向兼容）
 */
import { describe, test, expect } from "bun:test"
import {
  extractMoodShifts,
  formatSnapshotToolOutput,
  MOOD_SHIFT_PREFIX,
  type ChapterSummaryItem,
} from "../../src/novel-writer/context.js"
import { analyzeMoodConsistency } from "../../src/novel-writer/continuity-check.js"

// ── extractMoodShifts ──

describe("extractMoodShifts", () => {
  test("提取带前缀条目并去掉前缀", () => {
    const shifts = extractMoodShifts([
      `${MOOD_SHIFT_PREFIX}林昭:从平静因遇袭变成悲愤`,
      "击败了山贼头目",
      `${MOOD_SHIFT_PREFIX}阿禾:从恐惧因获救变成安心`,
    ])
    expect(shifts).toEqual(["林昭:从平静因遇袭变成悲愤", "阿禾:从恐惧因获救变成安心"])
  })

  test("无前缀条目被忽略，空数组返回空", () => {
    expect(extractMoodShifts(["普通事件一", "普通事件二"])).toEqual([])
    expect(extractMoodShifts([])).toEqual([])
  })
})

// ── formatSnapshotToolOutput P2 渲染 ──

function makeSnapshot(recentChapterSummaries: ChapterSummaryItem[]) {
  return {
    novelTitle: "测试书",
    genre: "玄幻",
    synopsis: "一个测试梗概",
    activeCharacters: [],
    departedCharacters: [],
    volumeSummary: null,
    recentChapterSummaries,
    segmentSummaries: [],
    plotThreads: [],
    foreshadowing: [],
    activeArcs: [],
    styleGuide: null,
    genreRules: [],
    worldEntries: [],
    volumeList: [],
    relationships: [],
    worldEntryIndex: [],
    recalledHistory: [],
    chapterOutline: null,
    prevChapterTail: null,
    targetWordCount: null,
    techniques: [],
  } as Parameters<typeof formatSnapshotToolOutput>[0]
}

describe("formatSnapshotToolOutput 最近章节摘要渲染", () => {
  test("含情绪转移条目时单独展示结构化行", () => {
    const snapshot = makeSnapshot([
      {
        chapterOrder: 1,
        chapterTitle: "第一章",
        summary: "紧接上章当夜，主角在风息城得知师尊遇害，从平静转为悲愤。",
        keyEvents: [`${MOOD_SHIFT_PREFIX}林昭:从平静因师尊遇害变成悲愤`, "发现师尊遗物"],
      },
    ])
    const result = formatSnapshotToolOutput(snapshot, { hooks: [] })
    expect(result.output).toContain("最近章节摘要：")
    expect(result.output).toContain("- 第1章 第一章：紧接上章当夜")
    expect(result.output).toContain("  情绪转移：林昭:从平静因师尊遇害变成悲愤")
  })

  test("多条情绪转移条目以分号合并到一行", () => {
    const snapshot = makeSnapshot([
      {
        chapterOrder: 1,
        chapterTitle: "第一章",
        summary: "摘要",
        keyEvents: [
          `${MOOD_SHIFT_PREFIX}甲:从平静因战败变成绝望`,
          `${MOOD_SHIFT_PREFIX}乙:从绝望因援军变成希望`,
        ],
      },
    ])
    const result = formatSnapshotToolOutput(snapshot, { hooks: [] })
    expect(result.output).toContain("情绪转移：甲:从平静因战败变成绝望；乙:从绝望因援军变成希望")
  })

  test("旧格式摘要（无情绪转移条目）降级为纯摘要行，不报错", () => {
    const snapshot = makeSnapshot([
      { chapterOrder: 2, chapterTitle: "第二章", summary: "旧摘要", keyEvents: ["普通事件"] },
      { chapterOrder: 1, chapterTitle: "第一章", summary: "更旧摘要", keyEvents: [] },
    ])
    const result = formatSnapshotToolOutput(snapshot, { hooks: [] })
    expect(result.output).toContain("- 第1章 第一章：更旧摘要")
    expect(result.output).toContain("- 第2章 第二章：旧摘要")
    expect(result.output).not.toContain("情绪转移")
  })
})

// ── analyzeMoodConsistency ──

function makeCtx(opts: {
  characters: Array<{ id: string; name: string }>
  characterStates: Array<{ character_id: string; mood: string }>
  chapterSummaries: Array<{ key_events: unknown }>
}) {
  return {
    novelId: "novel-1",
    chapterNumber: 3,
    novel: null,
    currentChapter: null,
    currentChapterContent: null,
    allChapters: [],
    characters: opts.characters,
    characterStates: opts.characterStates,
    relationships: [],
    plotThreads: [],
    foreshadowingEntries: [],
    chapterSummaries: opts.chapterSummaries,
    worldEntries: [],
    styleGuide: [],
  } as unknown as Parameters<typeof analyzeMoodConsistency>[0]
}

describe("analyzeMoodConsistency", () => {
  test("有情绪转移条目：对立转移计一次突变", () => {
    const ctx = makeCtx({
      characters: [{ id: "c1", name: "林昭" }],
      characterStates: [{ character_id: "c1", mood: "愤怒" }],
      chapterSummaries: [{ key_events: [`${MOOD_SHIFT_PREFIX}林昭:从平静因遇袭变成愤怒`] }],
    })
    const result = analyzeMoodConsistency(ctx)
    expect(result.totalChars).toBe(1)
    expect(result.rapidChanges).toBe(1)
  })

  test("有情绪转移条目：非对立转移不计突变", () => {
    const ctx = makeCtx({
      characters: [{ id: "c1", name: "林昭" }],
      characterStates: [{ character_id: "c1", mood: "疑惑" }],
      chapterSummaries: [{ key_events: [`${MOOD_SHIFT_PREFIX}林昭:从平静因线索变成疑惑`] }],
    })
    expect(analyzeMoodConsistency(ctx).rapidChanges).toBe(0)
  })

  test("无条目角色回落点状态比对：相邻对立状态计突变（旧路径保持）", () => {
    const ctx = makeCtx({
      characters: [{ id: "c1", name: "林昭" }],
      characterStates: [
        { character_id: "c1", mood: "平静" },
        { character_id: "c1", mood: "愤怒" },
      ],
      chapterSummaries: [{ key_events: ["普通事件"] }],
    })
    expect(analyzeMoodConsistency(ctx).rapidChanges).toBe(1)
  })

  test("条目角色名与角色表不匹配时按无条目回落点状态比对", () => {
    const ctx = makeCtx({
      characters: [{ id: "c1", name: "林昭" }],
      characterStates: [
        { character_id: "c1", mood: "开心" },
        { character_id: "c1", mood: "悲伤" },
      ],
      chapterSummaries: [{ key_events: [`${MOOD_SHIFT_PREFIX}陌生人:从开心因变故变成悲伤`] }],
    })
    expect(analyzeMoodConsistency(ctx).rapidChanges).toBe(1)
  })
})
