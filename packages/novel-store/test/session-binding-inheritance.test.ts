/**
 * resolveNovelForSessionWithInheritance 归属继承测试（subagent-session-binding）
 *
 * 覆盖：父链命中继承并持久化（幂等不重复插入）、孙级链、最近祖先优先、
 * 多书目录不误绑、单书懒绑定先于链查询、链断无归属、parentID 环防护、
 * 父链访问器抛错降级、未提供访问器时与自身解析一致。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import {
  getDb,
  tagNovelSession,
  resolveNovelForSessionWithInheritance,
  NovelTable,
  SessionNovelTable,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-inherit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  // getDb 连接缓存持有 DB 文件，Windows 下尽力清理
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // 忽略清理失败
  }
})

async function seedNovel(id: string, title: string) {
  const db = getDb(projectDir)
  await db
    .insert(NovelTable)
    .values({ id, title, genre: "玄幻", synopsis: "", status: "draft", created_at: 1, updated_at: 1 })
    .run()
}

async function bindingsOf(sessionID: string) {
  const db = getDb(projectDir)
  return db.select().from(SessionNovelTable).where(eq(SessionNovelTable.session_id, sessionID)).all()
}

function parentOf(links: Record<string, string | undefined>, onCall?: () => void) {
  return async (sessionID: string) => {
    onCall?.()
    return links[sessionID]
  }
}

describe("resolveNovelForSessionWithInheritance", () => {
  test("父链命中后继承并持久化，重复调用不重复插入", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")
    await tagNovelSession("ses_parent", "novel-1", projectDir)

    const links = { ses_child: "ses_parent" }
    const first = await resolveNovelForSessionWithInheritance("ses_child", projectDir, parentOf(links))
    expect(first).toBe("novel-1")
    expect(await bindingsOf("ses_child")).toHaveLength(1)

    // 第二次调用直接命中已持久化的自身绑定，不重复插入
    const second = await resolveNovelForSessionWithInheritance("ses_child", projectDir, parentOf(links))
    expect(second).toBe("novel-1")
    expect(await bindingsOf("ses_child")).toHaveLength(1)
  })

  test("孙级会话沿链继承根祖先绑定", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")
    await tagNovelSession("ses_grand", "novel-2", projectDir)

    const links = { ses_child: "ses_parent", ses_parent: "ses_grand" }
    expect(await resolveNovelForSessionWithInheritance("ses_child", projectDir, parentOf(links))).toBe("novel-2")
    expect(await bindingsOf("ses_child")).toHaveLength(1)
  })

  test("最近绑定祖先优先于更远的祖先", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")
    await tagNovelSession("ses_parent", "novel-2", projectDir)
    await tagNovelSession("ses_grand", "novel-1", projectDir)

    const links = { ses_child: "ses_parent", ses_parent: "ses_grand" }
    expect(await resolveNovelForSessionWithInheritance("ses_child", projectDir, parentOf(links))).toBe("novel-2")
  })

  test("多书目录且链上无绑定时不误绑", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")

    const links = { ses_child: "ses_parent" }
    expect(await resolveNovelForSessionWithInheritance("ses_child", projectDir, parentOf(links))).toBeUndefined()
    expect(await bindingsOf("ses_child")).toHaveLength(0)
  })

  test("单书懒绑定先于链查询，不触发父链访问", async () => {
    await seedNovel("novel-1", "唯一一本书")
    let calls = 0

    const result = await resolveNovelForSessionWithInheritance(
      "ses_child",
      projectDir,
      parentOf({ ses_child: "ses_parent" }, () => calls++),
    )
    expect(result).toBe("novel-1")
    expect(calls).toBe(0)
  })

  test("链断（祖先均无绑定）返回无归属", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")

    const links = { ses_child: "ses_parent" }
    expect(await resolveNovelForSessionWithInheritance("ses_child", projectDir, parentOf(links))).toBeUndefined()
  })

  test("parentID 环不死循环，按无归属返回", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")

    const links = { ses_a: "ses_b", ses_b: "ses_a" }
    expect(await resolveNovelForSessionWithInheritance("ses_a", projectDir, parentOf(links))).toBeUndefined()
  })

  test("父链访问器抛错时降级为无归属，不向调用方抛错", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")

    let calls = 0
    const flaky = async (sessionID: string): Promise<string | undefined> => {
      calls++
      if (calls === 1) return "ses_parent"
      throw new Error("session lookup failed")
    }
    expect(await resolveNovelForSessionWithInheritance("ses_child", projectDir, flaky)).toBeUndefined()
  })

  test("未提供父链访问器时与自身解析一致", async () => {
    await seedNovel("novel-1", "第一本书")
    await seedNovel("novel-2", "第二本书")

    expect(await resolveNovelForSessionWithInheritance("ses_lonely", projectDir)).toBeUndefined()
    await tagNovelSession("ses_lonely", "novel-1", projectDir)
    expect(await resolveNovelForSessionWithInheritance("ses_lonely", projectDir)).toBe("novel-1")
  })
})