/**
 * 小说写作 CLI 业务逻辑
 *
 * 提供 initNovelProject 和 createBook 两个核心函数，供 CLI 命令调用。
 * 遵循 novel-writer.ts 的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, desc } from "drizzle-orm"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/bun-sqlite"
// @ts-ignore - bun:sqlite 类型仅在 bun 运行时可用
import { Database as BunSqlite } from "bun:sqlite"
import { join, resolve } from "path"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { readFile, writeFile } from "fs/promises"
import { DEFAULT_NOVEL_MODE_CONFIG } from "@opennovel-ai/novel-store"
import { isTechniqueLevel, LEVEL_CRITERIA } from "./technique.js"
import { extractJsonValue } from "./technique-extract.js"

// ─── 题材枚举 ───

/** 支持的 8 种题材 */
export const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"] as const

/** 题材类型 */
export type Genre = (typeof GENRES)[number]

/** 验证题材是否合法 */
export function isValidGenre(value: string): value is Genre {
  return GENRES.includes(value as Genre)
}

// ─── 本地表定义（与 packages/core/src/session/sql.ts 保持一致） ───

/** 小说表 */
const NovelTable = sqliteTable("novels", {
  id: text().primaryKey(),
  title: text().notNull(),
  genre: text().notNull(),
  synopsis: text().notNull().default(""),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
  status: text().notNull().default("draft"),
})

/** 会话表（用于查找最近会话） */
const SessionTable = sqliteTable("session", {
  id: text().primaryKey(),
  title: text().notNull(),
  time_created: integer(),
  time_updated: integer(),
})

