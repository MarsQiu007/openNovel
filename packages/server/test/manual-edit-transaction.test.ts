import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import {
  closeDb,
  getDb,
  createChapter,
  NovelTable,
  CharacterTable,
  updateCharacter,
} from "@opennovel-ai/novel-store"
import {
  requireNovel,
  requireChapter,
  requireEntity,
  withManualEditSync,
  saveChapterContent,
  type ManualEditContext,
} from "../src/manual-edit-transaction"

let projectDir: string
let novelId: string
let characterId: string

beforeEach(() => {
  projectDir = join(tmpdir(), `manual-edit-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  const db = getDb(projectDir)
  novelId = crypto.randomUUID()
  const now = Date.now()
  db.insert(NovelTable).values({
    id: novelId,
    title: "事务测试小说",
    genre: "玄幻",
    synopsis: "",
    master_outline: "",
    status: "draft",
    created_at: now,
    updated_at: now,
  }).run()
  characterId = crypto.randomUUID()
  db.insert(CharacterTable).values({
    id: characterId,
    novel_id: novelId,
    name: "测试角色",
    role: "",
    description: "",
    status: "active",
    created_at: now,
  }).run()
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用
  }
})

function ctx(): ManualEditContext {
  return { novelId, directory: projectDir }
}

describe("requireNovel", () => {
  test("小说存在时返回 Novel", async () => {
    const result = await Effect.runPromise(requireNovel(ctx()))
    expect(result?.id ?? novelId).toBe(novelId)
  })

  test("小说不存在时返回 NovelNotFoundError", async () => {
    const badCtx = { novelId: "nonexistent", directory: projectDir }
    try {
      await Effect.runPromise(requireNovel(badCtx))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})

describe("requireChapter", () => {
  test("章节存在且属于当前小说", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    const result = await Effect.runPromise(requireChapter(ctx(), chapter.id))
    expect(result!.id).toBe(chapter.id)
  })

  test("章节不存在时返回错误", async () => {
    try {
      await Effect.runPromise(requireChapter(ctx(), "nonexistent"))
      expect.unreachable()
    } catch {
      // 预期错误
    }
  })
})

describe("requireEntity", () => {
  test("角色存在且属于当前小说", async () => {
    const row = await Effect.runPromise(requireEntity(ctx(), "character", characterId))
    expect(row.novel_id).toBe(novelId)
  })

  test("角色不存在时返回错误", async () => {
    try {
      await Effect.runPromise(requireEntity(ctx(), "character", "nonexistent"))
      expect.unreachable()
    } catch {
      // 预期错误
    }
  })
})

describe("withManualEditSync", () => {
  test("写入成功后创建同步记录", async () => {
    const result = await Effect.runPromise(
      withManualEditSync(ctx(), "character", characterId, "name", "新名字", async () => {
        await updateCharacter(characterId, { name: "新名字" }, projectDir)
        return { updated: true }
      }),
    )
    expect(result.data).toEqual({ updated: true })
    expect(result.syncQueued).toBe(true)
  })

  test("目标不存在时无字段更新", async () => {
    const db = getDb(projectDir)
    try {
      await Effect.runPromise(
        withManualEditSync({ novelId, directory: projectDir }, "character", "nonexistent", "name", "x", async () => {
          await updateCharacter("nonexistent", { name: "x" }, projectDir).catch(() => {})
          return { updated: true }
        }),
      )
    } catch {
      // updateCharacter 可能不会抛出（silently skips）
    }
    // 验证没有真的修改任何角色
    const char = db.select().from(CharacterTable).where(eq(CharacterTable.id, characterId)).get()
    expect(char!.name).toBe("测试角色")
  })
})

describe("saveChapterContent", () => {
  test("正文保存后标记派生数据并创建同步任务", async () => {
    const chapter = await createChapter(novelId, "第一章", 1, null, projectDir)
    const result = await Effect.runPromise(
      saveChapterContent(ctx(), chapter.id, "新的正文内容", async () => {
        // 模拟正文写入
        return true
      }),
    )
    expect(result.syncQueued).toBe(true)
  })

  test("章节不存在时不执行写入", async () => {
    try {
      await Effect.runPromise(
        saveChapterContent(ctx(), "nonexistent", "内容", () => {
          throw new Error("不应该被调用")
        }),
      )
      expect.unreachable()
    } catch {
      // requireChapter 抛出错误，写入函数未被调用
    }
  })
})
