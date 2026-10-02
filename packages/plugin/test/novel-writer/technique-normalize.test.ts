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

  test("自由文本场景标签空交集回退为 general", () => {
    const entry = normalizeTechnique({ sceneTypes: ["性感场景", "约会场景"] })
    expect(entry.sceneTypes).toEqual(["general"])
  })

  test("混合标签保留规范值丢弃自由文本", () => {
    const entry = normalizeTechnique({ sceneTypes: ["dialogue", "约会场景"] })
    expect(entry.sceneTypes).toEqual(["dialogue"])
  })

  test("纯规范标签原样保留", () => {
    const entry = normalizeTechnique({ sceneTypes: ["action", "dialogue"] })
    expect(entry.sceneTypes).toEqual(["action", "dialogue"])
  })

  test("空数组回退为 general", () => {
    const entry = normalizeTechnique({ sceneTypes: [] })
    expect(entry.sceneTypes).toEqual(["general"])
  })

  test("未提供场景标签维持默认 general", () => {
    const entry = normalizeTechnique({})
    expect(entry.sceneTypes).toEqual(["general"])
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
