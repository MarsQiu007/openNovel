import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { TechniqueEntry, TechniqueLevel, TechniqueStatus } from "../../src/novel-writer/technique.js"
import { saveTechnique, searchTechniques, confirmTechniques } from "../../src/novel-writer/technique-learn.js"
import { upsertTechnique, listTechniques } from "../../src/novel-writer/technique-store.js"

const testDir = mkdtempSync(join(tmpdir(), "technique-learn-test-"))

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
  }
})

function makeInput(overrides?: Partial<Parameters<typeof saveTechnique>[0]>) {
  return {
    name: "对话停顿制造张力",
    principle: "停顿比直接回应更有张力",
    instruction: "写紧张对话时每3句插入一个角色的微小动作",
    sceneTypes: ["dialogue"],
    level: "paragraph" as TechniqueLevel,
    evidence: [{ sourceTitle: "书A", sourceLocation: "第1章", excerpt: "他停下筷子", annotation: "停顿暗示拒绝" }],
    commonMisuse: "停顿过多导致拖沓",
    ...overrides,
  }
}

function makeTechnique(overrides?: Partial<TechniqueEntry>): TechniqueEntry {
  const now = Date.now()
  return {
    id: `tech_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: "环境外化情绪",
    principle: "用环境折射内心",
    instruction: "写情绪转折时用光线温度变化暗示角色内心",
    sceneTypes: ["emotion_shift"],
    level: "paragraph",
    evidence: [{ sourceTitle: "书B", sourceLocation: "第2章", excerpt: "光变窄了", annotation: "压迫感" }],
    commonMisuse: "描写与情绪脱节",
    confidence: 0.5,
    status: "unverified" as TechniqueStatus,
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("saveTechnique", () => {
  test("合法候选直接入库（unverified/0.5）", async () => {
    const result = await saveTechnique(makeInput({ name: "新学技法甲" }), undefined, testDir)
    expect(result.action).toBe("created")
    const [entry] = await listTechniques(testDir)
    expect(entry.name).toBe("新学技法甲")
    expect(entry.status).toBe("unverified")
    expect(entry.confidence).toBe(0.5)
  })

  test("同名候选自动合并证据", async () => {
    const first = await saveTechnique(makeInput({ name: "同名合并技法" }), undefined, testDir)
    expect(first.action).toBe("created")
    const second = await saveTechnique(
      makeInput({
        name: "同名合并技法",
        evidence: [{ sourceTitle: "书C", sourceLocation: "第3章", excerpt: "她别过脸", annotation: "回避" }],
      }),
      undefined,
      testDir,
    )
    expect(second.action).toBe("merged")
    const all = await listTechniques(testDir)
    const merged = all.filter((e) => e.name === "同名合并技法")
    expect(merged.length).toBe(1)
    expect(merged[0].evidence.length).toBe(2)
  })

  test("显式 merge_target_id 合并到近似技法", async () => {
    const target = makeTechnique({ name: "近似技法目标" })
    await upsertTechnique(target, testDir)
    const result = await saveTechnique(makeInput({ name: "换个名字的近似技法" }), target.id, testDir)
    expect(result.action).toBe("merged")
    expect(result.technique_id).toBe(target.id)
    const [after] = (await listTechniques(testDir)).filter((e) => e.id === target.id)
    expect(after.evidence.length).toBe(2)
  })

  test("模糊指令被黑名单拒绝", async () => {
    const result = await saveTechnique(makeInput({ instruction: "要注意对话节奏" }), undefined, testDir)
    expect(result.action).toBe("rejected")
    expect(result.reason).toBe("模糊指令或无证据")
  })

  test("无证据候选被拒绝", async () => {
    const result = await saveTechnique(makeInput({ name: "无证据技法", evidence: [] }), undefined, testDir)
    expect(result.action).toBe("rejected")
  })
})

describe("searchTechniques", () => {
  test("空库返回空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "technique-search-empty-"))
    const { count } = await searchTechniques({}, dir)
    expect(count).toBe(0)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
    }
  })

  test("关键词命中名称/原则/指令", async () => {
    const { lines, count } = await searchTechniques({ keyword: "停顿" }, testDir)
    expect(count).toBeGreaterThan(0)
    expect(lines.some((l) => l.includes("同名合并技法") || l.includes("新学技法甲"))).toBe(true)
  })

  test("场景过滤", async () => {
    const { count } = await searchTechniques({ sceneType: "dialogue" }, testDir)
    const all = await listTechniques(testDir)
    const dialogueCount = all.filter((e) => e.sceneTypes.includes("dialogue")).length
    expect(count).toBe(dialogueCount)
  })

  test("状态过滤", async () => {
    await upsertTechnique(makeTechnique({ name: "已验证技法", status: "verified" }), testDir)
    const { count } = await searchTechniques({ status: "verified" }, testDir)
    expect(count).toBe(1)
  })
})

describe("confirmTechniques", () => {
  test("空 ids 返回空段落", async () => {
    const result = await confirmTechniques([], testDir)
    expect(result.section).toBe("")
    expect(result.injected).toBe(0)
  })

  test("确认后使用计数递增并返回段落文本", async () => {
    const all = await listTechniques(testDir)
    const ids = all.slice(0, 2).map((e) => e.id)
    const result = await confirmTechniques(ids, testDir)
    expect(result.injected).toBe(2)
    expect(result.section).toContain("写作技法指导")
    const after = await listTechniques(testDir)
    for (const id of ids) {
      expect(after.find((e) => e.id === id)?.usageCount).toBe(1)
    }
  })

  test("超预算时按匹配分裁剪", async () => {
    const dir = mkdtempSync(join(tmpdir(), "technique-confirm-budget-"))
    try {
      const longInstruction = "写对话时每3句插入一个角色的微小动作来暗示态度变化，".repeat(20)
      for (let i = 0; i < 5; i++) {
        await upsertTechnique(
          makeTechnique({
            name: `预算技法${i}`,
            sceneTypes: ["dialogue"],
            instruction: `${longInstruction}第${i}条变体`,
            confidence: 0.9 - i * 0.1,
            status: "verified",
          }),
          dir,
        )
      }
      const all = await listTechniques(dir)
      const ids = all.map((e) => e.id)
      const result = await confirmTechniques(ids, dir)
      expect(result.injected).toBeLessThan(5)
      expect(result.injected_ids[0]).toBe(all[0].id)
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows 上 SQLite 连接可能尚未释放，忽略清理失败
      }
    }
  })
})
