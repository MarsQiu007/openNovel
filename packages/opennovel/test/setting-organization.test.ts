import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { NovelTable, WorldEntryTable, closeDb, getDb } from "@opennovel-ai/plugin/novel-writer/session-store"
import { createSettingOrganizationService } from "@/setting-organization"

let projectDir: string
const originalDb = process.env.OPENNOVEL_DB

beforeEach(() => {
  projectDir = join(tmpdir(), `setting-org-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  process.env.OPENNOVEL_DB = join(projectDir, ".novel", "novel.db")
})

afterEach(() => {
  closeDb(join(projectDir, ".novel", "novel.db"))
  if (originalDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = originalDb
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 可能在连接关闭后短暂持有 SQLite 文件句柄
  }
})

async function seed() {
  const db = getDb(projectDir)
  db
    .insert(NovelTable)
    .values({ id: "novel-ui", title: "设定整理 UI", genre: "玄幻", synopsis: "", status: "draft" })
    .run()
  db.insert(WorldEntryTable).values({
    id: "world-ui",
    novel_id: "novel-ui",
    category: "重要设定",
    title: "旧标题",
    content: "## 旧内容",
    created_at: Date.now(),
  }).run()
}

describe("setting organization adapter", () => {
  test("analyze 返回结构化问题并映射公开字段", async () => {
    await seed()
    const result = await createSettingOrganizationService().analyze("novel-ui", projectDir, {})
    expect(result.scope).toBe("all")
    expect(result.count).toBeGreaterThan(0)
    expect(result.issues.some((issue) => issue.type === "markdown_syntax" && issue.entryIds.includes("world-ui"))).toBe(true)
  })

  test("dryRun 返回合法计划的影响预览和摘要", async () => {
    await seed()
    const planJson = JSON.stringify({
      version: 1,
      operations: [
        {
          action: "update",
          id: "world-ui",
          fields: { title: "新标题" },
          reason: "修正标题",
        },
      ],
    })
    const result = await createSettingOrganizationService().dryRun("novel-ui", projectDir, { planJson })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.planDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.previews[0]?.entryIds).toEqual(["world-ui"])
    expect(result.previews[0]?.fields).toContain("title")
  })

  test("apply 拒绝未确认、摘要缺失、摘要不匹配和不合法计划", async () => {
    await seed()
    const service = createSettingOrganizationService()
    const planJson = JSON.stringify({
      version: 1,
      operations: [
        { action: "update", id: "world-ui", fields: { title: "新标题" }, reason: "修正标题" },
      ],
    })
    const dryRun = await service.dryRun("novel-ui", projectDir, { planJson })
    expect(dryRun.valid).toBe(true)

    const unconfirmed = await service.apply("novel-ui", projectDir, {
      planJson,
      planDigest: dryRun.planDigest,
      confirmed: false,
    })
    expect(unconfirmed.ok).toBe(false)
    expect(unconfirmed.errors.join(" ")).toContain("显式确认")

    const missingDigest = await service.apply("novel-ui", projectDir, { planJson, planDigest: "", confirmed: true })
    expect(missingDigest.ok).toBe(false)
    expect(missingDigest.errors.join(" ")).toContain("dry run 摘要")

    const digestMismatch = await service.apply("novel-ui", projectDir, {
      planJson,
      planDigest: "0".repeat(64),
      confirmed: true,
    })
    expect(digestMismatch.ok).toBe(false)
    expect(digestMismatch.errors.join(" ")).toContain("摘要不匹配")

    const invalidPlan = JSON.stringify({
      version: 1,
      operations: [{ action: "update", id: "world-ui", fields: { category: "重要设定" }, reason: "非法分类" }],
    })
    const invalid = await service.apply("novel-ui", projectDir, {
      planJson: invalidPlan,
      planDigest: "0".repeat(64),
      confirmed: true,
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.errors.length).toBeGreaterThan(0)

    const db = getDb(projectDir)
    const row = db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, "world-ui")).get()
    expect(row?.title).toBe("旧标题")
  })
})
