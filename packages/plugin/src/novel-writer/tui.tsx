/** @jsxImportSource @opentui/solid */
/**
 * 小说写作 TUI 插件
 *
 * TUI 启动时检测数据库中是否有小说。
 * 如果没有，自动弹出设置向导引导用户创建第一本书。
 */
import type { TuiPlugin, TuiPluginModule } from "../tui.js"
import type { TuiPluginApi } from "../tui.js"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/bun-sqlite"
// @ts-ignore - bun:sqlite 运行时可用
import { Database as BunSqlite } from "bun:sqlite"

// ─── 本地表定义（与 cli.ts 保持一致） ───

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

const GENRES = ["玄幻", "都市", "仙侠", "历史", "科幻", "悬疑", "言情", "游戏"] as const

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE IF NOT EXISTS volumes (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, summary text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS session_novel (id text PRIMARY KEY, session_id text NOT NULL, novel_id text NOT NULL, created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS style_guide (id text PRIMARY KEY, novel_id text NOT NULL, rules text DEFAULT '{}' NOT NULL, tone text DEFAULT '' NOT NULL, pov text DEFAULT '' NOT NULL, tense text DEFAULT '' NOT NULL);
`

function getDbPath(directory?: string | null): string {
  const env = process.env.OPENNOVEL_DB
  if (env) return env
  const base = directory ?? process.cwd()
  return join(base, ".novel", "novel.db")
}

// DB 连接按解析后的 dbPath 缓存：同一项目复用，不同项目互不污染。
const _dbCache = new Map<string, ReturnType<typeof drizzle>>()

function getDb(directory?: string | null): ReturnType<typeof drizzle> {
  const dbPath = getDbPath(directory)
  const cached = _dbCache.get(dbPath)
  if (cached) return cached
  const dir = join(dbPath, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const sqlite = new BunSqlite(dbPath)
  sqlite.exec(CREATE_TABLES_SQL)
  const db = drizzle({ client: sqlite })
  _dbCache.set(dbPath, db)
  return db
}

async function hasNovels(api: TuiPluginApi): Promise<boolean> {
  const db = getDb(api.state.path.directory)
  const rows = await db.select().from(NovelTable).limit(1).all()
  return rows.length > 0
}

async function createNovel(api: TuiPluginApi, title: string, genre: string, synopsis: string): Promise<string> {
  const db = getDb(api.state.path.directory)
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

// ─── 对话框辅助函数 ───

function selectDialog<V>(
  api: TuiPluginApi,
  title: string,
  options: { title: string; value: V; description?: string }[],
): Promise<V | null> {
  const DialogSelect = api.ui.DialogSelect
  return new Promise((resolve) => {
    let resolved = false
    const done = (v: V | null) => {
      if (resolved) return
      resolved = true
      resolve(v)
    }
    api.ui.dialog.replace(
      () => <DialogSelect title={title} options={options} onSelect={(option: { value: V }) => done(option.value)} />,
      () => done(null),
    )
  })
}

function promptDialog(api: TuiPluginApi, title: string, placeholder?: string): Promise<string | null> {
  const DialogPrompt = api.ui.DialogPrompt
  return new Promise((resolve) => {
    let resolved = false
    const done = (v: string | null) => {
      if (resolved) return
      resolved = true
      resolve(v)
    }
    api.ui.dialog.replace(
      () => (
        <DialogPrompt
          title={title}
          placeholder={placeholder}
          onConfirm={(value: string) => done(value)}
          onCancel={() => done(null)}
        />
      ),
      () => done(null),
    )
  })
}

function confirmDialog(api: TuiPluginApi, title: string, message: string): Promise<boolean> {
  const DialogConfirm = api.ui.DialogConfirm
  return new Promise((resolve) => {
    let resolved = false
    const done = (v: boolean) => {
      if (resolved) return
      resolved = true
      resolve(v)
    }
    api.ui.dialog.replace(
      () => <DialogConfirm title={title} message={message} onConfirm={() => done(true)} onCancel={() => done(false)} />,
      () => done(false),
    )
  })
}

// ─── TUI 插件入口 ───

const novelTuiPlugin: TuiPlugin = async (api, _options, _meta) => {
  // 等 TUI 初始渲染完成
  await new Promise((r) => setTimeout(r, 200))

  // 如果已有小说，跳过向导
  try {
    if (await hasNovels(api)) return
  } catch {
    // 数据库不可用，跳过
    return
  }

  // ── 步骤 1：选择题材 ──
  const genre = await selectDialog(
    api,
    "选择小说题材",
    GENRES.map((g) => ({ title: g, value: g })),
  )
  if (!genre) {
    api.ui.dialog.clear()
    return
  }

  // ── 步骤 2：输入标题 ──
  const title = await promptDialog(api, "输入小说标题", "例如：岳飞传")
  if (!title) {
    api.ui.dialog.clear()
    return
  }

  // ── 步骤 3：输入简介 ──
  const synopsis = await promptDialog(api, "输入小说简介", "描述故事背景、主角目标和主要冲突...")
  if (synopsis === null) {
    api.ui.dialog.clear()
    return
  }

  // ── 步骤 4：确认创建 ──
  const ok = await confirmDialog(
    api,
    "确认创建小说",
    `题材：${genre}\n标题：${title}\n简介：${synopsis || "（未填写）"}`,
  )
  if (!ok) {
    api.ui.dialog.clear()
    return
  }

  // 创建小说
  try {
    await createNovel(api, title, genre, synopsis)
    api.ui.dialog.clear()
    api.ui.toast({ message: `小说创建成功：${title}`, variant: "success" })
  } catch (err) {
    api.ui.dialog.clear()
    api.ui.toast({ message: `创建失败：${err}`, variant: "error" })
  }
}

export default {
  id: "novel-writer-tui",
  tui: novelTuiPlugin,
} satisfies TuiPluginModule
