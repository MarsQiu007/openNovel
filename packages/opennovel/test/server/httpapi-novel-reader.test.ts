import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NovelTable, StyleGuideTable, closeDb, getDb } from "@opennovel-ai/plugin/novel-writer/session-store"
import { Server } from "../../src/server/server"
import { disposeAllInstances } from "../fixture/fixture"

// test preload 把 OPENNOVEL_DB 钉为 ":memory:"，阅读器路由按文件库路径读取，
// 因此本文件改用临时文件库，用后关闭连接并还原环境变量。
let projectDir: string
const originalDb = process.env.OPENNOVEL_DB

beforeEach(() => {
  projectDir = join(tmpdir(), `novel-reader-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  process.env.OPENNOVEL_DB = join(projectDir, ".novel", "novel.db")
})

afterEach(async () => {
  await disposeAllInstances().catch(() => undefined)
  closeDb()
  if (originalDb === undefined) delete process.env.OPENNOVEL_DB
  else process.env.OPENNOVEL_DB = originalDb
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 SQLite 句柄可能短暂持有文件
  }
})

describe("HttpApi novel reader", () => {
  test("style 接口将历史嵌套与数组 rules 归一化为扁平映射", async () => {
    const db = getDb(projectDir)
    const novelId = crypto.randomUUID()
    const now = Date.now()
    db.insert(NovelTable)
      .values({
        id: novelId,
        title: "风格测试",
        genre: "玄幻",
        synopsis: "",
        created_at: now,
        updated_at: now,
        status: "draft",
      })
      .run()
    db.insert(StyleGuideTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        rules: { 异能体系: { 等级严格: "三级" }, 禁用手法: ["总结式收尾"] },
        tone: "冷峻",
        pov: "第三人称",
        tense: "过去时",
      })
      .run()

    const response = await Server.Default().app.request(`/api/novels/${novelId}/style`, {
      headers: { "x-opennovel-directory": projectDir },
    })
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: { rules: Record<string, string>; tone: string; pov: string; tense: string }
    }
    expect(body.data.rules).toEqual({
      "异能体系.等级严格": "三级",
      "禁用手法.0": "总结式收尾",
    })
    expect(body.data.tone).toBe("冷峻")
    expect(body.data.pov).toBe("第三人称")
    expect(body.data.tense).toBe("过去时")
    expect(JSON.stringify(body.data.rules)).not.toContain("[object Object]")
  })
})
