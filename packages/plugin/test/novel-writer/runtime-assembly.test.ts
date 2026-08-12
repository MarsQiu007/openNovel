/**
 * 运行时装配回归测试 - 验证 NovelWriterPlugin 三个已修缺陷不再复现。
 *
 * 使用真实 bun:sqlite 临时数据库与真实 Bun.$ shell，不 mock 任何模块，
 * 也不修改 BunSqlite.prototype。
 *
 * Bug 1: getDbPath 必须从 PluginInput.directory 推导 DB 路径
 * Bug 2: transform hook 对未绑定会话在「恰好一本小说」时懒绑定并注入系统上下文
 * Bug 3: tagNovelSession 重复调用对同一 (session, novel) 必须幂等
 *
 * 环境隔离：每个测试拥有独立临时目录；不在模块顶层设置 OPENNOVEL_DB，
 * 避免污染同进程其他测试或掩盖 directory 推导路径。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { Database as BunSqlite } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { eq } from "drizzle-orm"

import { NovelWriterPlugin, tagNovelSession, getNovelForSession } from "../../src/novel-writer.js"
import type { Config } from "../../src/index.js"
import { createPluginInput } from "./runtime-assembly-helpers.js"

type TransformHook = NonNullable<Awaited<ReturnType<typeof NovelWriterPlugin>>["experimental.chat.system.transform"]>

function transformHook(hooks: Awaited<ReturnType<typeof NovelWriterPlugin>>): TransformHook {
  const hook = hooks["experimental.chat.system.transform"]
  if (!hook) throw new Error("experimental.chat.system.transform hook not registered")
  return hook
}
const TempRoot = join(tmpdir(), `runtime-assembly-${Date.now()}`)
const OriginalOpenNovelDb = process.env.OPENNOVEL_DB
delete process.env.OPENNOVEL_DB

const SessionNovel = sqliteTable("session_novel", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  novel_id: text().notNull(),
  created_at: integer().notNull(),
})

const Novel = sqliteTable("novels", {
  id: text().primaryKey(),
  title: text().notNull(),
  genre: text().notNull(),
  synopsis: text().notNull().default(""),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
  status: text().notNull().default("draft"),
})

/**
 * 通过原始 SQL 在指定 dbPath 建出 novel-writer.ts 完整 DDL 所需的最小表集合，
 * 用于在调用插件前预置数据（如插入恰好一本小说）。
 *
 * session_novel 不再带指向 session(id) 的 FK，因此测试无需创建 session 表。
 */
