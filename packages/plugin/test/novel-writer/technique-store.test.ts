import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"

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
