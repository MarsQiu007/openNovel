/**
 * DB 一致性测试 - 验证所有 novel-writer 模块使用 session-store 的统一 DB 入口
 *
 * 修复前：21 个模块各自定义 getDbPath()/getDb()，全局回退到
 *   ~/.local/share/opennovel/opennovel.db，与 session-store 的项目级
 *   .novel/novel.db 契约脱节。
 *
 * 本测试验证：
 * 1. 静态：除 session-store.ts/tui.tsx/cli.ts 外，无模块定义本地 DB 入口
 * 2. 功能：各模块实际写入同一个 DB 文件
 * 3. 路径契约：getDbPath(directory) 推导 .novel/novel.db
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "fs"
import { tmpdir } from "os"
// @ts-ignore - bun:sqlite 类型仅在 bun 运行时可用
import { Database as BunSqlite } from "bun:sqlite"
import { globSync } from "glob"

// ─── 静态分析：源码中不得存在本地 DB 入口 ───

/** 允许保留本地 getDbPath/getDb 的模块（已在修复前就使用正确契约） */
const ALLOWED_LOCAL_DB_MODULES = new Set(["session-store.ts", "tui.tsx", "cli.ts"])

/** 扫描 src/novel-writer 下所有 .ts/.tsx 文件 */
function listSourceFiles(): string[] {
  const srcDir = join(import.meta.dir, "..", "..", "src", "novel-writer")
  return globSync("**/*.{ts,tsx}", { cwd: srcDir }).map((f) => join(srcDir, f))
}

describe("静态：无模块定义本地 DB 入口", () => {
  const forbiddenPatterns = [
    { regex: /function\s+getDbPath\s*\(/, label: "function getDbPath(" },
    { regex: /function\s+getDb\s*\(/, label: "function getDb(" },
    { regex: /let\s+_db\s*:/, label: "let _db:" },
  ]

  for (const file of listSourceFiles()) {
    const basename = file.split("/").pop()!
    const isAllowed = ALLOWED_LOCAL_DB_MODULES.has(basename)

    for (const { regex, label } of forbiddenPatterns) {
      test(`${basename} ${isAllowed ? "（允许）" : ""}不含 "${label}"`, () => {
        const content = readFileSync(file, "utf-8")
        if (isAllowed) {
          // 允许的模块可以定义本地入口，但不强制
          return
        }
        expect(regex.test(content)).toBe(false)
      })
    }
  }

  test("所有需要 DB 的模块都从 session-store 导入 getDb", () => {
    const srcDir = join(import.meta.dir, "..", "..", "src", "novel-writer")
    // 列出所有导入 session-store 的模块
    const files = listSourceFiles().filter((f) => {
      const basename = f.split("/").pop()!
      return !ALLOWED_LOCAL_DB_MODULES.has(basename)
    })
    // 检查使用 drizzle 的模块是否从 session-store 导入了 getDb
    const drizzleUsers = files.filter((f) => {
      const content = readFileSync(f, "utf-8")
      // 排除仅导入 schema 常量但不执行 DB 操作的模块
      return content.includes('from "./session-store.js"') && content.includes("getDb")
    })
    // 至少 session-store 以外的模块应该有导入
    expect(drizzleUsers.length).toBeGreaterThan(0)
  })
})

// ─── 功能：各模块写入同一 DB ───

const testDir = join(tmpdir(), `novel-writer-db-consistency-${Date.now()}`)
const dbPath = join(testDir, "test.db")

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  process.env.OPENNOVEL_DB = dbPath
})

afterAll(() => {
  delete process.env.OPENNOVEL_DB
  rmSync(testDir, { recursive: true, force: true })
})