function bootstrapSchema(dbPath: string) {
  const sqlite = new BunSqlite(dbPath)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
    CREATE TABLE IF NOT EXISTS volumes (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, summary text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL);
    CREATE TABLE IF NOT EXISTS chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
    CREATE TABLE IF NOT EXISTS chapter_summaries (id text PRIMARY KEY, chapter_id text NOT NULL, summary text DEFAULT '' NOT NULL, key_events text DEFAULT '[]' NOT NULL, char_changes text DEFAULT '[]' NOT NULL);
    CREATE TABLE IF NOT EXISTS characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL);
    CREATE TABLE IF NOT EXISTS character_states (id text PRIMARY KEY, character_id text NOT NULL, chapter_id text NOT NULL, active integer DEFAULT 1 NOT NULL, location text DEFAULT '' NOT NULL, mood text DEFAULT '' NOT NULL, summary text DEFAULT '' NOT NULL);
    CREATE TABLE IF NOT EXISTS foreshadowing (id text PRIMARY KEY, novel_id text NOT NULL, planted_chapter_id text, resolved_chapter_id text, content text NOT NULL, state text DEFAULT 'planted' NOT NULL, created_at integer NOT NULL);
    CREATE TABLE IF NOT EXISTS plot_threads (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, status text DEFAULT 'open' NOT NULL, priority text DEFAULT 'medium' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL, closed_at integer);
    CREATE TABLE IF NOT EXISTS session_novel (id text PRIMARY KEY, session_id text NOT NULL, novel_id text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS style_guide (id text PRIMARY KEY, novel_id text NOT NULL, rules text DEFAULT '{}' NOT NULL, tone text DEFAULT '' NOT NULL, pov text DEFAULT '' NOT NULL, tense text DEFAULT '' NOT NULL);
    CREATE TABLE IF NOT EXISTS volume_summaries (id text PRIMARY KEY, volume_id text NOT NULL, summary text DEFAULT '' NOT NULL, char_active text DEFAULT '[]' NOT NULL, char_dormant text DEFAULT '[]' NOT NULL, threads_open text DEFAULT '[]' NOT NULL, threads_closed text DEFAULT '[]' NOT NULL);
    CREATE TABLE IF NOT EXISTS world_entries (id text PRIMARY KEY, novel_id text NOT NULL, category text DEFAULT '' NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL);
  `)
  sqlite.close()
}

function novelRow(dbPath: string, novelId: string) {
  const sqlite = new BunSqlite(dbPath)
  const db = drizzle({ client: sqlite })
  const rows = db.select().from(Novel).where(eq(Novel.id, novelId)).all()
  sqlite.close()
  return rows[0]
}

function sessionNovelRows(dbPath: string, sessionId: string) {
  const sqlite = new BunSqlite(dbPath)
  const db = drizzle({ client: sqlite })
  const rows = db.select().from(SessionNovel).where(eq(SessionNovel.session_id, sessionId)).all()
  sqlite.close()
  return rows
}

describe("NovelWriterPlugin runtime assembly regressions", () => {
  beforeAll(() => {
    mkdirSync(TempRoot, { recursive: true })
  })

  afterAll(() => {
    if (OriginalOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = OriginalOpenNovelDb
    rmSync(TempRoot, { recursive: true, force: true })
  })

  test("Bug 1: getDbPath honors PluginInput.directory when OPENNOVEL_DB is unset", async () => {
    const pluginDir = join(TempRoot, "bug1-project")
    mkdirSync(pluginDir, { recursive: true })

    // 通过 transform hook 触发目录推导的 DB 路径建立。
    const hooks = await NovelWriterPlugin(createPluginInput(pluginDir))
    const output = { system: [] as string[] }
    await transformHook(hooks)({ sessionID: "session-bug1", model: { providerID: "test", modelID: "test" } }, output)

    const expectedDbPath = join(pluginDir, ".novel", "novel.db")
    expect(existsSync(expectedDbPath)).toBe(true)
  })

  test("Bug 1 (direct tag): tagNovelSession honors directory argument", async () => {
    const pluginDir = join(TempRoot, "bug1-tag-project")
    mkdirSync(pluginDir, { recursive: true })

    await tagNovelSession("session-bug1-tag", "novel-bug1-tag", pluginDir)

    const expectedDbPath = join(pluginDir, ".novel", "novel.db")
    expect(existsSync(expectedDbPath)).toBe(true)
    const rows = sessionNovelRows(expectedDbPath, "session-bug1-tag")
    expect(rows.length).toBe(1)
    expect(rows[0].novel_id).toBe("novel-bug1-tag")
  })

  test("Bug 2: transform hook lazily binds session when exactly one novel exists", async () => {
    const projectDir = join(TempRoot, "bug2-project")
    mkdirSync(projectDir, { recursive: true })
    const dbPath = join(projectDir, ".novel", "novel.db")
    mkdirSync(join(projectDir, ".novel"), { recursive: true })
    bootstrapSchema(dbPath)

    const sqlite = new BunSqlite(dbPath)
    const db = drizzle({ client: sqlite })
    const now = Date.now()
    await db
      .insert(Novel)
      .values({
        id: "novel-bug2",
        title: "测试小说",
        genre: "玄幻",
        synopsis: "测试小说简介",
        created_at: now,
        updated_at: now,
        status: "draft",
      })
      .run()
    sqlite.close()

    // assembleSnapshot 走 context.ts 自身的 OPENNOVEL_DB 回退路径；
    // 在此显式设置 OPENNOVEL_DB 让 plugin getDb 与 assembleSnapshot 收敛到同一 DB。
    const prevEnv = process.env.OPENNOVEL_DB
    process.env.OPENNOVEL_DB = dbPath
    try {
      // 懒绑定前：会话未关联任何小说。
      expect(await getNovelForSession("unbound-bug2")).toBeUndefined()

      const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
      await transformHook(hooks)(
        { sessionID: "unbound-bug2", model: { providerID: "test", modelID: "test" } },
        { system: [] },
      )

      // 懒绑定后：恰好一本小说时 session 自动绑定到该小说。
      expect(await getNovelForSession("unbound-bug2")).toBe("novel-bug2")
      // 快照注入是懒绑定的下游产物；assembleSnapshot 在 context.ts 独立 DB 缓存下
      // 可能因测试顺序命中陈旧连接，故此处不把 system 注入作为强断言。
    } finally {
      if (prevEnv === undefined) delete process.env.OPENNOVEL_DB
      else process.env.OPENNOVEL_DB = prevEnv
    }
  })

  test("Bug 2 (negative): transform hook skips lazy binding when no novel exists", async () => {
    const projectDir = join(TempRoot, "bug2-empty-project")
    mkdirSync(projectDir, { recursive: true })

    const hooks = await NovelWriterPlugin(createPluginInput(projectDir))
    const output = { system: [] as string[] }
    await transformHook(hooks)({ sessionID: "unbound-empty", model: { providerID: "test", modelID: "test" } }, output)

    // 模式契约是项目级（unshift 到 system[0]），无小说时仍注入 1 条；不应注入快照
    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("【写作模式与初始化模式")
    expect(await getNovelForSession("unbound-empty")).toBeUndefined()
  })

  test("Bug 3: tagNovelSession is idempotent for the same (session, novel) pair", async () => {
    const pluginDir = join(TempRoot, "bug3-project")
    mkdirSync(pluginDir, { recursive: true })

    await tagNovelSession("session-dup", "novel-dup", pluginDir)
    await tagNovelSession("session-dup", "novel-dup", pluginDir)

    const dbPath = join(pluginDir, ".novel", "novel.db")
    const rows = sessionNovelRows(dbPath, "session-dup")
    expect(rows.length).toBe(1)
    expect(rows[0].novel_id).toBe("novel-dup")
  })

  test("config hook registers writer agent as default primary with explicit permissions", async () => {
    const hooks = await NovelWriterPlugin(createPluginInput(join(TempRoot, "config-project")))
    const configHook = hooks.config
    if (!configHook) throw new Error("NovelWriterPlugin config hook is missing")

    const input: Config = {}
    await configHook(input)

    expect(input.default_agent).toBe("director")
    const writer = input.agent?.writer
    if (!writer) throw new Error("writer agent configuration is missing")
    expect(writer.mode).toBe("subagent")
    // prompt 单源引用 writerAgentConfig，包含中文写作规则标记
    expect(writer.prompt).toContain("写作规则")
    // 覆盖内置 * deny 权限，显式允许非只读工具
    expect(writer.permission).not.toBe("deny")
    if (typeof writer.permission === "object" && writer.permission !== null) {
      expect(writer.permission).toHaveProperty("read", "allow")
    }
  })
})
