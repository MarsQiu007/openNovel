/**
 * exercise 重置管线回归测试。
 *
 * 覆盖：重置后 schema 完整（core 先行、未触发守卫）、同步 worker 停止、
 * novel-store 陈旧连接被驱逐（新代库看不到旧数据）、canary 对缺 session 的库快速报错并可恢复。
 *
 * 注意：test preload 默认把 OPENNOVEL_DB 钉为 ":memory:"，本文件指向临时库文件，
 * 并在 afterAll 保存/恢复原值（内存库形态下共享文件语义不成立，canary 无意义）。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { assertExerciseSchemaReady, clearExerciseDatabase, resetExerciseDatabase } from "./httpapi-exercise/reset"

const originalDb = process.env.OPENNOVEL_DB
const originalFlagDb = Flag.OPENNOVEL_DB
const tempDir = join(tmpdir(), `httpapi-exercise-reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const dbPath = join(tempDir, "exercise.db")

beforeAll(() => {
  mkdirSync(tempDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
  Flag.OPENNOVEL_DB = dbPath
})

afterAll(async () => {
  const { closeDbPath } = await import("@opennovel-ai/novel-store")
  closeDbPath(dbPath)
  if (originalDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = originalDb
  Flag.OPENNOVEL_DB = originalFlagDb
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

describe("exercise reset 管线", () => {
  test("重置后 schema 完整、worker 停止、陈旧连接被驱逐", async () => {
    const { isSyncWorkerRunning, registerSyncDirectory } = await import("../../src/novel/manual-edit-sync-worker")
    const { getDb, NovelTable } = await import("@opennovel-ai/novel-store")

    registerSyncDirectory(tempDir)
    expect(isSyncWorkerRunning()).toBe(true)
    const seeded = getDb(null)
    seeded
      .insert(NovelTable)
      .values({
        id: "n-reset",
        title: "重置回归",
        genre: "test",
        synopsis: "",
        status: "draft",
        created_at: 1,
        updated_at: 1,
      })
      .run()
    expect(seeded.select().from(NovelTable).all().length).toBe(1)

    await resetExerciseDatabase()

    expect(isSyncWorkerRunning()).toBe(false)
    await assertExerciseSchemaReady()
    expect(getDb(null).select().from(NovelTable).all().length).toBe(0)
  })

  test("canary 对缺 session 的库快速报错并可随重置恢复", async () => {
    const { closeDb, getDb } = await import("@opennovel-ai/novel-store")

    // 构造 novel-store 先行建库形态：原地清空并驱逐缓存后让 novel-store 单独建库（无 core session）
    closeDb(null)
    await clearExerciseDatabase()
    getDb(null)
    await expect(assertExerciseSchemaReady()).rejects.toThrow(/session/)

    await resetExerciseDatabase()
    await assertExerciseSchemaReady()
  })
})