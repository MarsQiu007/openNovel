/**
 * 4.1 技法功能端到端测试：
 * 导入技法 → 组装快照可见候选 → 开启注入后快照输出"写作技法指导"段 →
 * 模拟 auditor 反馈 → 置信度/状态演进 → usage 统计。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, getDb, NovelTable } from "@opennovel-ai/novel-store"
import {
  importExtractedTechniques,
  importSeedTechniques,
} from "../../src/novel-writer/cli.js"
import { assembleSnapshot, formatSnapshotToolOutput } from "../../src/novel-writer/context.js"
import {
  queryTechniques,
  recordFeedback,
  updateConfidenceFromFeedback,
  incrementTechniqueUsage,
} from "../../src/novel-writer/technique-store.js"
import { readTechniqueInjection, writeProjectConfig } from "../../src/novel-writer.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `tech-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(dir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 文件锁
  }
})

async function seedNovelWithDialogueSynopsis(): Promise<void> {
  const db = getDb(dir)
  await db.insert(NovelTable).values({ id: "n1", title: "测试", genre: "科幻", synopsis: "" }).run()
  await db.update(NovelTable).set({ synopsis: "一场关于信任的对话" }).where(eq(NovelTable.id, "n1")).run()
}

function techniqueJson(name: string, id?: string): Record<string, unknown> {
  return {
    ...(id ? { id } : {}),
    name,
    principle: "用动作替代直接回应",
    instruction: "写紧张对话时插入角色的微小动作来暗示态度",
    sceneTypes: ["dialogue"],
    level: "paragraph",
    evidence: [{ sourceTitle: "源", sourceLocation: "第一章", excerpt: "他停下筷子", annotation: "停顿" }],
    commonMisuse: "停顿过多",
  }
}

describe("技法链路端到端", () => {
  test("导入 → 快照可见 → 注入 → 反馈演进 → 用量统计", async () => {
    // 1. 两条导入路径入库：提取的 unverified + 种子的 verified
    const extractedPath = join(dir, "extracted.json")
    writeFileSync(extractedPath, JSON.stringify([techniqueJson("提取技法")]))
    const seedPath = join(dir, "seed.json")
    writeFileSync(seedPath, JSON.stringify([techniqueJson("种子技法")]))

    expect(await importExtractedTechniques(extractedPath, dir)).toBe(1)
    expect(await importSeedTechniques(seedPath, dir)).toBe(1)

    let all = await queryTechniques({ sceneType: "dialogue", contextText: "" }, dir)
    expect(all.length).toBe(2)
    const extracted = all.find((r) => r.entry.name === "提取技法")!
    expect(extracted.entry.status).toBe("unverified")
    expect(extracted.entry.confidence).toBe(0.5)
    const seeded = all.find((r) => r.entry.name === "种子技法")!
    expect(seeded.entry.status).toBe("verified")
    expect(seeded.entry.confidence).toBe(0.8)

    // 2. 默认（未开启注入）：快照输出为 shadow 候选段
    await seedNovelWithDialogueSynopsis()
    const snapshotOff = await assembleSnapshot("n1", 0, dir)
    const off = formatSnapshotToolOutput(snapshotOff!, { hooks: [] })
    expect(off.output).toContain("技法候选")
    expect(off.output).not.toContain("写作技法指导")
    expect(off.injectedTechniqueIds).toEqual([])

    // 3. 开关注入后：输出"写作技法指导"段（种子 0.8 ≥ 0.6 注入；提取 0.5 被门槛过滤）
    writeProjectConfig(dir, "novel", "technique_injection", "true")
    expect(readTechniqueInjection(dir)).toBe(true)

    const snapshotOn = await assembleSnapshot("n1", 0, dir)
    const on = formatSnapshotToolOutput(snapshotOn!, { hooks: [] }, { techniqueInjectionEnabled: true })
    expect(on.output).toContain("写作技法指导")
    expect(on.output).toContain("原样传递给 writer")
    expect(on.output).toContain("种子技法")
    expect(on.output).not.toContain("提取技法")
    expect(on.injectedTechniqueIds).toEqual([seeded.entry.id])

    // 4. 注入驱动用量统计
    await incrementTechniqueUsage(seeded.entry.id, dir)
    let after = await queryTechniques({ sceneType: "dialogue", contextText: "" }, dir)
    expect(after.find((r) => r.entry.id === seeded.entry.id)!.entry.usageCount).toBe(1)

    // 5. 模拟 auditor 反馈：提取技法 5 条高分反馈 → verified
    for (let i = 0; i < 5; i++) {
      await recordFeedback(
        { techniqueId: extracted.entry.id, chapterId: "ch1", score: 0.9, wasUsed: true, comment: "", createdAt: Date.now() + i },
        dir,
      )
    }
    await updateConfidenceFromFeedback(extracted.entry.id, dir)
    after = await queryTechniques({ sceneType: "dialogue", contextText: "" }, dir)
    const evolved = after.find((r) => r.entry.id === extracted.entry.id)!
    expect(evolved.entry.confidence).toBeGreaterThan(0.5)
    expect(evolved.entry.status).toBe("verified")
  })

  test("临时项目目录提取导入（CLI --import 等价路径）", async () => {
    // 与 CLI 相同：extract 落 JSON → importExtractedTechniques(directory) → 同一库
    const workDir = mkdtempSync(join(tmpdir(), "tech-e2e-cli-"))
    try {
      const outPath = join(workDir, "out.json")
      writeFileSync(outPath, JSON.stringify([techniqueJson("CLI导入技法")]))
      expect(await importExtractedTechniques(outPath, workDir)).toBe(1)
      const results = await queryTechniques({ sceneType: "dialogue", contextText: "" }, workDir)
      expect(results[0].entry.name).toBe("CLI导入技法")
      expect(results[0].entry.status).toBe("unverified")
    } finally {
      closeDb(workDir)
      try {
        rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows 文件锁
      }
    }
  })
})
