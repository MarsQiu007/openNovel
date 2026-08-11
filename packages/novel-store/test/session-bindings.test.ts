/**
 * listSessionNovelBindings 批量绑定查询测试
 *
 * 会话页侧边栏用该接口一次性构建书籍分组：
 * - 返回全部 (session_id, novel_id) 绑定及小说标题
 * - 已删除小说的悬空绑定不应出现（inner join 过滤）
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { getDb, tagNovelSession, listSessionNovelBindings, NovelTable } from "../src/index.js"
import { eq } from "drizzle-orm"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-bindings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  // getDb 的连接缓存会一直持有 DB 文件，Windows 下无法删除已打开的文件，尽力清理
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败，进程退出后系统会回收临时文件
  }
})

async function seedNovel(id: string, title: string) {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id, title, genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
}

describe("listSessionNovelBindings", () => {
  test("返回全部绑定及小说标题", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")
    await tagNovelSession("ses_a", "novel-1", projectDir)
    await tagNovelSession("ses_b", "novel-1", projectDir)
    await tagNovelSession("ses_c", "novel-2", projectDir)

    const bindings = await listSessionNovelBindings(projectDir)
    expect(bindings).toHaveLength(3)
    expect(bindings).toContainEqual({ sessionID: "ses_a", novelID: "novel-1", novelTitle: "第一本书" })
    expect(bindings).toContainEqual({ sessionID: "ses_b", novelID: "novel-1", novelTitle: "第一本书" })
    expect(bindings).toContainEqual({ sessionID: "ses_c", novelID: "novel-2", novelTitle: "第二本书" })
  })

  test("空库返回空数组", async () => {
    getDb(projectDir)
    expect(await listSessionNovelBindings(projectDir)).toEqual([])
  })

  test("小说被删除后悬空绑定不再返回", async () => {
    await seedNovel("novel-1", "将被删除的书")
    await tagNovelSession("ses_a", "novel-1", projectDir)
    expect(await listSessionNovelBindings(projectDir)).toHaveLength(1)

    const db = getDb(projectDir)
    await db.delete(NovelTable).where(eq(NovelTable.id, "novel-1")).run()
    expect(await listSessionNovelBindings(projectDir)).toEqual([])
  })
})
