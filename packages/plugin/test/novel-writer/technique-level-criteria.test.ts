import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()
import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { TECHNIQUE_LEVELS, LEVEL_CRITERIA, isTechniqueLevel } from "../../src/novel-writer/technique.js"
import { normalizeTechnique } from "../../src/novel-writer/technique-normalize.js"
import { distillTechniques } from "../../src/novel-writer/technique-extract.js"
import { directorAgentConfig } from "../../src/novel-writer/agents/director.js"
import { upsertTechnique, listAllTechniques, updateTechniqueLevel } from "../../src/novel-writer/technique-store.js"
import { relevelTechniques } from "../../src/novel-writer/cli.js"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"

const testDir = mkdtempSync(join(tmpdir(), "technique-level-test-"))

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
  }
})

function makeTechnique(overrides?: Partial<TechniqueEntry>): TechniqueEntry {
  return {
    id: `tech_${Math.random().toString(36).slice(2, 8)}`,
    name: "测试技法",
    principle: "原则",
    instruction: "写具体可执行的操作指令，长度超过十字",
    sceneTypes: ["general"],
    level: "paragraph",
    evidence: [{ sourceTitle: "测试", sourceLocation: "第1章", excerpt: "原文片段", annotation: "标注" }],
    commonMisuse: "误用",
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

describe("层级判据单一事实源", () => {
  test("LEVEL_CRITERIA 覆盖全部 5 个枚举值且各带判定定义", () => {
    for (const level of TECHNIQUE_LEVELS) {
      expect(LEVEL_CRITERIA).toContain(level)
    }
    // 与 scene_types 的分工说明必须存在
    expect(LEVEL_CRITERIA).toContain("最小文本单元")
    // 不得出现 JSON 示例锚定模式（写死单一值诱导照抄）
    expect(LEVEL_CRITERIA).not.toContain('"level": "paragraph"')
  })

  test("isTechniqueLevel 校验枚举归属", () => {
    for (const level of TECHNIQUE_LEVELS) expect(isTechniqueLevel(level)).toBe(true)
    expect(isTechniqueLevel("chapter")).toBe(false)
    expect(isTechniqueLevel(undefined)).toBe(false)
    expect(isTechniqueLevel(123)).toBe(false)
  })

  test("director 学习流程提示词引用同一份判据且既有锚点不被破坏", () => {
    const prompt = directorAgentConfig.systemPrompt
    expect(prompt).toContain("最小文本单元")
    expect(prompt).toContain("判定顺序")
    // 4.2 对齐锚点保持完好
    expect(prompt).toContain("来学习这本书籍的写作技巧")
    expect(prompt).toContain("合并判断")
    expect(prompt).toContain("不得改动已有条目的 status 与 confidence")
  })
})

describe("normalize 层级兜底", () => {
  test("非法值与缺失值回落 paragraph，合法值原样保留", () => {
    expect(normalizeTechnique({ name: "x" }).level).toBe("paragraph")
    expect(normalizeTechnique({ name: "x", level: "chapter" as never }).level).toBe("paragraph")
    expect(normalizeTechnique({ name: "x", level: "dialogue" }).level).toBe("dialogue")
  })
})

describe("蒸馏提示词", () => {
  test("含判据、示例不锚定 paragraph、传入高亮层级信号", async () => {
    let captured = ""
    const fakeLlm = async (prompt: string) => {
      captured = prompt
      return JSON.stringify({ techniques: [] })
    }
    await distillTechniques(
      [
        {
          segment: { title: "第1章", text: "正文", startOffset: 0, endOffset: 2 },
          reason: "短句节奏",
          sceneType: "dialogue",
          level: "sentence",
        },
      ],
      fakeLlm,
    )
    expect(captured).toContain("最小文本单元")
    expect(captured).not.toContain('"level": "paragraph"')
    expect(captured).toContain("[高亮层级: sentence]")
  })
})

describe("updateTechniqueLevel", () => {
  test("仅更新 level 并触碰 updated_at，其余字段不动", async () => {
    const before = makeTechnique({ id: "tech_update_1" })
    await upsertTechnique(before, testDir, "book")
    await new Promise((r) => setTimeout(r, 5))
    await updateTechniqueLevel("tech_update_1", "transition", testDir, "book")
    const [after] = (await listAllTechniques(testDir)).filter(({ entry }) => entry.id === "tech_update_1")
    expect(after.entry.level).toBe("transition")
    expect(after.entry.status).toBe(before.status)
    expect(after.entry.confidence).toBe(before.confidence)
    expect(after.entry.evidence).toEqual(before.evidence)
    expect(after.entry.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
  })
})

describe("relevelTechniques 双源重分类", () => {
  const relevelDir = mkdtempSync(join(tmpdir(), "technique-relevel-test-"))
  test("双源处理 + 非法值保留 + 幂等重跑 + 解析失败计数", async () => {
    await upsertTechnique(makeTechnique({ id: "tech_b1", name: "B1" }), relevelDir, "book")
    await upsertTechnique(makeTechnique({ id: "tech_b2", name: "B2" }), relevelDir, "book")
    await upsertTechnique(makeTechnique({ id: "tech_g1", name: "G1" }), relevelDir, "global")

    const fakeLlm = async () =>
      JSON.stringify({
        judgments: [
          { id: "tech_b1", level: "dialogue" },
          { id: "tech_b2", level: "not_a_level" },
          { id: "tech_g1", level: "description" },
        ],
      })

    const r1 = await relevelTechniques(relevelDir, fakeLlm, { batchSize: 10 })
    expect(r1.total).toBe(3)
    expect(r1.changed).toBe(2)
    expect(r1.kept).toBe(1)
    expect(r1.failed).toBe(0)
    expect(r1.before).toEqual({ paragraph: 3 })
    expect(r1.after).toEqual({ dialogue: 1, description: 1, paragraph: 1 })

    const levels = new Map((await listAllTechniques(relevelDir)).map(({ entry }) => [entry.id, entry.level]))
    expect(levels.get("tech_b1")).toBe("dialogue")
    expect(levels.get("tech_b2")).toBe("paragraph")
    expect(levels.get("tech_g1")).toBe("description")

    // 幂等：同一判定再跑一遍零变更
    const r2 = await relevelTechniques(relevelDir, fakeLlm, { batchSize: 10 })
    expect(r2.changed).toBe(0)
    expect(r2.kept).toBe(3)

    // 整批解析失败：计数且不破坏数据
    const r3 = await relevelTechniques(relevelDir, async () => "not json at all", { batchSize: 10 })
    expect(r3.failed).toBe(3)
    const levelsAfter = new Map((await listAllTechniques(relevelDir)).map(({ entry }) => [entry.id, entry.level]))
    expect(levelsAfter.get("tech_b1")).toBe("dialogue")
  })
})