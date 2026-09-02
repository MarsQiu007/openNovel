import { describe, test, expect } from "bun:test"
import { applyP7Budget, formatTechniquesForPrompt, formatTechniquesForShadow } from "../../src/novel-writer/technique-inject.js"
import type { RetrievedTechnique } from "../../src/novel-writer/technique.js"

function makeTechnique(name: string, instructionLen: number, score = 0.9): RetrievedTechnique {
  return {
    entry: {
      id: `tech_${name}`,
      name,
      principle: "原则",
      instruction: "A".repeat(instructionLen),
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [],
      commonMisuse: "",
      confidence: 0.8,
      status: "verified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    matchScore: score,
  }
}

describe("applyP7Budget", () => {
  test("truncates to fit 1K token budget", () => {
    const techniques = Array.from({ length: 20 }, (_, i) => makeTechnique(`技法${i}`, 200))
    const result = applyP7Budget(techniques)
    expect(result.length).toBeLessThan(20)
    expect(result.length).toBeGreaterThan(3)
  })

  test("empty returns empty", () => {
    expect(applyP7Budget([])).toEqual([])
  })

  test("higher match score kept first", () => {
    const techniques = [makeTechnique("低分", 100, 0.3), makeTechnique("高分", 100, 0.9)]
    const result = applyP7Budget(techniques)
    expect(result[0].entry.name).toBe("高分")
  })
})

describe("formatTechniquesForPrompt", () => {
  test("produces readable section", () => {
    const result = formatTechniquesForPrompt([makeTechnique("测试", 50)])
    expect(result).toContain("测试")
    expect(result).toContain("写作技法")
  })

  test("empty returns empty string", () => {
    expect(formatTechniquesForPrompt([])).toBe("")
  })
})

describe("formatTechniquesForShadow", () => {
  test("每行包含 id、name、instruction，供 pipeline 报告与 auditor 反馈", () => {
    const t = makeTechnique("停顿暗示拒绝", 50)
    const lines = formatTechniquesForShadow([t])
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain(t.entry.id)
    expect(lines[0]).toContain("停顿暗示拒绝")
    expect(lines[0]).toContain(t.entry.instruction)
  })

  test("空数组返回空数组", () => {
    expect(formatTechniquesForShadow([])).toEqual([])
  })
})
