import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, createWorldEntry, getDb, NovelTable, StyleGuideTable } from "@opennovel-ai/novel-store"
import {
  assembleSnapshot,
  formatSnapshotToolOutput,
  STYLE_GUIDE_TRUNCATED_HINT,
  styleGuideRuleLines,
} from "../../src/novel-writer/context.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `novel-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件句柄释放有延迟，尽力清理即可
  }
})

async function seedNovel(novelId: string) {
  const db = getDb(dir)
  await db.insert(NovelTable).values({ id: novelId, title: "测试", genre: "科幻", synopsis: "" }).run()
}

describe("assembleSnapshot 世界观导览", () => {
  test("快照包含世界观条目的分类与标题", async () => {
    await seedNovel("novel-1")
    await createWorldEntry("novel-1", "地理", "风息城", "正文", dir)
    await createWorldEntry("novel-1", "势力", "旧议会", "正文", dir)

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.worldEntries).toEqual([
      expect.objectContaining({ category: "地理", title: "风息城", content: "正文" }),
      expect.objectContaining({ category: "势力", title: "旧议会", content: "正文" }),
    ])
  })

  test("无世界观条目时 worldEntries 为空数组", async () => {
    await seedNovel("novel-1")
    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    expect(snapshot!.worldEntries).toEqual([])
  })
})

// ── 2.1 回归测试：快照工具输出的技法候选序列化（防序列化断点复发） ──

describe("formatSnapshotToolOutput 技法候选", () => {
  test("候选非空时输出含候选段落（id/名称/指令）与 metadata 计数", async () => {
    await seedNovel("novel-1")
    const { upsertTechnique } = await import("../../src/novel-writer/technique-store.js")
    await upsertTechnique(
      {
        id: "tech_regress_1",
        name: "停顿暗示拒绝",
        principle: "原则",
        instruction: "写紧张对话时插入微小动作",
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
      dir,
    )

    // synopsis 含"对话" → 场景 dialogue → 命中技法
    const db = getDb(dir)
    await db
      .update(NovelTable)
      .set({ synopsis: "一场关于信任的对话" })
      .where(eq(NovelTable.id, "novel-1"))
      .run()

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.techniques.length).toBe(1)

    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(result.output).toContain("技法候选")
    expect(result.output).toContain("tech_regress_1")
    expect(result.output).toContain("停顿暗示拒绝")
    expect(result.output).toContain("写紧张对话时插入微小动作")
    expect(result.metadata.technique_count).toBe(1)
  })

  test("候选为空时不输出候选段落", async () => {
    await seedNovel("novel-1")
    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(result.output).not.toContain("技法候选")
    expect(result.metadata.technique_count).toBe(0)
  })
})

// ── 3.3 注入已移至 confirm_techniques：快照统一 shadow 输出 ──

import { upsertTechnique } from "../../src/novel-writer/technique-store.js"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"

function makeEntry(id: string, name: string, confidence: number, instructionLen = 30): TechniqueEntry {
  return {
    id,
    name,
    principle: "原则",
    instruction: "A".repeat(instructionLen),
    sceneTypes: ["dialogue"],
    level: "paragraph",
    evidence: [],
    commonMisuse: "",
    confidence,
    status: "verified",
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe("formatSnapshotToolOutput 统一 shadow 输出", () => {
  test("候选非空时只输出 shadow 候选段，不再产出写作技法指导段", async () => {
    await seedNovel("novel-1")
    await getDb(dir).update(NovelTable).set({ synopsis: "对话" }).where(eq(NovelTable.id, "novel-1")).run()
    await upsertTechnique(makeEntry("tech_high", "高分技法", 0.8), dir)
    await upsertTechnique(makeEntry("tech_low", "低分技法", 0.5), dir)

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })

    // 注入改由 pipeline 评估后调 confirm_techniques 完成，快照只出 shadow 候选段
    expect(result.output).toContain("技法候选")
    expect(result.output).toContain("tech_high")
    expect(result.output).toContain("tech_low")
    expect(result.output).not.toContain("写作技法指导")
    expect(result.output).not.toContain("原样传递给 writer")
  })
})

describe("formatSnapshotToolOutput 风格规则", () => {
  async function seedStyleGuide(novelId: string, rules: unknown) {
    await getDb(dir)
      .insert(StyleGuideTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        rules,
        tone: "冷峻",
        pov: "第三人称",
        tense: "过去时",
      })
      .run()
  }

  test("历史嵌套 rules 归一化后逐条渲染规则行", async () => {
    await seedNovel("novel-1")
    await seedStyleGuide("novel-1", {
      异能体系: { 等级严格: "三级" },
      禁用手法: ["总结式收尾"],
    })

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    expect(snapshot!.styleGuideTruncated).toBe(false)
    expect(snapshot!.styleGuide!.rules).toEqual({
      "异能体系.等级严格": "三级",
      "禁用手法.0": "总结式收尾",
    })

    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(result.output).toContain("风格：基调=冷峻 视角=第三人称 时态=过去时")
    expect(result.output).toContain("风格规则：")
    expect(result.output).toContain("- 异能体系.等级严格: 三级")
    expect(result.output).toContain("- 禁用手法.0: 总结式收尾")
    expect(result.output).not.toContain("[object Object]")
  })

  test("规则为空时不渲染规则段", async () => {
    await seedNovel("novel-1")
    await seedStyleGuide("novel-1", {})

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(result.output).toContain("风格：基调=冷峻 视角=第三人称 时态=过去时")
    expect(result.output).not.toContain("风格规则：")
  })
})

describe("styleGuideRuleLines", () => {
  test("空规则不产生规则行；截断时为规则行附查询提示", () => {
    expect(styleGuideRuleLines({ rules: {}, tone: "", pov: "", tense: "" }, false)).toEqual([])
    expect(styleGuideRuleLines({ rules: { 节奏: "张弛有度" }, tone: "", pov: "", tense: "" }, true)).toEqual([
      "风格规则：",
      "- 节奏: 张弛有度",
      STYLE_GUIDE_TRUNCATED_HINT,
    ])
  })
})
