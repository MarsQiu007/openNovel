import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, getDb, NovelTable } from "@opennovel-ai/novel-store"
import { formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { applyBudget } from "../../src/novel-writer/budget.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `novel-spine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function makeSnapshot(spine: string | null) {
  return {
    novelTitle: "测试",
    genre: "科幻",
    synopsis: "梗概",
    storySpine: spine,
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
    activeArcs: [],
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

describe("story-spine", () => {
  test("快照包含故事主轴段落（storySpine 非空）", () => {
    const output = formatSnapshotToolOutput(makeSnapshot("第1章：主角登场。第2章：发现线索。"), { hooks: [] }).output
    expect(output).toContain("故事主轴")
    expect(output).toContain("第1章")
    expect(output).toContain("第2章")
  })

  test("storySpine 为空时不渲染主轴段落", () => {
    const output = formatSnapshotToolOutput(makeSnapshot(null), { hooks: [] }).output
    expect(output).not.toContain("故事主轴")
  })

  test("超长主轴被预算截断保留最近条目", () => {
    const longSpine = Array.from({ length: 50 }, (_, i) => `第${i + 1}章：这是一个非常长的章节摘要用来测试截断逻辑是否正确工作。`).join("\n")
    const packet = applyBudget(makeSnapshot(longSpine))
    expect(packet.storySpine!.length).toBeLessThanOrEqual(760)
    // 保留最近的条目（后面的章节号）
    expect(packet.storySpine).toContain("第50章")
    expect(packet.storySpine).not.toContain("第1章：")
  })
})
