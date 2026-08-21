import { describe, test, expect } from "bun:test"
import { applyBudget } from "../../src/novel-writer/budget.js"
import type { ContextPacket } from "../../src/novel-writer/context.js"

function makePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    novelTitle: "测试小说",
    genre: "玄幻",
    synopsis: "一个测试故事".repeat(10),
    activeCharacters: [],
    departedCharacters: [],
    volumeSummary: null,
    recentChapterSummaries: [],
    plotThreads: [],
    foreshadowing: [],
    styleGuide: null,
    genreRules: [],
    worldEntries: [],
    worldEntryIndex: [],
    recalledHistory: [],
    volumeList: [],
    relationships: [],
    chapterOutline: null,
    prevChapterTail: null,
    targetWordCount: 2500,
    ...overrides,
  }
}

describe("applyBudget P5/P6", () => {
  test("P5 worldEntries 超过 2K 时截断，多余条目降级到导览", () => {
    const worldEntries = Array.from({ length: 50 }, (_, i) => ({
      id: `w${i}`,
      category: "力量体系",
      title: `设定${i}`,
      content: "这是一个非常长的世界观设定内容".repeat(10),
    }))
    const packet = makePacket({ worldEntries })
    const result = applyBudget(packet)
    const totalWorldTokens = result.worldEntries.reduce(
      (sum, w) => sum + Math.ceil((w.category + w.title + w.content).length / 1.5),
      0,
    )
    expect(totalWorldTokens).toBeLessThanOrEqual(2100)
    expect(result.worldEntryIndex.length).toBeGreaterThan(0)
    // 被截断的条目应出现在导览中
    expect(result.worldEntries.length).toBeLessThan(50)
  })

  test("P6 recalledHistory 超过 2.5K 时截断", () => {
    const recalledHistory = Array.from({ length: 20 }, (_, i) => ({
      chapterOrder: i + 1,
      chapterTitle: `第${i + 1}章`,
      summary: "这是一个很长的章节摘要内容".repeat(15),
      keyEvents: ["事件A", "事件B"],
      matchedBy: "entity" as const,
      matchedEntities: ["陆沉"],
      score: 100 - i,
    }))
    const packet = makePacket({ recalledHistory })
    const result = applyBudget(packet)
    expect(result.recalledHistory.length).toBeLessThan(20)
    const totalTokens = result.recalledHistory.reduce(
      (sum, r) => sum + Math.ceil((r.chapterTitle + r.summary + r.keyEvents.join("")).length / 1.5),
      0,
    )
    expect(totalTokens).toBeLessThanOrEqual(2600)
  })

  test("chapterOutline 超过 1.5K 时截断", () => {
    const longOutline = "本章大纲内容".repeat(500)
    const packet = makePacket({ chapterOutline: longOutline })
    const result = applyBudget(packet)
    expect(result.chapterOutline!.length).toBeLessThanOrEqual(2300)
  })

  test("总包在 1000 章规模下不超过 12K token", () => {
    const packet = makePacket({
      activeCharacters: Array.from({ length: 30 }, (_, i) => ({
        name: `角色${i}`,
        role: "配角",
        description: "一个角色".repeat(20),
        location: "某地",
        mood: "平静",
        summary: "状态摘要".repeat(10),
      })),
      recentChapterSummaries: Array.from({ length: 3 }, (_, i) => ({
        chapterOrder: 998 + i,
        chapterTitle: `第${998 + i}章`,
        summary: "章节摘要".repeat(30),
        keyEvents: ["事件1", "事件2"],
      })),
      plotThreads: Array.from({ length: 15 }, (_, i) => ({
        title: `线索${i}`,
        status: "open",
        priority: "medium",
        description: "线索描述".repeat(10),
      })),
      foreshadowing: Array.from({ length: 15 }, (_, i) => ({
        id: `f${i}`,
        content: "伏笔内容".repeat(10),
        state: "planted",
        plantedChapterId: null,
      })),
      worldEntries: Array.from({ length: 30 }, (_, i) => ({
        id: `w${i}`,
        category: "设定",
        title: `世界设定${i}`,
        content: "世界观内容".repeat(15),
      })),
      recalledHistory: Array.from({ length: 10 }, (_, i) => ({
        chapterOrder: i + 1,
        chapterTitle: `第${i + 1}章`,
        summary: "召回摘要".repeat(20),
        keyEvents: ["事件"],
        matchedBy: "entity" as const,
        matchedEntities: ["实体"],
        score: 50 - i,
      })),
      genreRules: Array.from({ length: 8 }, () => "题材规则".repeat(20)),
      chapterOutline: "章纲".repeat(100),
    })
    const result = applyBudget(packet)
    // 估算总包 token
    let total = 0
    total += Math.ceil((result.novelTitle + result.genre + result.synopsis).length / 1.5)
    total += result.activeCharacters.reduce((s, c) => s + Math.ceil((c.name + c.role + c.description + c.location + c.mood + c.summary).length / 1.5), 0)
    total += result.recentChapterSummaries.reduce((s, c) => s + Math.ceil((c.chapterTitle + c.summary + c.keyEvents.join("")).length / 1.5), 0)
    total += result.plotThreads.reduce((s, t) => s + Math.ceil((t.title + t.status + t.priority + t.description).length / 1.5), 0)
    total += result.foreshadowing.reduce((s, f) => s + Math.ceil((f.content + f.state).length / 1.5), 0)
    total += result.genreRules.reduce((s, r) => s + Math.ceil(r.length / 1.5), 0)
    total += result.worldEntries.reduce((s, w) => s + Math.ceil((w.category + w.title + w.content).length / 1.5), 0)
    total += result.worldEntryIndex.reduce((s, w) => s + Math.ceil((w.category + w.title).length / 1.5), 0)
    total += result.recalledHistory.reduce((s, r) => s + Math.ceil((r.chapterTitle + r.summary + r.keyEvents.join("")).length / 1.5), 0)
    total += result.chapterOutline ? Math.ceil(result.chapterOutline.length / 1.5) : 0
    expect(total).toBeLessThanOrEqual(12500)
  })
})