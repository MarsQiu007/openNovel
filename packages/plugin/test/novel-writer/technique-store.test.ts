import { describe, test, expect, afterAll } from "bun:test"
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
} from "../../src/novel-writer/technique-store.js"

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
    const entry = makeTechnique({ confidence: 0.3, sceneTypes: ["confidence_test"] })
    await upsertTechnique(entry, testDir)
    const results = await queryTechniques(
      { sceneType: "confidence_test", contextText: "", minConfidence: 0.5 },
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
