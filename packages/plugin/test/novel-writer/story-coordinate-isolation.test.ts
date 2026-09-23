import { describe, test, expect } from "bun:test"
import { formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"
import { reviserAgent } from "../../src/novel-writer/agents/reviser.js"
import { auditorAgent } from "../../src/novel-writer/agents/auditor.js"

describe("书籍坐标隔离", () => {
  test("writer 提示词包含书籍坐标隔离规则", () => {
    const prompt = writerAgentConfig.systemPrompt
    expect(prompt).toContain("书籍坐标隔离")
    expect(prompt).toContain("第N章")
    expect(prompt).toContain("元小说")
  })

  test("reviser 提示词包含书籍坐标隔离规则", () => {
    const prompt = reviserAgent.prompt
    expect(prompt).toContain("书籍坐标隔离")
    expect(prompt).toContain("第N章")
    expect(prompt).toContain("元小说")
  })

  test("auditor 提示词包含书籍坐标泄漏检查维度", () => {
    const prompt = auditorAgent.prompt
    expect(prompt).toContain("书籍坐标泄漏")
    expect(prompt).toContain("记得在第九章")
    expect(prompt).toContain("书中书")
  })

  test("快照渲染使用独立标注而非第N章前缀", () => {
    const snapshot = {
      novelTitle: "测试",
      genre: "科幻",
      synopsis: "",
      activeCharacters: [],
      recentChapterSummaries: [{ chapterOrder: 9, chapterTitle: "决裂", summary: "张三与李四决裂", keyEvents: [] }],
      segmentSummaries: [{ startChapter: 1, endChapter: 20, summary: "早期剧情" }],
      recalledHistory: [{ chapterOrder: 5, chapterTitle: "重逢", summary: "两人重逢", matchedBy: "fts" as const, keyEvents: ["记得在第5章的时候发生了冲突"] }],
      plotThreads: [],
      foreshadowing: [],
      activeArcs: [],
      worldEntries: [],
      worldEntryIndex: [],
      volumeList: [{ order: 3, title: "争端", summary: "三方争端爆发" }],
      relationships: [],
      techniques: [],
    } as never
    const output = formatSnapshotToolOutput(snapshot, { hooks: [] }).output
    expect(output).toContain("[内部参照: 章9]")
    expect(output).toContain("[内部参照: 章1-20]")
    expect(output).toContain("[内部参照: 章5·检索]")
    expect(output).toContain("[内部参照: 卷3]")
    expect(output).not.toMatch(/第\d+章\s/)
    expect(output).toContain("仅供编排参照")
    // keyEvents 中的坐标已被过滤
    expect(output).not.toContain("记得在第5章")
  })

  test("卷纲渲染不将卷号与摘要拼接为叙事句", () => {
    const snapshot = {
      novelTitle: "测试",
      genre: "科幻",
      synopsis: "",
      activeCharacters: [],
      recentChapterSummaries: [],
      segmentSummaries: [],
      recalledHistory: [],
      plotThreads: [],
      foreshadowing: [],
      activeArcs: [],
      worldEntries: [],
      worldEntryIndex: [],
      volumeList: [{ order: 2, title: "暗流", summary: "暗流涌动" }],
      relationships: [],
      techniques: [],
    } as never
    const output = formatSnapshotToolOutput(snapshot, { hooks: [] }).output
    expect(output).toContain("[内部参照: 卷2] 暗流")
    expect(output).not.toMatch(/第\d+卷\s+\S/)
  })
})
