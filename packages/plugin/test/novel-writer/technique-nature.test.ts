import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { closeDb, getDb, NovelTable, updateNovel } from "../../src/novel-writer/session-store.js"
import { resolveBookContentNature, resolveChapterContentNature } from "../../src/novel-writer/technique-nature.js"
import { upsertTechnique } from "../../src/novel-writer/technique-store.js"
import { assembleSnapshot } from "../../src/novel-writer/context.js"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `technique-nature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {}
})

function makeTechnique(overrides?: Partial<TechniqueEntry>): TechniqueEntry {
  return {
    id: `nature_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: "技法",
    principle: "原则",
    instruction: "指令",
    sceneTypes: ["dialogue"],
    level: "paragraph",
    evidence: [],
    commonMisuse: "",
    confidence: 0.8,
    status: "verified",
    scope: "general",
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

async function seedNovelWithAdultTechnique(novelNature: "general" | "adult" = "general"): Promise<void> {
  const db = getDb(dir)
  db.insert(NovelTable)
    .values({ id: "novel-1", title: "测试", genre: "科幻", synopsis: "一场对话", content_nature: novelNature })
    .run()
  await upsertTechnique(makeTechnique({ name: "通用技法", scope: "general", confidence: 0.8 }), dir, "book")
  await upsertTechnique(makeTechnique({ name: "受限技法", scope: "adult", confidence: 0.9 }), dir, "book")
}

describe("resolveBookContentNature", () => {
  test("无 adult 技法：general", async () => {
    expect(await resolveBookContentNature(dir)).toBe("general")
  })

  test("书库存在 adult 技法但 novel 为 general：仍判 general（不再看技法信号）", async () => {
    await seedNovelWithAdultTechnique("general")
    expect(await resolveBookContentNature(dir)).toBe("general")
  })

  test("novel 显式 adult：判 adult；改回 general 后回落（列驱动）", async () => {
    await seedNovelWithAdultTechnique("adult")
    expect(await resolveBookContentNature(dir)).toBe("adult")
    await updateNovel("novel-1", { content_nature: "general" }, dir)
    expect(await resolveBookContentNature(dir)).toBe("general")
  })

  test("查询失败按从紧回落 general 不抛异常", async () => {
    const weirdDir = join(tmpdir(), `nature-weird-${Date.now()}`)
    mkdirSync(weirdDir)
    writeFileSync(join(weirdDir, ".novel"), "not a directory")
    expect(await resolveBookContentNature(weirdDir)).toBe("general")
    rmSync(weirdDir, { recursive: true, force: true })
  })
})

describe("resolveChapterContentNature", () => {
  test("adult 原样通过，其余一律 general（从紧）", () => {
    expect(resolveChapterContentNature("adult")).toBe("adult")
    expect(resolveChapterContentNature(undefined)).toBe("general")
    expect(resolveChapterContentNature("general")).toBe("general")
    expect(resolveChapterContentNature("nsfw")).toBe("general")
  })
})

describe("assembleSnapshot 双闸门接入", () => {
  test("书库有 adult 技法但未传参数：adult 不进候选", async () => {
    await seedNovelWithAdultTechnique()
    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    const names = snapshot!.techniques.map((t) => t.entry.name)
    expect(names).toContain("通用技法")
    expect(names).not.toContain("受限技法")
  })

  test("书级 general 时即使传 content_nature=adult：adult 仍不进候选", async () => {
    await seedNovelWithAdultTechnique("general")
    const snapshot = await assembleSnapshot("novel-1", 0, dir, "adult")
    const names = snapshot!.techniques.map((t) => t.entry.name)
    expect(names).not.toContain("受限技法")
  })

  test("书级 adult 且传 content_nature=adult：双闸门通过，adult 进候选", async () => {
    await seedNovelWithAdultTechnique("adult")
    const snapshot = await assembleSnapshot("novel-1", 0, dir, "adult")
    const names = snapshot!.techniques.map((t) => t.entry.name)
    expect(names).toContain("受限技法")
  })

})
