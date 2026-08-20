import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, createWorldEntry, getDb, NovelTable } from "@opennovel-ai/novel-store"
import { assembleSnapshot } from "../../src/novel-writer/context.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `novel-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件句柄释放有延迟，尽力清理即可
  }
})

async function seedNovel(novelId: string) {
  const db = getDb(dir)
  await db.insert(NovelTable).values({ id: novelId, title: "测试", genre: "科幻", synopsis: "" }).run()
}

describe("assembleSnapshot 世界观导览", () => {
  test("快照包含世界观条目的分类与标题", async () => {
    await seedNovel("novel-1")
    await createWorldEntry("novel-1", "地理", "风息城", "正文", dir)
    await createWorldEntry("novel-1", "势力", "旧议会", "正文", dir)

    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.worldEntries).toEqual([
      { category: "地理", title: "风息城" },
      { category: "势力", title: "旧议会" },
    ])
  })

  test("无世界观条目时 worldEntries 为空数组", async () => {
    await seedNovel("novel-1")
    const snapshot = await assembleSnapshot("novel-1", 0, dir)
    expect(snapshot!.worldEntries).toEqual([])
  })
})
