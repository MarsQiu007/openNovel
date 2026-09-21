import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  buildCharacterBindingView,
  detectKinshipEntityDrift,
  findRelationshipConflicts,
  loadCharacterBindingView,
  resolveCharacterReference,
} from "../../src/novel-writer/drift-guards.js"
import { selectProtectedRelationships } from "../../src/novel-writer/relationship-context.js"
import { commitStateWithReport } from "../../src/novel-writer/state-commit.js"
import { checkContinuity } from "../../src/novel-writer/continuity-check.js"
import { formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import { writerAgentConfig } from "../../src/novel-writer/agents/writer.js"
import { auditorAgent } from "../../src/novel-writer/agents/auditor.js"
import { observerAgent } from "../../src/novel-writer/agents/observer.js"
import { pipelineAgentConfig } from "../../src/novel-writer/agents/pipeline.js"
import {
  CharacterStateTable,
  CharacterTable,
  ChapterTable,
  closeDb,
  getDb,
  NovelTable,
  PendingSettingTable,
  RelationshipTable,
  type RelationshipSummary,
} from "../../src/novel-writer/session-store.js"

function relationship(overrides: Partial<RelationshipSummary> = {}): RelationshipSummary {
  return {
    id: "rel-1",
    charAId: "char-a",
    charBId: "char-b",
    type: "母子",
    description: "李四抚养张三。",
    charAName: "李四",
    charBName: "张三",
    ...overrides,
  }
}

let dir: string
let testRoot: string
let originalCwd: string

beforeAll(() => {
  testRoot = join(tmpdir(), `drift-guards-root-${Date.now()}`)
  mkdirSync(testRoot, { recursive: true })
  originalCwd = process.cwd()
  process.chdir(testRoot)
})

afterAll(() => {
  process.chdir(originalCwd)
  closeDb(dir)
  try {
    rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件句柄释放有延迟，尽力清理即可
  }
})

beforeEach(() => {
  dir = join(testRoot, `db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

function seedFamily(options: { ambiguous?: boolean } = {}) {
  const db = getDb(dir)
  db
    .insert(NovelTable)
    .values({ id: "novel-1", title: "家庭", genre: "都市", synopsis: "母亲和儿子的日常。" })
    .run()
  db
    .insert(CharacterTable)
    .values([
      { id: "char-a", novel_id: "novel-1", name: "李四" },
      { id: "char-b", novel_id: "novel-1", name: "张三" },
      ...(options.ambiguous ? [{ id: "char-c", novel_id: "novel-1", name: "赵六" }] : []),
    ])
    .run()
  db
    .insert(ChapterTable)
    .values({ id: "chapter-1", novel_id: "novel-1", title: "重逢", order: 1 })
    .run()
  db
    .insert(CharacterStateTable)
    .values([
      { id: "state-a", character_id: "char-a", chapter_id: "chapter-1", active: 1 },
      { id: "state-b", character_id: "char-b", chapter_id: "chapter-1", active: 1 },
      ...(options.ambiguous ? [{ id: "state-c", character_id: "char-c", chapter_id: "chapter-1", active: 1 }] : []),
    ])
    .run()
  db
    .insert(RelationshipTable)
    .values([
      {
        id: "rel-1",
        novel_id: "novel-1",
        char_a_id: "char-a",
        char_b_id: "char-b",
        type: "母子",
        description: "李四抚养张三。",
      },
      ...(options.ambiguous
        ? [
            {
              id: "rel-2",
              novel_id: "novel-1",
              char_a_id: "char-a",
              char_b_id: "char-c",
              type: "母子",
              description: "李四抚养赵六。",
            },
          ]
        : []),
    ])
    .run()
  return db
}

describe("角色绑定视图", () => {
  test("正式角色、活跃状态和章纲相关角色进入统一视图", () => {
    const relationships = [relationship()]
    const protectedRelationships = selectProtectedRelationships({
      relationships,
      activeCharacterIds: ["char-b"],
      relatedText: "章纲提到李四",
    })
    const view = buildCharacterBindingView({
      characters: [
        { id: "char-a", name: "李四" },
        { id: "char-b", name: "张三" },
      ],
      activeCharacterIds: ["char-b"],
      relatedText: "章纲提到李四",
      relationships,
      protectedRelationships,
    })

    expect(view.characters).toEqual([
      { id: "char-a", name: "李四", active: false, outlineRelevant: true },
      { id: "char-b", name: "张三", active: true, outlineRelevant: false },
    ])
    expect(view.kinshipBindings).toContainEqual({ term: "儿子", characterId: "char-b", characterName: "张三" })
    expect(view.ambiguousKinshipTerms).toEqual([])
  })

  test("多个儿子时儿子称谓进入歧义列表", () => {
    const relationships = [
      relationship(),
      relationship({ id: "rel-2", charBId: "char-c", charBName: "赵六", description: "李四抚养赵六。" }),
    ]
    const protectedRelationships = selectProtectedRelationships({
      relationships,
      activeCharacterIds: ["char-a", "char-b", "char-c"],
      relatedText: "",
    })
    const view = buildCharacterBindingView({
      characters: [
        { id: "char-a", name: "李四" },
        { id: "char-b", name: "张三" },
        { id: "char-c", name: "赵六" },
      ],
      activeCharacterIds: ["char-a", "char-b", "char-c"],
      relatedText: "",
      relationships,
      protectedRelationships,
    })

    expect(view.kinshipBindings).toContainEqual({ term: "母亲", characterId: "char-a", characterName: "李四" })
    expect(view.ambiguousKinshipTerms).toContain("儿子")
  })

  test("从数据库加载母子场景绑定视图", async () => {
    const db = seedFamily()
    const view = await loadCharacterBindingView(db, "novel-1", "章纲：张三回家", ["char-b"])
    expect(view.characters).toHaveLength(2)
    expect(view.characters.find((character) => character.id === "char-b")?.outlineRelevant).toBe(true)
    expect(view.protectedRelationships).toHaveLength(1)
    expect(view.kinshipBindings).toContainEqual({ term: "儿子", characterId: "char-b", characterName: "张三" })
  })
})

describe("角色引用解析", () => {
  test("按 UUID、唯一姓名和唯一称谓解析", () => {
    const relationships = [relationship()]
    const protectedRelationships = selectProtectedRelationships({
      relationships,
      activeCharacterIds: ["char-a", "char-b"],
      relatedText: "",
    })
    const view = buildCharacterBindingView({
      characters: [
        { id: "char-a", name: "李四" },
        { id: "char-b", name: "张三" },
      ],
      activeCharacterIds: ["char-a", "char-b"],
      relatedText: "",
      relationships,
      protectedRelationships,
    })

    expect(resolveCharacterReference(view, { entityId: "char-b" })).toEqual({
      status: "resolved",
      characterId: "char-b",
      characterName: "张三",
    })
    expect(resolveCharacterReference(view, { entityId: "char-new", name: "李四" })).toEqual({
      status: "resolved",
      characterId: "char-a",
      characterName: "李四",
    })
    expect(resolveCharacterReference(view, { entityId: "char-new", name: "儿子" })).toEqual({
      status: "resolved",
      characterId: "char-b",
      characterName: "张三",
    })
  })

  test("多候选称谓和零候选均不解析", () => {
    const relationships = [
      relationship(),
      relationship({ id: "rel-2", charBId: "char-c", charBName: "赵六", description: "李四抚养赵六。" }),
    ]
    const protectedRelationships = selectProtectedRelationships({
      relationships,
      activeCharacterIds: ["char-a", "char-b", "char-c"],
      relatedText: "",
    })
    const view = buildCharacterBindingView({
      characters: [
        { id: "char-a", name: "李四" },
        { id: "char-b", name: "张三" },
        { id: "char-c", name: "赵六" },
      ],
      activeCharacterIds: ["char-a", "char-b", "char-c"],
      relatedText: "",
      relationships,
      protectedRelationships,
    })

    const ambiguous = resolveCharacterReference(view, { entityId: "char-new", name: "儿子" })
    expect(ambiguous.status).toBe("unresolved")
    const missing = resolveCharacterReference(view, { entityId: "char-new", name: "女儿" })
    expect(missing.status).toBe("unresolved")
  })
})

describe("写作称谓守卫", () => {
  test("唯一绑定但正文未用既有角色名时生成审计提示", async () => {
    const db = seedFamily()
    const view = await loadCharacterBindingView(db, "novel-1", "章纲：张三回家", ["char-b"])
    const findings = detectKinshipEntityDrift("王五成了李四的儿子。", view)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.term).toBe("儿子")
    expect(findings[0]?.boundCharacterName).toBe("张三")
    expect(findings[0]?.evidence).toContain("王五成了李四的儿子")
    expect(findings[0]?.message).toContain("张三")
  })

  test("未解析称谓实体化和普通对话称谓分别命中与豁免", async () => {
    const db = seedFamily({ ambiguous: true })
    const view = await loadCharacterBindingView(db, "novel-1", "", ["char-a", "char-b", "char-c"])
    const findings = detectKinshipEntityDrift("王五成了李四的儿子。", view)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain("无法唯一绑定")
    expect(detectKinshipEntityDrift("李四叫儿子回家吃饭。", view)).toHaveLength(0)
  })
})

describe("强关系冲突检查", () => {
  test("同一母亲的新儿子候选不会覆盖既有母子关系", () => {
    const conflicts = findRelationshipConflicts([relationship()], {
      id: "rel-new",
      charAId: "char-a",
      charBId: "char-c",
      type: "母子",
      description: "李四也是王五的母亲。",
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.existingRelationshipId).toBe("rel-1")
    expect(conflicts[0]?.reason).toContain("唯一子女")
  })

  test("同一儿子的新母亲候选不会覆盖既有母子关系", () => {
    const conflicts = findRelationshipConflicts([relationship()], {
      id: "rel-new",
      charAId: "char-d",
      charBId: "char-b",
      type: "母子",
      description: "王五是张三的母亲。",
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.existingRelationshipId).toBe("rel-1")
    expect(conflicts[0]?.reason).toContain("唯一家长")
  })
})

describe("状态提交防漂移", () => {
  test("唯一称谓解析到既有角色，不创建重复角色", async () => {
    const db = seedFamily()
    const report = await commitStateWithReport("novel-1", "chapter-1", [
      {
        fact_type: "character",
        action: "create",
        entity_id: "char-son-local",
        data: { name: "儿子", description: "张三回家。", importance: 2 },
      },
    ], db)
    const characters = db.select().from(CharacterTable).all()
    expect(characters).toHaveLength(2)
    expect(characters.map((character) => character.id)).toContain("char-b")
    expect(report.pending).toHaveLength(0)
  })

  test("无法唯一解析的称谓角色进入候选区", async () => {
    const db = seedFamily({ ambiguous: true })
    const report = await commitStateWithReport("novel-1", "chapter-1", [
      {
        fact_type: "character",
        action: "create",
        entity_id: "char-son-local",
        data: { name: "儿子", description: "疑似新儿子。", importance: 2 },
      },
    ], db)
    const characters = db.select().from(CharacterTable).all()
    const pending = db.select().from(PendingSettingTable).all()
    expect(characters).toHaveLength(3)
    expect(report.pending).toHaveLength(1)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.candidate_type).toBe("character")
    expect(JSON.parse(pending[0]?.payload_json ?? "{}")).toMatchObject({
      name: "儿子",
      unresolved_reason: expect.stringContaining("多个既有角色候选"),
    })
  })

  test("冲突强关系进入候选区且不写入正式关系表", async () => {
    const db = seedFamily()
    const report = await commitStateWithReport("novel-1", "chapter-1", [
      {
        fact_type: "relationship",
        action: "create",
        entity_id: "rel-new",
        data: {
          char_a_id: "char-a",
          char_b_id: "char-c",
          type: "母子",
          description: "李四也是赵六的母亲。",
          type_strength: "strong",
        },
      },
    ], db)
    const relationships = db.select().from(RelationshipTable).all()
    const pending = db.select().from(PendingSettingTable).all()
    expect(relationships).toHaveLength(1)
    expect(relationships[0]?.id).toBe("rel-1")
    expect(report.pending).toHaveLength(1)
    expect(pending[0]?.candidate_type).toBe("relationship")
    expect(pending[0]?.type_strength).toBe("strong")
    expect(JSON.parse(pending[0]?.payload_json ?? "{}")).toMatchObject({
      unresolved_reason: expect.stringContaining("唯一子女"),
    })
  })
})

describe("审计与提示词守卫", () => {
  test("关系连续性维度对照正文和权威关系输出 FAIL", async () => {
    seedFamily()
    const db = getDb(dir)
    db
      .update(ChapterTable)
      .set({ content: "王五成了李四的儿子。" })
      .where(eq(ChapterTable.id, "chapter-1"))
      .run()
    const result = await checkContinuity("novel-1", 1, dir)
    const relationshipResult = result?.dimensions.find(
      (dimension) => dimension.dimension === "关系类型一致" && dimension.status === "FAIL",
    )
    expect(relationshipResult?.detail).toContain("王五成了李四的儿子")
    expect(relationshipResult?.detail).toContain("权威关系证据")
  })

  test("快照输出命名角色白名单和称谓绑定", async () => {
    const db = seedFamily()
    const view = await loadCharacterBindingView(db, "novel-1", "章纲：张三回家", ["char-b"])
    const output = formatSnapshotToolOutput({
      novelTitle: "家庭",
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
      relationships: view.relationships,
      protectedRelationships: view.protectedRelationships,
      relationshipContextTruncated: false,
      characterBindingView: view,
      worldEntryIndex: [],
      recalledHistory: [],
      chapterOutline: null,
      prevChapterTail: null,
      targetWordCount: null,
      techniques: [],
    }, { hooks: [] }).output
    expect(output).toContain("═══ 命名角色白名单（硬约束）═══")
    expect(output).toContain("- 张三（活跃；章纲相关）")
    expect(output).toContain("儿子 → 张三")
  })

  test("writer、auditor、observer 和 pipeline 提示词包含防漂移规则", () => {
    expect(writerAgentConfig.systemPrompt).toContain("命名角色白名单")
    expect(writerAgentConfig.systemPrompt).toContain("称谓绑定")
    expect(writerAgentConfig.systemPrompt).toContain("未解析称谓")
    expect(writerAgentConfig.systemPrompt).toContain("章纲明确要求新增角色时例外")

    expect(auditorAgent.prompt).toContain("读取关系")
    expect(auditorAgent.prompt).toContain("关系权威数据必读")
    expect(auditorAgent.prompt).toContain("FAIL/WARN 必须同时引用正文原句")
    expect(auditorAgent.prompt).toContain("维度 6-9")

    expect(observerAgent.prompt).toContain("亲属称谓绑定规则")
    expect(observerAgent.prompt).toContain("无法唯一解析或与既有强关系冲突时输出候选")

    expect(pipelineAgentConfig.systemPrompt).toContain("命名角色白名单（硬约束）")
    expect(pipelineAgentConfig.systemPrompt).toContain("称谓绑定")
    expect(pipelineAgentConfig.systemPrompt).toContain("未解析称谓")
    expect(pipelineAgentConfig.systemPrompt).toContain("+ 1-5 + 6-9")
  })
})
