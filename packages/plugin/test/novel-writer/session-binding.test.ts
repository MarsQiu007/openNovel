/**
 * 会话归属继承（subagent-session-binding D2）novel-writer 工具接通测试。
 *
 * 场景：多书项目（两本书，避免「恰好一本小说」懒绑定短路）中，子代理会话自身
 * 没有 session_novel 绑定行，仅父会话持有绑定。以桩化父链访问器验证工具层：
 * 1. 未绑定子代理经父链继承归属后工具解析成功，且继承被幂等持久化到子会话；
 * 2. 父链无绑定祖先时工具返回「未找到当前小说项目」，不误绑多书目录；
 * 3. 父链访问器不可达（session.get 失败）时工具降级为未找到且不抛错。
 */
import { eq } from "drizzle-orm"
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { createOpenNovelClient } from "@opennovel-ai/sdk/v2/client"
import { NovelWriterPlugin } from "../../src/novel-writer.js"
import {
  getDb,
  NovelTable,
  SessionNovelTable,
  StoryArcTable,
  getNovelForSession,
  tagNovelSession,
} from "../../src/novel-writer/session-store.js"
import type { ToolContext, ToolResult } from "../../src/tool.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

const PARENT_SESSION_ID = "ses-parent-binding"
const CHILD_SESSION_ID = "ses-child-binding"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `session-binding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

/** 多书目录：存在两本书时 resolveNovelForSession 不会触发单书懒绑定，必须走父链。 */
async function seedMultiBookProject() {
  const db = getDb(projectDir)
  await db.insert(NovelTable).values({ id: "novel-a", title: "A书", genre: "玄幻", created_at: 1, updated_at: 1 }).run()
  await db.insert(NovelTable).values({ id: "novel-b", title: "B书", genre: "科幻", created_at: 1, updated_at: 1 }).run()
}

function toolCtx(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg_binding",
    agent: "writer",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

/**
 * 桩化父链访问器：以真实 v2 客户端 + 自定义 fetch 拦截 GET /session/{id}，
 * 按给定 parentID 链返回会话数据，并记录被查询的会话 ID。
 */
function parentChainFetch(chain: Record<string, string | undefined>, requested: string[]): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
      const sessionID = decodeURIComponent(url.pathname.replace(/^\/session\//, ""))
      requested.push(sessionID)
      return Response.json({ id: sessionID, parentID: chain[sessionID] })
    },
    { preconnect: () => {} },
  )
}

function outputOf(result: ToolResult): string {
  return typeof result === "string" ? result : result.output
}

describe("novel-writer 会话归属继承", () => {
  test("未绑定子代理经父链继承归属后工具解析成功，继承幂等持久化", async () => {
    await seedMultiBookProject()
    await tagNovelSession(PARENT_SESSION_ID, "novel-b", projectDir)
    await getDb(projectDir)
      .insert(StoryArcTable)
      .values({ id: "arc-b", novel_id: "novel-b", arc_type: "narrative", title: "B书主线", status: "active" })
      .run()

    const requested: string[] = []
    const clientV2 = createOpenNovelClient({
      baseUrl: "http://localhost:1",
      fetch: parentChainFetch({ [CHILD_SESSION_ID]: PARENT_SESSION_ID }, requested),
    })
    const hooks = await NovelWriterPlugin({ ...createPluginInput(projectDir), clientV2 })

    expect(await getNovelForSession(CHILD_SESSION_ID, projectDir)).toBeUndefined()

    const result = await hooks.tool!.list_story_arcs!.execute({}, toolCtx(CHILD_SESSION_ID))

    // 工具解析到父会话绑定的 B 书：返回 B 书结构线，而非「未找到当前小说项目」
    expect(outputOf(result)).toContain("B书主线")
    expect(await getNovelForSession(CHILD_SESSION_ID, projectDir)).toBe("novel-b")
    const rows = await getDb(projectDir)
      .select({ id: SessionNovelTable.id })
      .from(SessionNovelTable)
      .where(eq(SessionNovelTable.session_id, CHILD_SESSION_ID))
      .all()
    expect(rows.length).toBe(1)
    expect(requested).toEqual([CHILD_SESSION_ID])

    // 再次调用：继承已持久化为自身绑定，直接命中且不再查询父链
    const second = await hooks.tool!.list_story_arcs!.execute({}, toolCtx(CHILD_SESSION_ID))
    expect(outputOf(second)).toContain("B书主线")
    expect(requested).toEqual([CHILD_SESSION_ID])
  })

  test("父链无绑定祖先时工具返回未找到，不误绑多书目录", async () => {
    await seedMultiBookProject()

    const clientV2 = createOpenNovelClient({
      baseUrl: "http://localhost:1",
      fetch: parentChainFetch({}, []),
    })
    const hooks = await NovelWriterPlugin({ ...createPluginInput(projectDir), clientV2 })

    const result = await hooks.tool!.list_story_arcs!.execute({}, toolCtx(CHILD_SESSION_ID))

    expect(outputOf(result)).toBe("未找到当前小说项目")
    expect(await getNovelForSession(CHILD_SESSION_ID, projectDir)).toBeUndefined()
  })

  test("父链访问器不可达时工具降级为未找到且不抛错", async () => {
    await seedMultiBookProject()

    // 默认 PluginInput 的 clientV2 指向 discard 端口，session.get 必然失败
    const hooks = await NovelWriterPlugin(createPluginInput(projectDir))

    const result = await hooks.tool!.list_story_arcs!.execute({}, toolCtx(CHILD_SESSION_ID))

    expect(outputOf(result)).toBe("未找到当前小说项目")
    expect(await getNovelForSession(CHILD_SESSION_ID, projectDir)).toBeUndefined()
  })
})