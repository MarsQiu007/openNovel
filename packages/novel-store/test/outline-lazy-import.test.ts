/**
 * 大纲懒导入测试
 *
 * 覆盖：总纲/卷纲的存量 Markdown 文件懒导入、文件缺失、导入失败。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { closeDb, getDb, NovelTable, resolveMasterOutline, resolveVolumeOutline, VolumeTable } from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `outline-lazy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel", "outlines"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

async function seedNovel() {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id: "novel-1", title: "测试书", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
}

async function seedVolume(novelId: string, order: number) {
  const db = getDb(projectDir)
  await db
    .insert(VolumeTable)
    .values({ id: `vol-${order}`, novel_id: novelId, title: `第${order}卷`, summary: "", order, created_at: 1 })
    .run()
}

describe("master outline lazy import", () => {
  test("数据库有总纲时直接返回", async () => {
    await seedNovel()
    const db = getDb(projectDir)
    const outline = "# 总纲内容"
    await db.update(NovelTable).set({ master_outline: outline }).where(eq(NovelTable.id, "novel-1")).run()
    const resolved = await resolveMasterOutline("novel-1", projectDir)
    expect(resolved).toEqual({ outline, available: true, source: "database" })
  })

  test("数据库为空时读取 master-outline.md 并导入数据库", async () => {
    await seedNovel()
    const outline = "# 存量总纲\n\n主线剧情。"
    writeFileSync(join(projectDir, ".novel", "outlines", "master-outline.md"), outline)
    const resolved = await resolveMasterOutline("novel-1", projectDir)
    expect(resolved).toEqual({ outline, available: true, source: "file" })
    const [novel] = getDb(projectDir).select().from(NovelTable).where(eq(NovelTable.id, "novel-1")).all()
    expect(novel.master_outline).toBe(outline)
  })

  test("master-outline.md 不存在时读取 master.md（WebUI 写入的旧文件）", async () => {
    await seedNovel()
    const outline = "# WebUI 编辑的总纲"
    writeFileSync(join(projectDir, ".novel", "outlines", "master.md"), outline)
    const resolved = await resolveMasterOutline("novel-1", projectDir)
    expect(resolved).toEqual({ outline, available: true, source: "file" })
  })

  test("文件缺失时按缺失降级", async () => {
    await seedNovel()
    const resolved = await resolveMasterOutline("novel-1", projectDir)
    expect(resolved).toEqual({ outline: null, available: false, source: "missing" })
  })

  test("文件不可读（目录）时按缺失降级", async () => {
    await seedNovel()
    mkdirSync(join(projectDir, ".novel", "outlines", "master-outline.md"), { recursive: true })
    const resolved = await resolveMasterOutline("novel-1", projectDir)
    expect(resolved).toEqual({ outline: null, available: false, source: "missing" })
  })
})

describe("volume outline lazy import", () => {
  test("数据库有卷纲时直接返回", async () => {
    await seedNovel()
    await seedVolume("novel-1", 1)
    const db = getDb(projectDir)
    const outline = "# 第一卷大纲"
    await db.update(VolumeTable).set({ outline }).where(eq(VolumeTable.id, "vol-1")).run()
    const resolved = await resolveVolumeOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline, available: true, source: "database" })
  })

  test("数据库为空时读取 volume-{n}.md 并导入数据库", async () => {
    await seedNovel()
    await seedVolume("novel-1", 1)
    const outline = "# 存量卷纲\n\n章节列表。"
    writeFileSync(join(projectDir, ".novel", "outlines", "volume-1.md"), outline)
    const resolved = await resolveVolumeOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline, available: true, source: "file" })
    const [vol] = getDb(projectDir).select().from(VolumeTable).where(eq(VolumeTable.id, "vol-1")).all()
    expect(vol.outline).toBe(outline)
  })

  test("文件缺失时按缺失降级", async () => {
    await seedNovel()
    await seedVolume("novel-1", 1)
    const resolved = await resolveVolumeOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline: null, available: false, source: "missing" })
  })

  test("文件不可读（目录）时按缺失降级", async () => {
    await seedNovel()
    await seedVolume("novel-1", 1)
    mkdirSync(join(projectDir, ".novel", "outlines", "volume-1.md"), { recursive: true })
    const resolved = await resolveVolumeOutline("novel-1", 1, projectDir)
    expect(resolved).toEqual({ outline: null, available: false, source: "missing" })
  })
})
