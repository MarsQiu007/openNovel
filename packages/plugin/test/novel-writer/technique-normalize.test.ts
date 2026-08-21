import { describe, test, expect } from "bun:test"
import { normalizeTechnique } from "../../src/novel-writer/technique-normalize.js"

describe("normalizeTechnique", () => {
  test("fills missing required fields", () => {
    const partial = {
      name: "测试技法",
      principle: "原则",
      instruction: "具体指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }],
      commonMisuse: "",
    }
    const entry = normalizeTechnique(partial)
    expect(entry.id).toBeTruthy()
    expect(entry.confidence).toBe(0.5)
    expect(entry.status).toBe("unverified")
    expect(entry.embedding).toBeNull()
    expect(entry.usageCount).toBe(0)
    expect(entry.createdAt).toBeGreaterThan(0)
  })

  test("preserves existing fields", () => {
    const partial = {
      id: "tech_custom",
      name: "测试",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [],
      commonMisuse: "",
      confidence: 0.9,
      status: "verified",
    }
    const entry = normalizeTechnique(partial)
    expect(entry.id).toBe("tech_custom")
    expect(entry.confidence).toBe(0.9)
    expect(entry.status).toBe("verified")
  })

  test("seed entry gets verified status and higher confidence", () => {
    const partial = {
      name: "种子技法",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [{ sourceTitle: "写作理论", sourceLocation: "经典", excerpt: "...", annotation: "..." }],
      commonMisuse: "",
    }
    const entry = normalizeTechnique(partial, { seed: true })
    expect(entry.status).toBe("verified")
    expect(entry.confidence).toBe(0.8)
  })
})
