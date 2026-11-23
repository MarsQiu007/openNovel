/**
 * update_novel 工具测试
 *
 * 导入整理管线的简介生成阶段写入口（白名单 synopsis 单字段）：
 * 1. 已绑定会话更新简介成功，覆盖旧值
 * 2. 空白简介被拒绝且不改库
 * 3. 未绑定会话报错拒绝
 *
 * 使用真实 bun:sqlite 临时数据库（getDb 自动建表），不 mock 任何模块。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { getDb, getNovelForSession, NovelTable } from "../../src/novel-writer/session-store.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `update-novel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // getDb 连接缓存持有 DB 文件，Windows 下尽力清理即可
  }
})

function toolCtx(sessionID: string) {
  return createToolContext(projectDir, { sessionID })
}

async function createBoundBook(sessionID: string) {
  const tools = createWritingTools()
  await tools.init_novel.execute({ title: "剑来", genre: "仙侠", synopsis: "初始简介" }, toolCtx(sessionID))
  return (await getNovelForSession(sessionID, projectDir))!
}

function updateNovelTool() {
  return createWritingTools().update_novel
}

describe("update_novel 工具", () => {
  test("已绑定会话更新简介成功且覆盖旧值", async () => {
    const novelID = await createBoundBook("ses_bound")
    const result = await updateNovelTool().execute({ synopsis: "  少年陈平安仗剑走天涯，问心无愧。  " }, toolCtx("ses_bound"))
    const output = typeof result === "string" ? result : result.output
    expect(output).toContain("已更新书籍《剑来》的简介")

    const novel = await getDb(projectDir).select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    expect(novel?.synopsis).toBe("少年陈平安仗剑走天涯，问心无愧。")

    // 覆盖式：再次调用以新值替换
    await updateNovelTool().execute({ synopsis: "再生成简介" }, toolCtx("ses_bound"))
    const updated = await getDb(projectDir).select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    expect(updated?.synopsis).toBe("再生成简介")
    expect(updated?.updated_at).toBeGreaterThanOrEqual(novel!.updated_at)
  })

  test("空白简介被拒绝且不改库", async () => {
    const novelID = await createBoundBook("ses_bound")
    const err = await updateNovelTool()
      .execute({ synopsis: "   " }, toolCtx("ses_bound"))
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("param_error")

    const novel = await getDb(projectDir).select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    expect(novel?.synopsis).toBe("初始简介")
  })

  test("未绑定会话报错拒绝", async () => {
    const err = await updateNovelTool()
      .execute({ synopsis: "简介" }, toolCtx("ses_unbound"))
      .then(() => null, (e: Error) => e)
    expect(err?.name).toBe("param_error")
    expect(err?.message).toContain("未绑定书籍")
  })
})
