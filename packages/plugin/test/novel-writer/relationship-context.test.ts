import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  resolveKinshipDirection,
  selectProtectedRelationships,
  type ProtectedRelationship,
} from "../../src/novel-writer/relationship-context.js"
import { assembleWriterSnapshot } from "../../src/novel-writer/recall.js"
import { formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { applyBudget } from "../../src/novel-writer/budget.js"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"
import type { ContextPacket } from "../../src/novel-writer/context.js"
import {
  closeDb,
  getDb,
  NovelTable,
  CharacterTable,
  CharacterStateTable,
  ChapterTable,
  RelationshipTable,
  type RelationshipSummary,
} from "../../src/novel-writer/session-store.js"

function relationship(overrides: Partial<RelationshipSummary> = {}): RelationshipSummary {
  return {
    id: "rel-1",
    charAId: "char-a",
    charBId: "char-b",
    type: "母子",
    description: "张三由李四抚养。",
    charAName: "李四",
    charBName: "张三",
    ...overrides,
  }
}

function protectedRelationship(overrides: Partial<ProtectedRelationship> = {}): ProtectedRelationship {
  return {
    id: "protected-1",
    charAId: "char-a",
    charBId: "char-b",
    type: "母子",
    description: "张三是李四的儿子。",
    charAName: "李四",
    charBName: "张三",
    directionText: "李四是张三的母亲，张三是李四的儿子",
    directionResolved: true,
    kinshipBindings: [
      { term: "母亲", characterId: "char-a", characterName: "李四" },
      { term: "儿子", characterId: "char-b", characterName: "张三" },
    ],
    unresolvedKinshipTerms: [],
    ...overrides,
  }
}

describe("关系方向解析", () => {
  test("母子复合类型解析为 A 母亲、B 儿子", () => {
    const rel = relationship()
    const direction = resolveKinshipDirection(rel)
    expect(direction).toEqual({ charA: "mother", charB: "son" })
  })

  test("父女复合类型解析为 A 父亲、B 女儿", () => {
    const rel = relationship({ type: "父女", description: "父女相依为命。" })
    expect(resolveKinshipDirection(rel)).toEqual({ charA: "father", charB: "daughter" })
  })

  test("描述中的单侧称谓可以保守解析", () => {
    const rel = relationship({
      type: "亲属",
      description: "张三是李四的女儿。",
    })
    const direction = resolveKinshipDirection(rel)
    expect(direction).toEqual({ charB: "daughter" })
  })

  test("无方向线索时返回 null", () => {
    const rel = relationship({ type: "亲属", description: "两人关系密切。" })
    expect(resolveKinshipDirection(rel)).toBeNull()
  })
})

describe("受保护关系选择与称谓绑定", () => {
  test("覆盖双方活跃、单方活跃和关键词命中三种情况，并按优先级排序", () => {
    const both = relationship({ id: "rel-both", charAId: "a", charBId: "b" })
    const single = relationship({ id: "rel-single", charAId: "c", charBId: "b" })
    const keyword = relationship({
      id: "rel-keyword",
      charAId: "d",
      charBId: "e",
      charAName: "角色d",
      charBName: "角色e",
      type: "亲属",
    })
    const unrelated = relationship({ id: "rel-none", charAId: "f", charBId: "g", type: "盟友" })

    const selected = selectProtectedRelationships({
      relationships: [single, unrelated, both, keyword],
      activeCharacterIds: ["a", "b"],
      relatedText: "章纲提到角色e和儿子",
    })

    expect(selected.map((r) => r.id)).toEqual(["rel-both", "rel-single", "rel-keyword"])
  })

  test("唯一儿子和唯一母亲生成绑定，多个儿子时儿子标记未解析", () => {
    const selected = selectProtectedRelationships({
      relationships: [
        relationship(),
        relationship({ charAId: "char-a", charBId: "char-c", charBName: "赵六", description: "赵六也是李四的儿子。" }),
      ],
      activeCharacterIds: ["char-a", "char-b", "char-c"],
      relatedText: "",
    })

    expect(selected).toHaveLength(2)
    expect(selected[0]?.kinshipBindings).toEqual([{ term: "母亲", characterId: "char-a", characterName: "李四" }])
    expect(selected.map((r) => r.unresolvedKinshipTerms)).toEqual([["儿子"], ["儿子"]])
  })
})

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `relationship-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

async function seedMotherSon() {
  const db = getDb(dir)
  await db
    .insert(NovelTable)
    .values({
      id: "novel-1",
      title: "家庭",
      genre: "都市",
      synopsis: "李四和儿子张三重逢。",
    })
    .run()
  await db
    .insert(CharacterTable)
    .values([
      { id: "char-a", novel_id: "novel-1", name: "李四" },
      { id: "char-b", novel_id: "novel-1", name: "张三" },
    ])
    .run()
  await db
    .insert(ChapterTable)
    .values({
      id: "chapter-1",
      novel_id: "novel-1",
      title: "重逢",
      order: 1,
    })
    .run()
  await db
    .insert(CharacterStateTable)
    .values([
      { id: "state-a", character_id: "char-a", chapter_id: "chapter-1", active: 1 },
      { id: "state-b", character_id: "char-b", chapter_id: "chapter-1", active: 1 },
    ])
    .run()
  await db
    .insert(RelationshipTable)
    .values({
      id: "rel-1",
      novel_id: "novel-1",
      char_a_id: "char-a",
      char_b_id: "char-b",
      type: "母子",
      description: "李四抚养张三。",
    })
    .run()
}

describe("writer 提示词关系约束", () => {
  test("提示词声明关系硬约束与称谓绑定规则", () => {
    expect(writerAgentConfig.systemPrompt).toContain("## 角色关系硬约束")
    expect(writerAgentConfig.systemPrompt).toContain("【受保护角色关系（硬约束）】")
    expect(writerAgentConfig.systemPrompt).toContain("称谓绑定")
    expect(writerAgentConfig.systemPrompt).toContain("未解析称谓")
  })
})

describe("写作快照关系硬约束", () => {
  test("母子关系进入硬约束并输出称谓绑定", async () => {
    await seedMotherSon()
    const snapshot = await assembleWriterSnapshot("novel-1", 1, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.protectedRelationships).toHaveLength(1)

    const rel = snapshot!.protectedRelationships[0]
    expect(rel.directionResolved).toBe(true)
    expect(rel.directionText).toContain("李四是张三的母亲")
    expect(rel.directionText).toContain("张三是李四的儿子")
    expect(rel.kinshipBindings).toContainEqual({ term: "儿子", characterId: "char-b", characterName: "张三" })

    const output = formatSnapshotToolOutput(snapshot!, { hooks: [] }).output
    expect(output).toContain("═══ 受保护角色关系（硬约束）═══")
    expect(output).toContain("张三是李四的儿子")
    expect(output).toContain("儿子 → 张三")
  })

  test("受保护关系保留专用预算且世界观不能挤掉它", () => {
    const packet: ContextPacket = {
      novelTitle: "预算",
      genre: "都市",
      synopsis: "",
      activeCharacters: [],
      departedCharacters: [],
      volumeSummary: null,
      recentChapterSummaries: [],
      segmentSummaries: [],
      plotThreads: [],
      foreshadowing: [],
      activeArcs: [],
      styleGuide: null,
      genreRules: [],
      worldEntries: [{ id: "world-1", category: "设定", title: "大量世界观", content: "字".repeat(3000) }],
      volumeList: [],
      relationships: [],
      protectedRelationships: [protectedRelationship()],
      relationshipContextTruncated: false,
      worldEntryIndex: [],
      recalledHistory: [],
      chapterOutline: null,
      prevChapterTail: null,
      targetWordCount: null,
      techniques: [],
    }

    const result = applyBudget(packet)
    expect(result.protectedRelationships).toHaveLength(1)
    expect(result.relationshipContextTruncated).toBe(false)
  })

  test("受保护关系超出专用预算时输出截断状态", () => {
    const long = protectedRelationship({
      id: "protected-long",
      description: "描".repeat(150),
      directionText: "描".repeat(150),
      kinshipBindings: [],
    })
    const another = protectedRelationship({
      id: "protected-long-2",
      description: "描".repeat(150),
      directionText: "描".repeat(150),
      kinshipBindings: [],
    })
    const packet: ContextPacket = {
      novelTitle: "预算",
      genre: "都市",
      synopsis: "",
      activeCharacters: [],
      departedCharacters: [],
      volumeSummary: null,
      recentChapterSummaries: [],
      segmentSummaries: [],
      plotThreads: [],
      foreshadowing: [],
      activeArcs: [],
      styleGuide: null,
      genreRules: [],
      worldEntries: [],
      volumeList: [],
      relationships: [],
      protectedRelationships: [long, another],
      relationshipContextTruncated: false,
      worldEntryIndex: [],
      recalledHistory: [],
      chapterOutline: null,
      prevChapterTail: null,
      targetWordCount: null,
      techniques: [],
    }

    const result = applyBudget(packet)
    expect(result.protectedRelationships).toHaveLength(1)
    expect(result.relationshipContextTruncated).toBe(true)

    const output = formatSnapshotToolOutput(result, { hooks: [] }).output
    expect(output).toContain("relationship_context_truncated")
  })
})
