import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, createWorldEntry, getDb, NovelTable } from "@opennovel-ai/novel-store"
import { assembleSnapshot, formatSnapshotToolOutput } from "../../src/novel-writer/context.js"

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
    expect(result.injectedTechniqueIds).toEqual([]) // 默认 shadow，不注入
  })

  test("候选为空时不输出候选段落", async () => {
    await seedNovel("novel-1")
    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] })
    expect(result.output).not.toContain("技法候选")
    expect(result.metadata.technique_count).toBe(0)
  })
})

// ── 3.3 注入开关分流 ──

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

describe("formatSnapshotToolOutput 注入开关", () => {
  test("开启时输出'写作技法指导'段，过滤置信度 < 0.6，返回注入 id", async () => {
    await seedNovel("novel-1")
    await getDb(dir).update(NovelTable).set({ synopsis: "对话" }).where(eq(NovelTable.id, "novel-1")).run()
    await upsertTechnique(makeEntry("tech_high", "高分技法", 0.8), dir)
    await upsertTechnique(makeEntry("tech_low", "低分技法", 0.5), dir)

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] }, { techniqueInjectionEnabled: true })

    expect(result.output).toContain("写作技法指导")
    expect(result.output).toContain("原样传递给 writer")
    expect(result.output).toContain("高分技法")
    expect(result.output).not.toContain("低分技法")
    // 注入段替换 shadow 候选段
    expect(result.output).not.toContain("严禁注入 writer prompt")
    expect(result.injectedTechniqueIds).toEqual(["tech_high"])
  })

  test("超预算裁剪：两条合计超 1000 token 时只保留匹配分最高的", async () => {
    await seedNovel("novel-1")
    await getDb(dir).update(NovelTable).set({ synopsis: "对话" }).where(eq(NovelTable.id, "novel-1")).run()
    // 每条约 940 token，合计超 1000 → 只留第一条（置信度更高）
    await upsertTechnique(makeEntry("tech_big", "长指令技法A", 0.9, 1400), dir)
    await upsertTechnique(makeEntry("tech_fit", "长指令技法B", 0.8, 1400), dir)

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const result = formatSnapshotToolOutput(snapshot!, { hooks: [] }, { techniqueInjectionEnabled: true })

    expect(result.output).toContain("长指令技法A")
    expect(result.output).not.toContain("长指令技法B")
    expect(result.injectedTechniqueIds).toEqual(["tech_big"])
  })
})
