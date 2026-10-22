/**
 * init_novel 工具测试
 *
 * 全局对话（未绑定书籍的会话）初始化书籍能力：
 * 1. 创建 novels 记录并自动绑定当前会话（全局对话就地转为书籍主会话）
 * 2. 已绑定会话重复调用返回已有绑定，不重复创建
 * 3. 非法类型被拒绝
 *
 * 使用真实 bun:sqlite 临时数据库（getDb 自动建表），不 mock 任何模块。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { getDb, getNovelForSession, NovelTable } from "../../src/novel-writer/session-store.js"
import { createWritingTools, createToolContext } from "./runtime-assembly-helpers.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `init-novel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function initNovelTool() {
  return createWritingTools().init_novel
}

describe("init_novel 工具", () => {
  test("创建书籍并自动绑定当前会话", async () => {
    const initNovel = initNovelTool()
    const result = await initNovel.execute({ title: "剑来", genre: "仙侠", synopsis: "少年仗剑走天涯" }, toolCtx("ses_global"))
    expect(result).toMatchObject({ title: "init_novel" })
    const output = typeof result === "string" ? result : result.output
    expect(output).toContain("已创建书籍《剑来》")

    // 绑定生效：全局对话就地成为书籍主会话
    const boundID = await getNovelForSession("ses_global", projectDir)
    expect(boundID).toBeDefined()

    const novel = await getDb(projectDir).select().from(NovelTable).all()
    expect(novel).toHaveLength(1)
    expect(novel[0].id).toBe(boundID)
    expect(novel[0].genre).toBe("仙侠")
  })

  test("已绑定会话重复调用不重复创建", async () => {
    const initNovel = initNovelTool()
    await initNovel.execute({ title: "剑来", genre: "仙侠", synopsis: "" }, toolCtx("ses_global"))
    const second = await initNovel.execute({ title: "另一本书", genre: "都市", synopsis: "" }, toolCtx("ses_global"))
    const output = typeof second === "string" ? second : second.output
    expect(output).toContain("已绑定书籍《剑来》")

    const novels = await getDb(projectDir).select().from(NovelTable).all()
    expect(novels).toHaveLength(1)
  })

  test("非法类型被拒绝且不创建记录", async () => {
    const initNovel = initNovelTool()
    const result = await initNovel.execute({ title: "坏书", genre: "魔幻", synopsis: "" }, toolCtx("ses_global"))
    const output = typeof result === "string" ? result : result.output
    expect(output).toContain("不合法")

    expect(await getDb(projectDir).select().from(NovelTable).all()).toHaveLength(0)
    expect(await getNovelForSession("ses_global", projectDir)).toBeUndefined()
  })
})
