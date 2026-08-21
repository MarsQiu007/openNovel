import { describe, test, expect } from "bun:test"
import { formatHindsightDocument } from "../../src/novel-writer/technique-hindsight.js"

describe("formatHindsightDocument", () => {
  test("produces tagged document", () => {
    const doc = formatHindsightDocument({
      id: "tech_001",
      name: "测试技法",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [
        { sourceTitle: "书A", sourceLocation: "第1章", excerpt: "文本", annotation: "标注" },
      ],
      commonMisuse: "误用",
      confidence: 0.5,
      status: "unverified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(doc.tags).toContain("technique")
    expect(doc.tags).toContain("scene:dialogue")
    expect(doc.tags).toContain("level:paragraph")
    expect(doc.text).toContain("测试技法")
    expect(doc.text).toContain("书A")
  })

  test("evidence-less entry still formats", () => {
    const doc = formatHindsightDocument({
      id: "tech_002",
      name: "无证据技法",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["general"],
      level: "paragraph",
      evidence: [],
      commonMisuse: "",
      confidence: 0.5,
      status: "unverified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(doc.tags).toContain("technique")
    expect(doc.text).toContain("无证据技法")
    expect(doc.context).toContain("unknown")
  })
})
