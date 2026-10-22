/**
 * 运行时装配回归测试 - 验证三个已修缺陷在 V2 装配路径下不再复现。
 *
 * 使用真实 bun:sqlite 临时数据库，不 mock 任何模块。
 *
 * Bug 1: DB 路径必须从项目 directory 推导（V1 经 PluginInput.directory，V2 经
 *        session-store/解析器的 directory 参数）
 * Bug 2: 会话归属解析对未绑定会话在「恰好一本小说」时懒绑定（V1 在 transform hook
 *        内触发，V2 由 resolveSessionNovel → novel-store 继承解析承担）
 * Bug 3: tagNovelSession 重复调用对同一 (session, novel) 必须幂等
 *
 * 环境隔离：每个测试拥有独立临时目录；不在模块顶层设置 OPENNOVEL_DB，
 * 避免污染同进程其他测试或掩盖 directory 推导路径。
 */

import { installFreshGlobalDb } from "./technique-test-env.js"

installFreshGlobalDb()

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readdirSync } from "fs"
import { closeDb } from "@opennovel-ai/novel-store"
import { tmpdir } from "os"
import { Database as BunSqlite } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { eq } from "drizzle-orm"
import { Effect, Option } from "effect"

import { tagNovelSession, getNovelForSession } from "../../src/novel-writer/session-store.js"
import { resolveSessionNovel } from "../../src/novel-writer/tools/session-novel.js"
import { createNovelContextSource } from "../../src/novel-writer/context-source.js"
import type { SessionDomain } from "../../src/v2/effect/session.js"

// 无父链的 SessionDomain 桩：这些用例只验证自身绑定/单书懒绑定路径
const noParentSession: SessionDomain = { get: async () => undefined }

const TempRoot = join(tmpdir(), `runtime-assembly-${Date.now()}`)
let prevOpenNovelDb: string | undefined

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
 * 通过原始 SQL 在指定 dbPath 建出完整 DDL 所需的最小表集合，
 * 用于在调用解析器前预置数据（如插入恰好一本小说）。
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

function sessionNovelRows(dbPath: string, sessionId: string) {
  const sqlite = new BunSqlite(dbPath)
  const db = drizzle({ client: sqlite })
  const rows = db.select().from(SessionNovel).where(eq(SessionNovel.session_id, sessionId)).all()
  sqlite.close()
  return rows
}

function seedNovel(dbPath: string, novelId: string) {
  mkdirSync(join(dbPath, ".."), { recursive: true })
  bootstrapSchema(dbPath)

  const sqlite = new BunSqlite(dbPath)
  const db = drizzle({ client: sqlite })
  const now = Date.now()
  db.insert(Novel)
    .values({
      id: novelId,
      title: `测试小说 ${novelId}`,
      genre: "玄幻",
      synopsis: "用于会话绑定测试",
      created_at: now,
      updated_at: now,
      status: "draft",
    })
    .run()
  sqlite.close()
}

describe("novel-writer runtime assembly regressions (V2)", () => {
  beforeAll(() => {
    prevOpenNovelDb = process.env.OPENNOVEL_DB
    delete process.env.OPENNOVEL_DB
    mkdirSync(TempRoot, { recursive: true })
  })

  afterAll(() => {
    if (prevOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = prevOpenNovelDb
    for (const entry of readdirSync(TempRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) closeDb(join(TempRoot, entry.name))
    }
    try { rmSync(TempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
  })

  test("Bug 1: session store honors directory argument when OPENNOVEL_DB is unset", async () => {
    const pluginDir = join(TempRoot, "bug1-project")
    mkdirSync(pluginDir, { recursive: true })

    // 读取未绑定会话即触发目录推导的 DB 路径建立。
    expect(await getNovelForSession("session-bug1", pluginDir)).toBeUndefined()

    const expectedDbPath = join(pluginDir, ".novel", "novel.db")
    expect(existsSync(expectedDbPath)).toBe(true)
  })

  test("Bug 1 (direct tag): tagNovelSession honors directory argument", async () => {
    const pluginDir = join(TempRoot, "bug1-tag-project")
    mkdirSync(pluginDir, { recursive: true })

    const expectedDbPath = join(pluginDir, ".novel", "novel.db")
    seedNovel(expectedDbPath, "novel-bug1-tag")
    await tagNovelSession("session-bug1-tag", "novel-bug1-tag", pluginDir)
    expect(existsSync(expectedDbPath)).toBe(true)
    const rows = sessionNovelRows(expectedDbPath, "session-bug1-tag")
    expect(rows.length).toBe(1)
    expect(rows[0].novel_id).toBe("novel-bug1-tag")
  })

  test("Bug 2: resolveSessionNovel lazily binds session when exactly one novel exists", async () => {
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

    // 懒绑定前：会话未关联任何小说。
    expect(await getNovelForSession("unbound-bug2", projectDir)).toBeUndefined()

    const resolved = await resolveSessionNovel(noParentSession, "unbound-bug2", projectDir)

    // 懒绑定后：恰好一本小说时 session 自动绑定到该小说。
    expect(resolved).toBe("novel-bug2")
    expect(await getNovelForSession("unbound-bug2", projectDir)).toBe("novel-bug2")
  })

  test("Bug 2 (negative): context source skips lazy binding when no novel exists", async () => {
    const projectDir = join(TempRoot, "bug2-empty-project")
    mkdirSync(projectDir, { recursive: true })

    const source = createNovelContextSource({
      session: noParentSession,
      directory: projectDir,
      configDir: join(TempRoot, "global-config"),
    })
    const value = await Effect.runPromise(source.load({ sessionID: "unbound-empty" }))

    // 模式契约是项目级，无小说时仍渲染；不应携带小说归属或快照
    expect(Option.isSome(value)).toBe(true)
    if (Option.isSome(value)) {
      expect(value.value.mode).toContain("【写作模式与初始化模式")
      expect(value.value.novelId).toBeUndefined()
      expect(value.value.snapshot).toBeUndefined()
    }
    expect(await getNovelForSession("unbound-empty", projectDir)).toBeUndefined()
  })

  test("Bug 3: tagNovelSession is idempotent for the same (session, novel) pair", async () => {
    const pluginDir = join(TempRoot, "bug3-project")
    mkdirSync(pluginDir, { recursive: true })

    const dbPath = join(pluginDir, ".novel", "novel.db")
    seedNovel(dbPath, "novel-dup")
    await tagNovelSession("session-dup", "novel-dup", pluginDir)
    await tagNovelSession("session-dup", "novel-dup", pluginDir)
    const rows = sessionNovelRows(dbPath, "session-dup")
    expect(rows.length).toBe(1)
    expect(rows[0].novel_id).toBe("novel-dup")
  })
})
