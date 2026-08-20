/**
 * soul 表 CRUD 测试
 *
 * soul 存每本小说的人格文本：每小说单行，upsert 惯例（与 style_guide 一致，
 * novel_id 不加 UNIQUE 约束是有意为之），删除小说时外键级联清理。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, getDb, getSoul, NovelTable, SoulTable, upsertSoul } from "../src/index.js"
import { eq } from "drizzle-orm"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-soul-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  // Windows 下无法删除已打开的文件，尽力清理
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败，进程退出后系统会回收临时文件
  }
})

async function seedNovel(id: string) {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id, title: "测试", genre: "科幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
}

describe("soul", () => {
  test("未设置时 getSoul 返回 undefined", async () => {
    await seedNovel("novel-1")
    expect(await getSoul("novel-1", projectDir)).toBeUndefined()
  })

  test("upsertSoul 首次插入，再次调用更新同一行（每小说单行）", async () => {
    await seedNovel("novel-1")
    const created = await upsertSoul("novel-1", "人格 A", projectDir)
    expect(created.content).toBe("人格 A")

    const updated = await upsertSoul("novel-1", "人格 B", projectDir)
    expect(updated.id).toBe(created.id)
    expect(updated.content).toBe("人格 B")
    expect(updated.updated_at).toBeGreaterThanOrEqual(created.updated_at)

    const rows = await getDb(projectDir).select().from(SoulTable).where(eq(SoulTable.novel_id, "novel-1")).all()
    expect(rows.length).toBe(1)
  })

  test("删除小说时 soul 行级联删除", async () => {
    await seedNovel("novel-1")
    await upsertSoul("novel-1", "人格", projectDir)
    await getDb(projectDir).delete(NovelTable).where(eq(NovelTable.id, "novel-1")).run()
    expect(await getSoul("novel-1", projectDir)).toBeUndefined()
  })
})
