import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()
import { describe, test, expect, afterAll } from "bun:test"
import { eq } from "drizzle-orm"
import { getDb } from "../../src/novel-writer/session-store.js"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"
import {
  upsertTechnique,
  queryTechniques,
  updateTechniqueStatus,
  recordFeedback,
  recordShadowLog,
  updateConfidenceFromFeedback,
  incrementTechniqueUsage,
  findTechniquesByName,
  mergeTechniqueEvidence,
} from "../../src/novel-writer/technique-store.js"
import { getGlobalDb, TechniqueTable, TechniqueFeedbackTable } from "../../src/novel-writer/session-store.js"

const testDir = mkdtempSync(join(tmpdir(), "technique-test-"))

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
  }
})

function makeTechnique(overrides?: Partial<TechniqueEntry>): TechniqueEntry {
  return {
    id: `tech_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: "用环境细节折射人物情绪",
    principle: "不直接陈述人物感受，通过角色对环境的感知来外化情绪",
    instruction: "写情绪转折时，用光线、声音、温度的变化暗示角色内心",
    sceneTypes: ["emotion_shift"],
    level: "paragraph",
    evidence: [{ sourceTitle: "测试", sourceLocation: "第1章", excerpt: "光变窄了", annotation: "压迫感" }],
    commonMisuse: "环境描写与情绪脱节",
    confidence: 0.5,
    status: "unverified",
    scope: "general" as const,
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe("technique types", () => {
  test("TechniqueEntry has required fields", () => {
    const entry: TechniqueEntry = {
      id: "tech_001",
      name: "用环境细节折射人物情绪",
      principle: "不直接陈述人物感受，通过角色对环境的感知和反应来外化情绪",
      instruction: "写情绪转折时，用光线、声音、温度的变化暗示角色内心，避免直接写'他感到不安'",
      sceneTypes: ["emotion_shift", "scene_opening"],
      level: "paragraph",
      evidence: [
        {
          sourceTitle: "示例小说",
          sourceLocation: "第3章",
          excerpt: "窗帘缝隙里的光变窄了。",
          annotation: "用光线收窄暗示主角的压迫感加剧",
        },
      ],
      commonMisuse: "环境描写与情绪脱节，变成纯装饰",
      confidence: 0.5,
      status: "unverified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    expect(entry.level).toBe("paragraph")
    expect(entry.status).toBe("unverified")
    expect(entry.evidence.length).toBe(1)
  })
})

describe("technique store", () => {
  test("upsert and query by scene type", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    expect(results.length).toBe(1)
    expect(results[0].entry.name).toBe("用环境细节折射人物情绪")
  })

  test("minConfidence filters low confidence", async () => {
    // 自由文本标签已被新规格视为"跨场景通用"，minConfidence 用例改用规范标签隔离变量
    const entry = makeTechnique({ confidence: 0.3, sceneTypes: ["suspense"] })
    await upsertTechnique(entry, testDir)
    const results = await queryTechniques(
      { sceneType: "suspense", contextText: "", minConfidence: 0.5 },
      testDir,
    )
    expect(results.length).toBe(0)
  })

  test("wrong scene type excluded", async () => {
    const entry = makeTechnique({ sceneTypes: ["dialogue"] })
    await upsertTechnique(entry, testDir)
    const results = await queryTechniques({ sceneType: "action", contextText: "" }, testDir)
    expect(results.length).toBe(0)
  })

  test("updateTechniqueStatus changes status", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    await updateTechniqueStatus(entry.id, "verified", testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    const found = results.find((r) => r.entry.id === entry.id)
    expect(found?.entry.status).toBe("verified")
  })

  test("recordFeedback and recordShadowLog persist", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    await recordFeedback(
      { techniqueId: entry.id, chapterId: "ch1", score: 0.8, wasUsed: true, comment: "", createdAt: Date.now() },
      testDir,
    )
    await recordShadowLog(
      {
        id: `shadow_${Date.now()}`,
        novelId: "novel_001",
        chapterNumber: 1,
        sceneType: "emotion_shift",
        queryText: "情绪转折",
        retrievedTechniqueIds: [entry.id],
        retrievedTechniqueNames: [entry.name],
        createdAt: Date.now(),
      },
      testDir,
    )
  })

  test("positive feedback increases confidence", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    const base = Date.now()
    for (let i = 0; i < 5; i++) {
      await recordFeedback(
        { techniqueId: entry.id, chapterId: `ch${i}`, score: 0.9, wasUsed: true, comment: "", createdAt: base + i },
        testDir,
      )
    }
    await updateConfidenceFromFeedback(entry.id, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    const found = results.find((r) => r.entry.id === entry.id)
    expect(found?.entry.confidence).toBeGreaterThan(0.5)
    expect(found?.entry.status).toBe("verified")
  })

  test("no feedback leaves confidence unchanged", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    await updateConfidenceFromFeedback(entry.id, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    const found = results.find((r) => r.entry.id === entry.id)
    expect(found?.entry.confidence).toBe(0.5)
  })
})

describe("incrementTechniqueUsage", () => {
  test("递增 usage_count 并更新 last_used_at", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    await incrementTechniqueUsage(entry.id, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    const found = results.find((r) => r.entry.id === entry.id)
    expect(found?.entry.usageCount).toBe(1)
    expect(found?.entry.lastUsedAt).not.toBeNull()
  })

  test("技法不存在时不抛异常", async () => {
    await expect(incrementTechniqueUsage("tech_nonexistent", testDir)).resolves.toBeUndefined()
  })
})

function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "technique-iso-"))
  return run(dir).finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
    }
  })
}

describe("findTechniquesByName", () => {
  test("规范化名称命中：空白与大小写差异不影响匹配", async () => {
    await withTempDir(async (dir) => {
      const entry = makeTechnique({ name: "Env Detail 外化" })
      await upsertTechnique(entry, dir)
      const hits = await findTechniquesByName("  env   detail   外化  ", dir)
      expect(hits.length).toBe(1)
      expect(hits[0].id).toBe(entry.id)
    })
  })

  test("名称不同不命中", async () => {
    await withTempDir(async (dir) => {
      await upsertTechnique(makeTechnique({ name: "环境外化情绪" }), dir)
      const hits = await findTechniquesByName("Env Detail 外化", dir)
      expect(hits.length).toBe(0)
    })
  })
})

describe("mergeTechniqueEvidence", () => {
  test("追加证据且按 excerpt 去重，不动状态与置信度", async () => {
    await withTempDir(async (dir) => {
      const entry = makeTechnique({
        status: "verified",
        confidence: 0.8,
        evidence: [{ sourceTitle: "书A", sourceLocation: "第1章", excerpt: "片段一", annotation: "标注" }],
      })
      await upsertTechnique(entry, dir)
      const ok = await mergeTechniqueEvidence(
        entry.id,
        [
          { sourceTitle: "书A", sourceLocation: "第1章", excerpt: "片段一", annotation: "重复证据" },
          { sourceTitle: "书B", sourceLocation: "第2章", excerpt: "片段二", annotation: "新证据" },
        ],
        dir,
      )
      expect(ok).toBe(true)
      const [after] = await findTechniquesByName(entry.name, dir)
      expect(after.evidence.length).toBe(2)
      expect(after.evidence.some((e) => e.excerpt === "片段二")).toBe(true)
      expect(after.status).toBe("verified")
      expect(after.confidence).toBe(0.8)
      expect(after.usageCount).toBe(0)
    })
  })

  test("目标不存在返回 false", async () => {
    const ok = await mergeTechniqueEvidence("tech_missing", [], testDir)
    expect(ok).toBe(false)
  })
})

describe("queryTechniques 未验证新品曝光位", () => {
  test("高置信占满时新品仍入候选且总数不超 limit", async () => {
    await withTempDir(async (dir) => {
      const now = Date.now()
      const fresh = makeTechnique({ name: "曝光位新品", sceneTypes: ["dialogue"], confidence: 0.5, createdAt: now })
      await upsertTechnique(fresh, dir)
      for (let i = 0; i < 5; i++) {
        await upsertTechnique(
          makeTechnique({
            name: `高置信技法${i}`,
            sceneTypes: ["dialogue"],
            confidence: 0.9,
            status: "verified",
            createdAt: now - 1000 * (i + 1),
          }),
          dir,
        )
      }
      const result = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5 }, dir)
      expect(result.length).toBeLessThanOrEqual(5)
      expect(result.some((r) => r.entry.id === fresh.id)).toBe(true)
    })
  })

  test("无 unverified 技法时结果与旧逻辑一致（纯置信度排序）", async () => {
    await withTempDir(async (dir) => {
      for (let i = 0; i < 3; i++) {
        await upsertTechnique(
          makeTechnique({ name: `纯置信${i}`, sceneTypes: ["action"], confidence: 0.7 - i * 0.1, status: "verified" }),
          dir,
        )
      }
      const result = await queryTechniques({ sceneType: "action", contextText: "", limit: 5 }, dir)
      expect(result.length).toBe(3)
      expect(result[0].entry.confidence).toBeGreaterThanOrEqual(result[1].entry.confidence)
      expect(result[1].entry.confidence).toBeGreaterThanOrEqual(result[2].entry.confidence)
    })
  })

  test("曝光位新品同样受场景过滤", async () => {
    await withTempDir(async (dir) => {
      const fresh = makeTechnique({ name: "场景不符新品", sceneTypes: ["suspense"], confidence: 0.5 })
      await upsertTechnique(fresh, dir)
      await upsertTechnique(
        makeTechnique({ name: "高置信动作", sceneTypes: ["action"], confidence: 0.9, status: "verified" }),
        dir,
      )
      const result = await queryTechniques({ sceneType: "action", contextText: "", limit: 5 }, dir)
      expect(result.some((r) => r.entry.id === fresh.id)).toBe(false)
    })
  })

  test("minConfidence 门槛对曝光位同样生效", async () => {
    await withTempDir(async (dir) => {
      const low = makeTechnique({ name: "低置信新品", sceneTypes: ["dialogue"], confidence: 0.5 })
      await upsertTechnique(low, dir)
      await upsertTechnique(
        makeTechnique({ name: "高置信对话", sceneTypes: ["dialogue"], confidence: 0.9, status: "verified" }),
        dir,
      )
      const result = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5, minConfidence: 0.6 }, dir)
      expect(result.some((r) => r.entry.id === low.id)).toBe(false)
    })
  })
})
describe("queryTechniques 场景词表空交集回退", () => {
  test("自由文本标签技法按 general 身份进入候选（存量数据可召回）", async () => {
    await withTempDir(async (dir) => {
      const legacy = makeTechnique({ name: "存量自由文本", sceneTypes: ["性感场景", "约会场景"], confidence: 0.6 })
      await upsertTechnique(legacy, dir)
      const result = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5 }, dir)
      expect(result.some((r) => r.entry.id === legacy.id)).toBe(true)
    })
  })

  test("非空交集不适用回退：规范标签不匹配仍被排除", async () => {
    await withTempDir(async (dir) => {
      const actionOnly = makeTechnique({ name: "纯动作技法", sceneTypes: ["action"], confidence: 0.9, status: "verified" })
      await upsertTechnique(actionOnly, dir)
      const result = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5 }, dir)
      expect(result.some((r) => r.entry.id === actionOnly.id)).toBe(false)
    })
  })

  test("混合标签按交集匹配：保留的规范值决定命中与否", async () => {
    await withTempDir(async (dir) => {
      const mixed = makeTechnique({ name: "混合标签", sceneTypes: ["dialogue", "约会场景"], confidence: 0.9, status: "verified" })
      await upsertTechnique(mixed, dir)
      const hit = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5 }, dir)
      expect(hit.some((r) => r.entry.id === mixed.id)).toBe(true)
      const miss = await queryTechniques({ sceneType: "action", contextText: "", limit: 5 }, dir)
      expect(miss.some((r) => r.entry.id === mixed.id)).toBe(false)
    })
  })

  test("空数组标签回退 general 参与匹配", async () => {
    await withTempDir(async (dir) => {
      const empty = makeTechnique({ name: "空标签技法", sceneTypes: [], confidence: 0.6 })
      await upsertTechnique(empty, dir)
      const result = await queryTechniques({ sceneType: "suspense", contextText: "", limit: 5 }, dir)
      expect(result.some((r) => r.entry.id === empty.id)).toBe(true)
    })
  })

  test("曝光位新品经回退进入候选（回退覆盖两条检索路径）", async () => {
    await withTempDir(async (dir) => {
      const now = Date.now()
      const fresh = makeTechnique({ name: "自由文本新品", sceneTypes: ["约会场景"], confidence: 0.5, createdAt: now })
      await upsertTechnique(fresh, dir)
      for (let i = 0; i < 4; i++) {
        await upsertTechnique(
          makeTechnique({
            name: `高置信对话${i}`,
            sceneTypes: ["dialogue"],
            confidence: 0.9,
            status: "verified",
            createdAt: now - 1000 * (i + 1),
          }),
          dir,
        )
      }
      const result = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5 }, dir)
      expect(result.some((r) => r.entry.id === fresh.id)).toBe(true)
      expect(result.length).toBeLessThanOrEqual(5)
    })
  })
})

describe("queryTechniques 双源合并", () => {
  test("全局库非空时本书场景召回全局条目并标注来源", async () => {
    await withTempDir(async (dir) => {
      installFreshGlobalDb()
      await upsertTechnique(
        makeTechnique({ name: "全局对话技法", sceneTypes: ["dialogue"], status: "verified", confidence: 0.9 }),
        dir,
        "global",
      )
      const result = await queryTechniques({ sceneType: "dialogue", contextText: "", limit: 5 }, dir)
      const hit = result.find((r) => r.entry.name === "全局对话技法")
      expect(hit).toBeTruthy()
      expect(hit!.library).toBe("global")
    })
  })

  test("反馈按 library 写入对应库", async () => {
    await withTempDir(async (dir) => {
      installFreshGlobalDb()
      const globalEntry = makeTechnique({ name: "全局反馈技法", sceneTypes: ["dialogue"] })
      await upsertTechnique(globalEntry, dir, "global")
      await recordFeedback(
        {
          techniqueId: globalEntry.id,
          chapterId: "ch1",
          score: 0.9,
          wasUsed: true,
          comment: "运用自然",
          createdAt: Date.now(),
        },
        dir,
        "global",
      )
      const globalDb = getGlobalDb()
      const rows = await globalDb
        .select()
        .from(TechniqueFeedbackTable)
        .where(eq(TechniqueFeedbackTable.technique_id, globalEntry.id))
        .all()
      expect(rows.length).toBe(1)
      // 本书库不出现该反馈
      const bookDb = getDb(testDir)
      const bookRows = await bookDb
        .select()
        .from(TechniqueFeedbackTable)
        .where(eq(TechniqueFeedbackTable.technique_id, globalEntry.id))
        .all()
      expect(bookRows.length).toBe(0)
    })
  })

  test("置信度状态机按库演进（全局库）", async () => {
    await withTempDir(async (dir) => {
      installFreshGlobalDb()
      const entry = makeTechnique({ name: "全局状态机技法", sceneTypes: ["dialogue"], confidence: 0.7 })
      await upsertTechnique(entry, dir, "global")
      for (let i = 0; i < 5; i++) {
        await recordFeedback(
          {
            techniqueId: entry.id,
            chapterId: `ch${i}`,
            score: 0.9,
            wasUsed: true,
            comment: "",
            createdAt: Date.now(),
          },
          dir,
          "global",
        )
      }
      await updateConfidenceFromFeedback(entry.id, dir, "global")
      const globalDb = getGlobalDb()
      const [row] = await globalDb.select().from(TechniqueTable).where(eq(TechniqueTable.id, entry.id)).all()
      expect(row.confidence).toBeGreaterThan(0.75)
      expect(row.status).toBe("verified")
    })
  })

  test("incrementTechniqueUsage 按库递增", async () => {
    await withTempDir(async (dir) => {
      installFreshGlobalDb()
      const entry = makeTechnique({ name: "全局计数技法", sceneTypes: ["dialogue"] })
      await upsertTechnique(entry, dir, "global")
      await incrementTechniqueUsage(entry.id, dir, "global")
      const globalDb = getGlobalDb()
      const [row] = await globalDb.select().from(TechniqueTable).where(eq(TechniqueTable.id, entry.id)).all()
      expect(row.usage_count).toBe(1)
    })
  })
})