/** 会话标记表（与 packages/core/src/session/sql.ts 中 SessionNovelTable 保持一致） */
const SessionNovelTable = sqliteTable("session_novel", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  novel_id: text().notNull(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

// ─── 数据库连接（与 novel-writer.ts 保持一致） ───

/** 获取项目级数据库路径 - 每个小说项目独立数据库，实现完全隔离 */
function getDbPath(): string {
  const env = process.env.OPENNOVEL_DB
  if (env) return env
  return join(process.cwd(), ".novel", "novel.db")
}

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE IF NOT EXISTS volumes (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, summary text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS chapter_versions (id text PRIMARY KEY, chapter_id text NOT NULL, version integer NOT NULL, content text NOT NULL, word_count integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, created_by text NOT NULL, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS character_states (id text PRIMARY KEY, character_id text NOT NULL, chapter_id text NOT NULL, active integer DEFAULT 1 NOT NULL, location text DEFAULT '' NOT NULL, mood text DEFAULT '' NOT NULL, summary text DEFAULT '' NOT NULL, FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS chapter_summaries (id text PRIMARY KEY, chapter_id text NOT NULL, summary text DEFAULT '' NOT NULL, key_events text DEFAULT '[]' NOT NULL, char_changes text DEFAULT '[]' NOT NULL, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS foreshadowing (id text PRIMARY KEY, novel_id text NOT NULL, planted_chapter_id text, resolved_chapter_id text, content text NOT NULL, state text DEFAULT 'planted' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (planted_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL, FOREIGN KEY (resolved_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS novel_state_log (id text PRIMARY KEY, novel_id text NOT NULL, chapter_id text, fact_type text NOT NULL, fact_data text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS plot_threads (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, status text DEFAULT 'open' NOT NULL, priority text DEFAULT 'medium' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL, closed_at integer, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS relationships (id text PRIMARY KEY, novel_id text NOT NULL, char_a_id text NOT NULL, char_b_id text NOT NULL, type text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (char_a_id) REFERENCES characters(id) ON DELETE CASCADE, FOREIGN KEY (char_b_id) REFERENCES characters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS session_novel (id text PRIMARY KEY, session_id text NOT NULL, novel_id text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS style_guide (id text PRIMARY KEY, novel_id text NOT NULL, rules text DEFAULT '{}' NOT NULL, tone text DEFAULT '' NOT NULL, pov text DEFAULT '' NOT NULL, tense text DEFAULT '' NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS volume_summaries (id text PRIMARY KEY, volume_id text NOT NULL, summary text DEFAULT '' NOT NULL, char_active text DEFAULT '[]' NOT NULL, char_dormant text DEFAULT '[]' NOT NULL, threads_open text DEFAULT '[]' NOT NULL, threads_closed text DEFAULT '[]' NOT NULL, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS world_entries (id text PRIMARY KEY, novel_id text NOT NULL, category text DEFAULT '' NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
`

let _db: ReturnType<typeof drizzle> | null = null

function getDb() {
  if (_db) return _db
  const dbPath = getDbPath()
  const dir = join(dbPath, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const sqlite = new BunSqlite(dbPath)
  sqlite.exec(CREATE_TABLES_SQL)
  _db = drizzle({ client: sqlite })
  return _db
}

// ─── 导出函数 ───

/**
 * 初始化小说项目 — 在当前目录创建 .novel 目录和配置
 * @param dir 项目目录，默认为当前工作目录
 */
export function initNovelProject(dir?: string): string {
  const projectDir = resolve(dir ?? process.cwd())
  const novelDir = join(projectDir, ".novel")

  if (existsSync(novelDir)) {
    return `项目已初始化：${novelDir}`
  }

  mkdirSync(novelDir, { recursive: true })

  // 创建默认配置文件 — writing/setup 模式从 novel-store 的 DEFAULT_NOVEL_MODE_CONFIG 复用
  // 单一来源：未来改默认值只动 DEFAULT_NOVEL_MODE_CONFIG 一处
  const config = {
    name: "未命名小说项目",
    created_at: new Date().toISOString(),
    version: "1.0.0",
    ...DEFAULT_NOVEL_MODE_CONFIG,
  }
  writeFileSync(join(novelDir, "config.json"), JSON.stringify(config, null, 2) + "\n")

  return `小说项目初始化完成：${novelDir}`
}

/**
 * 创建新书 — 写入 novels 表
 * @param title 书名
 * @param genre 题材（必须是 8 种题材之一）
 * @param synopsis 简介
 * @returns 新创建的小说 ID
 */
export async function createBook(title: string, genre: string, synopsis: string): Promise<string> {
  if (!isValidGenre(genre)) {
    throw new Error(`无效的题材：${genre}。支持的题材：${GENRES.join("、")}`)
  }

  const db = getDb()
  const id = crypto.randomUUID()
  const now = Date.now()

  await db
    .insert(NovelTable)
    .values({
      id,
      title,
      genre,
      synopsis,
      created_at: now,
      updated_at: now,
      status: "draft",
    })
    .run()

  return id
}

/**
 * 创建新书并标记当前会话
 * @param title 书名
 * @param genre 题材
 * @param synopsis 简介
 * @returns 创建结果描述
 */
export async function createBookAndTagSession(title: string, genre: string, synopsis: string): Promise<string> {
  const novelId = await createBook(title, genre, synopsis)

  // 尝试获取最近会话 ID 并标记
  const sessionId = await getRecentSessionId()
  if (sessionId) {
    await tagNovelSession(sessionId, novelId)
    return `新书创建成功：${title}（${novelId}）\n已关联当前会话：${sessionId}`
  }

  return `新书创建成功：${title}（${novelId}）\n（未找到活跃会话，跳过了会话关联）`
}

/**
 * 获取最近会话 ID
 */
async function getRecentSessionId(): Promise<string | undefined> {
  try {
    const db = getDb()
    const rows = await db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .orderBy(desc(SessionTable.time_updated))
      .limit(1)
      .all()
    return rows[0]?.id
  } catch {
    return undefined
  }
}

/**
 * 将会话标记为小说会话
 * @param sessionId 会话 ID
 * @param novelId 小说 ID
 */
async function tagNovelSession(sessionId: string, novelId: string): Promise<void> {
  const db = getDb()
  const id = crypto.randomUUID()
  await db.insert(SessionNovelTable).values({ id, session_id: sessionId, novel_id: novelId }).run()
}

// ─── 技法层级重分类 ───

// 判据输入只带 name/principle/instruction，不带原文证据摘录：成人技法证据是逐字露骨引文，
// 批次拼贴会触发模型服务商的内容安全过滤导致整批失败；层级判定看指令操作对象已足够。
const RELEVEL_PROMPT = `你是技法层级重分类员。请按以下判据为每条技法判定 level（作用层级）：
${LEVEL_CRITERIA}

待判技法（JSON 数组，含 id/name/principle/instruction）：
{{TECHNIQUES}}

请以 JSON 返回：{"judgments": [{"id": "技法id", "level": "sentence"}]}——只对给出的 id 返回判定，level 取 paragraph/sentence/dialogue/description/transition 之一。`

export interface RelevelOptions {
  batchSize?: number
  /** all=双源；book=仅本书库；global=仅全局通用库 */
  library?: "all" | "book" | "global"
}

export interface RelevelResult {
  total: number
  changed: number
  kept: number
  failed: number
  before: Record<string, number>
  after: Record<string, number>
}

function levelDistribution(levels: string[]): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const level of levels) dist[level] = (dist[level] ?? 0) + 1
  return dist
}

/**
 * 存量技法层级重分类：双源（本书库+全局库）扫描，按统一判据分批重判 level 并原地更新。
 * 幂等可重跑：LLM 判据缺失/非法/整批解析失败时保留原值并计数。
 */
export async function relevelTechniques(
  directory: string | null,
  llm: (prompt: string) => Promise<string>,
  options?: RelevelOptions,
): Promise<RelevelResult> {
  const { listAllTechniques, updateTechniqueLevel } = await import("./technique-store.js")
  const every = await listAllTechniques(directory)
  const wanted = options?.library ?? "all"
  const all = wanted === "all" ? every : every.filter(({ library }) => library === wanted)
  const batchSize = options?.batchSize ?? 10
  const before = levelDistribution(all.map(({ entry }) => entry.level))

  let changed = 0
  let kept = 0
  let failed = 0

  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize)
    const descriptions = batch.map(({ entry }) => ({
      id: entry.id,
      name: entry.name,
      principle: entry.principle,
      instruction: entry.instruction.slice(0, 600),
    }))
    const prompt = RELEVEL_PROMPT.replace("{{TECHNIQUES}}", JSON.stringify(descriptions, null, 1).slice(0, 8000))
    // 单批失败（含服务商内容过滤）不中断整体：计为失败保留原值，其余批次继续
    let parsed: unknown = null
    try {
      parsed = extractJsonValue(await llm(prompt))
    } catch {
      failed += batch.length
      continue
    }
    const judgments = isRecord(parsed) && Array.isArray(parsed.judgments) ? parsed.judgments : null
    if (judgments === null) {
      failed += batch.length
      continue
    }
    const byId = new Map<string, string>()
    for (const j of judgments) {
      if (isRecord(j) && typeof j.id === "string" && typeof j.level === "string") byId.set(j.id, j.level)
    }
    for (const { entry, library } of batch) {
      const judged = byId.get(entry.id)
      if (judged !== undefined && isTechniqueLevel(judged)) {
        if (judged === entry.level) {
          kept++
        } else {
          await updateTechniqueLevel(entry.id, judged, directory, library)
          changed++
        }
      } else {
        kept++
      }
    }
  }

  const afterAll = (await listAllTechniques(directory)).filter(({ library }) => wanted === "all" || library === wanted)
  return {
    total: all.length,
    changed,
    kept,
    failed,
    before,
    after: levelDistribution(afterAll.map(({ entry }) => entry.level)),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ─── 技法提取与种子导入 ───

export interface ExtractOptions {
  chunkSize?: number
  overlap?: number
}

/**
 * 从文本文件中提取写作技法并输出 JSON。
 * LLM 调用由调用方注入（保持 provider 无关，便于测试）。
 */
export async function runTechniqueExtraction(
  inputPath: string,
  outputPath: string,
  llm: (prompt: string) => Promise<string>,
  options?: ExtractOptions,
): Promise<{ segments: number; highlights: number; techniques: number; parseFailures: number }> {
  const { segmentText, highlightTechniques, distillTechniques, filterTechniques } = await import(
    "./technique-extract.js"
  )
  const { normalizeTechnique } = await import("./technique-normalize.js")

  const content = await readFile(inputPath, "utf-8")
  const segments = segmentText(content, {
    chunkSize: options?.chunkSize ?? 3000,
    overlap: options?.overlap ?? 500,
  })

  const highlightResult = await highlightTechniques(segments, llm)
  const distillResult = await distillTechniques(highlightResult.items, llm)
  const filtered = filterTechniques(distillResult.items)
  const normalized = filtered.map((partial) => normalizeTechnique(partial))

  await writeFile(outputPath, JSON.stringify(normalized, null, 2), "utf-8")
  return {
    segments: segments.length,
    highlights: highlightResult.items.length,
    techniques: normalized.length,
    parseFailures: highlightResult.parseFailures + distillResult.parseFailures,
  }
}

/**
 * 导入人工精选的种子技法（JSON 数组），初始状态为 verified。
 */
/**
 * 导入人工精选的种子技法（JSON 数组），初始状态为 verified。
 * 默认写入全局通用技法库（一次导入全库受益）；传 { local: true } 保留写入本书库的旧行为。
 */
export async function importSeedTechniques(
  inputPath: string,
  directory?: string | null,
  opts?: { local?: boolean },
): Promise<number> {
  return importTechniquesFromJson(inputPath, directory, { seed: true, local: opts?.local === true })
}

/**
 * 导入 LLM 提取的技法（JSON 数组），保持 unverified/0.5 初始状态，
 * 走"反馈闭环 → verified"的正常生命周期，不误标为人工精选。
 */
export async function importExtractedTechniques(
  inputPath: string,
  directory?: string | null,
): Promise<number> {
  return importTechniquesFromJson(inputPath, directory, { seed: false, local: true })
}

async function importTechniquesFromJson(
  inputPath: string,
  directory: string | null | undefined,
  opts: { seed: boolean; local?: boolean },
): Promise<number> {
  const { normalizeTechnique } = await import("./technique-normalize.js")
  const { upsertTechnique } = await import("./technique-store.js")

  const content = JSON.parse(await readFile(inputPath, "utf-8"))
  const items = Array.isArray(content) ? content : [content]
  // 种子默认入全局通用库；--local 或提取导入（无人工精选语义）落本书库
  const library = opts.local ? "book" : "global"
  for (const item of items) {
    await upsertTechnique(normalizeTechnique(item, { seed: opts.seed }), directory, library)
  }
  return items.length
}