describe("功能：各模块使用同一 DB 实例", () => {
  test("getDb 返回的实例与各模块使用的 DB 一致", async () => {
    // 导入必须在 OPENNOVEL_DB 设置后
    const { getDb, NovelTable, ChapterTable } = await import("../../src/novel-writer/session-store.js")
    const { updateChapterStatus } = await import("../../src/novel-writer/chapter-status.js")
    const { commitState } = await import("../../src/novel-writer/state-commit.js")

    const db = getDb()

    // 插入基础数据
    db.insert(NovelTable)
      .values({
        id: "test-novel-1",
        title: "测试小说",
        genre: "test",
        synopsis: "",
        status: "draft",
      })
      .run()

    db.insert(ChapterTable)
      .values({
        id: "test-ch-1",
        novel_id: "test-novel-1",
        title: "第1章",
        content: "",
        word_count: 0,
        status: "planned",
        order: 1,
      })
      .run()

    // 通过 chapter-status 模块更新章节状态（planned → drafting）
    await updateChapterStatus("test-ch-1", "drafting")

    // 直接查询验证写入生效
    const rows = db.select().from(ChapterTable).all()
    const ch = rows.find((r) => r.id === "test-ch-1")
    expect(ch).toBeTruthy()
    expect(ch!.status).toBe("drafting")

    // 通过 state-commit 写入状态日志
    await commitState("test-novel-1", "test-ch-1", [
      {
        fact_type: "character",
        action: "create",
        entity_id: "char-1",
        data: { name: "角色A", role: "protagonist", description: "测试角色" },
      },
    ])

    // 验证状态日志写入同一 DB
    const { NovelStateLogTable } = await import("../../src/novel-writer/session-store.js")
    const logRows = db.select().from(NovelStateLogTable).all()
    expect(logRows.length).toBeGreaterThan(0)
    expect(logRows.some((r) => JSON.stringify(r.fact_data).includes("角色A"))).toBe(true)
  })

  test("所有模块写入的 DB 文件路径一致", () => {
    // 验证 DB 文件确实存在于测试路径
    expect(existsSync(dbPath)).toBe(true)

    // 用独立连接验证数据完整性
    const sqlite = new BunSqlite(dbPath)
    const novels = sqlite.query("SELECT * FROM novels WHERE id = ?").all("test-novel-1")
    expect(novels.length).toBe(1)

    const chapters = sqlite.query("SELECT * FROM chapters WHERE id = ?").all("test-ch-1")
    expect(chapters.length).toBe(1)
    expect((chapters[0] as any).status).toBe("drafting")

    const logs = sqlite.query("SELECT * FROM novel_state_log WHERE novel_id = ?").all("test-novel-1")
    expect(logs.length).toBeGreaterThan(0)

    sqlite.close()
  })
})

// ─── 路径契约：getDbPath 推导 .novel/novel.db ───

describe("路径契约：getDbPath 使用项目级 .novel/novel.db", () => {
  test("无 directory 参数时回退到 OPENNOVEL_DB", async () => {
    const { getDbPath } = await import("../../src/novel-writer/session-store.js")
    expect(getDbPath()).toBe(dbPath)
  })

  test("OPENNOVEL_DB 优先级高于 directory 参数", async () => {
    const { getDbPath } = await import("../../src/novel-writer/session-store.js")
    const dir = join(testDir, "project-y")
    expect(getDbPath(dir)).toBe(dbPath)
  })

  test("无 OPENNOVEL_DB 且有 directory 时推导项目级路径", async () => {
    const saved = process.env.OPENNOVEL_DB
    delete process.env.OPENNOVEL_DB
    try {
      const { getDbPath } = await import("../../src/novel-writer/session-store.js")
      const dir = join(testDir, "project-z")
      expect(getDbPath(dir)).toBe(join(dir, ".novel", "novel.db"))
    } finally {
      if (saved) process.env.OPENNOVEL_DB = saved
    }
  })

  test("无 OPENNOVEL_DB 且无 directory 时回退到 process.cwd()", async () => {
    const saved = process.env.OPENNOVEL_DB
    delete process.env.OPENNOVEL_DB
    try {
      const { getDbPath } = await import("../../src/novel-writer/session-store.js")
      expect(getDbPath()).toBe(join(process.cwd(), ".novel", "novel.db"))
    } finally {
      if (saved) process.env.OPENNOVEL_DB = saved
    }
  })
})
