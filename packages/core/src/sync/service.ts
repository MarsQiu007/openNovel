import { createHash, randomUUID } from "crypto"
import { copyFile, mkdir, readFile, readdir, rm, stat } from "fs/promises"
import os from "os"
import path from "path"
import { queryAll, vacuumInto } from "#sync-sqlite"
import type { SyncAdapter } from "./adapter"
import { getDeviceIdentity, type DeviceIdentity } from "./device"
import { createLocalFolderAdapter } from "./local-folder"
import type { RegisteredProject, Registry, SyncConnection } from "./state"
import { readConnection, readRegistry, removeConnection, writeConnection, writeRegistry } from "./state"
import { createWebDavAdapter, SyncError } from "./webdav"

export { SyncError } from "./webdav"
export type { RemoteStat, SyncAdapter } from "./adapter"
export { getDeviceIdentity } from "./device"
export type { DeviceIdentity } from "./device"
export { readConnection } from "./state"
export type { RegisteredProject, Registry, SyncConnection } from "./state"

// ─── 公开类型 ───

export interface RemoteManifest {
  /** 项目身份指纹（配对裁决用） */
  uuid: string
  /** 目录名（配对与展示用） */
  name: string
  snapshotID: string
  /** 快照文件字节的 sha256，用于下载完整性校验 */
  file_sha256: string
  /** 数据库逻辑内容哈希（VACUUM 会重排字节，脏检测只能用逻辑哈希） */
  content_hash: string
  /** 内容级最后编辑时间（max(novels/chapters.updated_at)），谁新谁赢的仲裁依据 */
  content_time: number | null
  size: number
  createdAt: number
  device: DeviceIdentity
  /** 本快照基于哪个快照（溯源用） */
  base: string | null
  meta: {
    novels: Array<{ id: string; title: string }>
    chapters: number
  }
}

export type ProjectState =
  | "in_sync"
  | "local_ahead"
  | "remote_ahead"
  | "new_local"
  | "new_remote"
  | "conflict"
  | "pending_delete"

export interface ProjectStatus {
  name: string
  state: ProjectState
  lastSyncedAt?: number
  /** 项目内小说标题（展示用，尽力而为） */
  novels?: string[]
}

export interface LibraryStatus {
  connection?: { url: string; username: string; remoteRoot: string }
  rootDir?: string
  projects: ProjectStatus[]
}

export interface RunResult {
  name: string
  action: "uploaded" | "downloaded" | "deleted_remote"
}

export type Decision =
  | { kind: "pair_conflict"; name: string; remote: { device: string; at: number; novels: string[] } }
  | { kind: "tie_conflict"; name: string; localTime: number | null; remoteTime: number | null }
  | { kind: "delete_confirm"; names: string[] }

export type ResolveAction = "keep_local" | "keep_remote" | "keep_both" | "confirm_delete" | "skip"

export interface SyncDeps {
  /** 全局 config 目录（sync.json 连接配置） */
  configDir: string
  /** 全局 state 目录（设备身份） */
  stateDir: string
  /** 读取/保存 WebDAV 密码（凭据存储）；file:// 连接不需要密码 */
  getPassword?: () => Promise<string | undefined>
  setPassword?: (password: string | undefined) => Promise<void>
  /** 覆盖本地数据库前关闭并驱逐缓存的连接（由调用方注入，如 novel-store 的 closeDb） */
  closeDatabase?: (directory: string) => void | Promise<void>
  /** 解析项目数据库路径（默认 <dir>/.novel/novel.db；服务端注入 novel-store 的 getDbPath） */
  dbFileFor?: (directory: string) => string
}

// ─── 常量与路径 ───

/** 双方内容时间差小于该值时不擅自仲裁，转人工冲突 */
const TIE_THRESHOLD_MS = 60_000

const dbFile = (deps: SyncDeps, directory: string) =>
  deps.dbFileFor?.(directory) ?? path.join(directory, ".novel", "novel.db")

/** .novel 目录（备份与下载临时文件的存放处） */
const novelDir = (db: string) => path.dirname(db)

const remoteDir = (connection: SyncConnection, name: string) =>
  [connection.remoteRoot, name].join("/").split("/").filter(Boolean).join("/")

const latestPath = (dir: string) => `${dir}/latest.json`

// ─── 适配器选择：file:// 走本地文件夹，其余走 WebDAV ───

function localRoot(url: string) {
  const raw = decodeURIComponent(url.slice("file://".length))
  // file:///E:/sync 在 Windows 上路径为 /E:/sync，剥掉盘符前的斜杠
  if (process.platform === "win32") return raw.replace(/^\/(?=[A-Za-z]:)/, "")
  return raw
}

async function createAdapter(connection: SyncConnection, password: string | undefined): Promise<SyncAdapter> {
  if (connection.url.startsWith("file://")) return createLocalFolderAdapter(localRoot(connection.url))
  return createWebDavAdapter({
    url: connection.url,
    username: connection.username,
    password: password ?? "",
    root: "/",
  })
}

// ─── 工具 ───

async function fileSha256(file: string): Promise<string | undefined> {
  const data = await readFile(file).catch(() => undefined)
  if (data === undefined) return undefined
  return createHash("sha256").update(data).digest("hex")
}

/**
 * 数据库逻辑内容哈希：按固定表序逐行哈希，与物理字节布局无关。
 * VACUUM INTO 会重排页面导致文件字节变化，若用文件哈希做脏检测，
 * 两台机器会把逻辑相同的内容来回互推（ping-pong）。
 */
function contentHash(db: string): string {
  const hash = createHash("sha256")
  const tables = queryAll(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  for (const { name } of tables) {
    hash.update(String(name))
    // 本项目所有表均有 rowid；ORDER BY rowid 保证跨副本行序一致
    for (const row of queryAll(db, `SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`)) {
      hash.update(JSON.stringify(row))
    }
  }
  return hash.digest("hex")
}

/** 内容级最后编辑时间：max(novels.updated_at, chapters.updated_at)；无内容或表缺失时为 null */
function contentTime(db: string): number | null {
  let latest: number | null = null
  for (const table of ["novels", "chapters"]) {
    try {
      const value = queryAll(db, `SELECT MAX(updated_at) AS t FROM "${table}"`)[0]?.t
      if (typeof value === "number" && (latest === null || value > latest)) latest = value
    } catch {
      // 表不存在（如最小测试库）——忽略
    }
  }
  return latest
}

const newSnapshotID = () => `${Date.now().toString(36).padStart(11, "0")}-${randomUUID().slice(0, 8)}`

function parseManifest(input: unknown): RemoteManifest | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const value = input as Partial<RemoteManifest>
  if (typeof value.uuid !== "string" || typeof value.name !== "string") return undefined
  if (typeof value.snapshotID !== "string") return undefined
  if (typeof value.file_sha256 !== "string" || typeof value.content_hash !== "string") return undefined
  if (typeof value.size !== "number" || typeof value.createdAt !== "number") return undefined
  if (typeof value.device !== "object" || value.device === null) return undefined
  if (typeof value.device.id !== "string" || typeof value.device.name !== "string") return undefined
  const meta = typeof value.meta === "object" && value.meta !== null ? value.meta : { novels: [], chapters: 0 }
  return {
    uuid: value.uuid,
    name: value.name,
    snapshotID: value.snapshotID,
    file_sha256: value.file_sha256,
    content_hash: value.content_hash,
    content_time: typeof value.content_time === "number" ? value.content_time : null,
    size: value.size,
    createdAt: value.createdAt,
    device: { id: value.device.id, name: value.device.name },
    base: typeof value.base === "string" ? value.base : null,
    meta: {
      novels: Array.isArray(meta.novels) ? meta.novels : [],
      chapters: typeof meta.chapters === "number" ? meta.chapters : 0,
    },
  }
}

function readMeta(db: string): RemoteManifest["meta"] {
  try {
    const novels = queryAll(db, "SELECT id, title FROM novels ORDER BY created_at").map((row) => ({
      id: String(row.id),
      title: String(row.title),
    }))
    const chapters = Number(queryAll(db, "SELECT COUNT(*) AS c FROM chapters")[0]?.c ?? 0)
    return { novels, chapters }
  } catch {
    return { novels: [], chapters: 0 }
  }
}

// ─── 每根目录操作串行化 ───

const locks = new Map<string, Promise<unknown>>()

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.then(fn, () => fn())
  locks.set(
    key,
    next.catch(() => {}),
  )
  return next
}

// ─── 连接与根目录管理 ───

export async function testConnection(input: { url: string; username: string; password?: string; remoteRoot?: string }) {
  const connection: SyncConnection = {
    url: input.url,
    username: input.username,
    remoteRoot: input.remoteRoot || "opennovel",
  }
  const adapter = await createAdapter(connection, input.password)
  await adapter.mkdir(connection.remoteRoot)
  await adapter.list(connection.remoteRoot)
  return { ok: true as const }
}

/** 保存连接（先测通再落盘），密码进入凭据存储而非配置文件 */
export async function saveConnection(
  deps: Pick<SyncDeps, "configDir" | "setPassword">,
  input: { url: string; username: string; password: string; remoteRoot?: string },
) {
  await testConnection(input)
  const existing = await readConnection(deps.configDir)
  const connection: SyncConnection = {
    url: input.url,
    username: input.username,
    remoteRoot: input.remoteRoot || "opennovel",
    rootDir: existing?.rootDir,
  }
  await writeConnection(deps.configDir, connection)
  await deps.setPassword?.(input.password)
  return connection
}

export async function disconnect(deps: Pick<SyncDeps, "configDir" | "setPassword">) {
  await removeConnection(deps.configDir)
  await deps.setPassword?.(undefined)
}

/** 设置本地工作根目录（同步的唯一边界） */
export async function setRootDir(deps: SyncDeps, rootDir: string): Promise<LibraryStatus> {
  const info = await stat(rootDir).catch(() => undefined)
  if (!info?.isDirectory()) throw new SyncError("io", "目录不存在或不是文件夹")
  const connection = await readConnection(deps.configDir)
  if (!connection) throw new SyncError("io", "尚未配置云盘连接")
  await writeConnection(deps.configDir, { ...connection, rootDir })
  return getStatus(deps)
}

// ─── 计划：每个项目该做什么 ───

type PlannedAction =
  | "upload_new"
  | "download_new"
  | "push"
  | "pull"
  | "overwrite_remote"
  | "overwrite_local"
  | "delete_remote"
  | "adopt"
  | "cleanup"
  | "pair_conflict"
  | "tie_conflict"
  | "noop"

interface PlannedProject {
  name: string
  action: PlannedAction
  local?: { hash: string; contentTime: number | null }
  remote?: RemoteManifest
  reg?: RegisteredProject
}

/** 枚举本地项目：根目录下含 .novel/ 的非隐藏子目录 */
async function scanLocalProjects(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => undefined)
  if (!entries) throw new SyncError("io", "工作根目录不存在或不可读")
  const names = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const marker = await stat(path.join(rootDir, entry.name, ".novel")).catch(() => undefined)
        return marker?.isDirectory() ? entry.name : undefined
      }),
  )
  return names.filter((name): name is string => name !== undefined)
}

async function buildPlan(
  deps: SyncDeps,
  connection: SyncConnection,
  adapter: SyncAdapter,
  registry: Registry,
): Promise<PlannedProject[]> {
  const rootDir = connection.rootDir!
  const localNames = await scanLocalProjects(rootDir)
  const remoteNames = (await adapter.list(connection.remoteRoot)).filter((name) => !name.startsWith("."))
  const names = [...new Set([...localNames, ...remoteNames, ...Object.keys(registry.projects)])].sort()

  return Promise.all(
    names.map(async (name): Promise<PlannedProject> => {
      const reg = registry.projects[name]
      const dir = path.join(rootDir, name)
      const db = dbFile(deps, dir)
      const localExists = localNames.includes(name) && (await stat(db).catch(() => undefined)) !== undefined
      const local = localExists ? { hash: contentHash(db), contentTime: contentTime(db) } : undefined
      const remote = parseManifest(await adapter.readJson(latestPath(remoteDir(connection, name))))

      // 仅本地存在 → 上传新建（也覆盖「远端被应用外删除」的自愈：重新上传）
      if (local && !remote) return { name, action: "upload_new", local, reg }
      // 仅远端存在
      if (!local && remote) {
        // 配对过且同源 → 本地目录被删，传播删除
        if (reg && reg.uuid === remote.uuid) return { name, action: "delete_remote", remote, reg }
        // 配对过但远端内容已非同源（罕见）→ 人工决策；未配对 → 下载落地
        if (reg) return { name, action: "pair_conflict", remote, reg }
        return { name, action: "download_new", remote }
      }
      if (!local && !remote) {
        // 双向都消失：清理残留登记
        return { name, action: reg ? "cleanup" : "noop", reg }
      }
      // 双方都在
      if (!reg || reg.uuid !== remote!.uuid) {
        // 未配对或同名异源：内容一致则收养配对（写入登记），否则人工决策
        if (local!.hash === remote!.content_hash) return { name, action: "adopt", local, remote, reg }
        return { name, action: "pair_conflict", local, remote, reg }
      }
      const localDirty = local!.hash !== reg.lastSynced?.hash
      const remoteChanged = remote!.snapshotID !== reg.lastSynced?.snapshotID
      if (!localDirty && !remoteChanged) return { name, action: "noop", local, remote, reg }
      if (localDirty && !remoteChanged) return { name, action: "push", local, remote, reg }
      if (!localDirty && remoteChanged) return { name, action: "pull", local, remote, reg }
      // 双方都变：谁新谁赢；过近不猜
      const lt = local!.contentTime
      const rt = remote!.content_time ?? remote!.createdAt
      if (lt !== null && rt !== null && Math.abs(lt - rt) < TIE_THRESHOLD_MS) {
        return { name, action: "tie_conflict", local, remote, reg }
      }
      if (lt !== null && rt === null) return { name, action: "overwrite_remote", local, remote, reg }
      if (lt === null && rt !== null) return { name, action: "overwrite_local", local, remote, reg }
      if (lt === null && rt === null) return { name, action: "tie_conflict", local, remote, reg }
      // 前面四个分支已排除全部 null 组合，此处 lt/rt 必为非空（tsgo 不做此收窄，保留断言）
      return lt! >= rt! ? { name, action: "overwrite_remote", local, remote, reg } : { name, action: "overwrite_local", local, remote, reg }
    }),
  )
}

const toProjectState: Record<PlannedAction, ProjectState | undefined> = {
  noop: "in_sync",
  adopt: "in_sync",
  cleanup: undefined,
  push: "local_ahead",
  overwrite_remote: "local_ahead",
  pull: "remote_ahead",
  overwrite_local: "remote_ahead",
  upload_new: "new_local",
  download_new: "new_remote",
  pair_conflict: "conflict",
  tie_conflict: "conflict",
  delete_remote: "pending_delete",
}

// ─── 执行：单项目动作 ───

async function uploadProject(
  deps: SyncDeps,
  connection: SyncConnection,
  adapter: SyncAdapter,
  registry: Registry,
  name: string,
  uuid: string,
) {
  const dir = path.join(connection.rootDir!, name)
  const db = dbFile(deps, dir)
  if (!(await stat(db).catch(() => undefined))) throw new SyncError("io", `本地数据库不存在，无法上传：${name}`)

  const tmpDir = path.join(os.tmpdir(), "opennovel-sync")
  await mkdir(tmpDir, { recursive: true })
  const tmp = path.join(tmpDir, `${randomUUID()}.snap`)
  vacuumInto(db, tmp)
  try {
    const snapshotID = newSnapshotID()
    const remote = parseManifest(await adapter.readJson(latestPath(remoteDir(connection, name))))
    const manifest: RemoteManifest = {
      uuid,
      name,
      snapshotID,
      file_sha256: (await fileSha256(tmp))!,
      content_hash: contentHash(tmp),
      content_time: contentTime(tmp),
      size: (await stat(tmp)).size,
      createdAt: Date.now(),
      device: await getDeviceIdentity(deps.stateDir),
      base: remote?.snapshotID ?? null,
      meta: readMeta(tmp),
    }
    const dir2 = remoteDir(connection, name)
    await adapter.mkdir(`${dir2}/snapshots`)
    // 快照先传临时名再 MOVE，避免远端读到半截文件；latest.json 最后更新作为指针
    await adapter.upload(tmp, `${dir2}/snapshots/${snapshotID}.snap.tmp`)
    await adapter.move(`${dir2}/snapshots/${snapshotID}.snap.tmp`, `${dir2}/snapshots/${snapshotID}.snap`)
    // 坚果云不允许 MOVE 覆盖已存在文件（409）。latest.json 体积小、读取方有
    // 解析 + sha256 双重校验，放弃 tmp+move 原子性，直接 PUT 覆盖
    await adapter.writeJson(`${dir2}/latest.json`, manifest)

    registry.projects[name] = {
      uuid,
      lastSynced: { snapshotID, hash: manifest.content_hash, at: manifest.createdAt },
    }
    await writeRegistry(connection.rootDir!, registry)
  } finally {
    await rm(tmp, { force: true })
  }
}

const MAX_BACKUPS = 10

async function backupCurrent(db: string) {
  if (!(await stat(db).catch(() => undefined))) return
  const backupDir = path.join(novelDir(db), "backups")
  await mkdir(backupDir, { recursive: true })
  await copyFile(db, path.join(backupDir, `novel-${Date.now()}.db`))
  const backups = (await readdir(backupDir)).filter((name) => name.endsWith(".db")).sort()
  for (const stale of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
    await rm(path.join(backupDir, stale), { force: true })
  }
}

async function downloadProject(
  deps: SyncDeps,
  connection: SyncConnection,
  adapter: SyncAdapter,
  registry: Registry,
  name: string,
  remote: RemoteManifest,
  options: { pair: boolean },
) {
  const rootDir = connection.rootDir!
  const dir = path.join(rootDir, name)
  const db = dbFile(deps, dir)
  await mkdir(novelDir(db), { recursive: true })
  // 下载到 .novel 内临时文件（与目标同卷），校验后再替换
  const tmp = path.join(novelDir(db), `.sync-download-${randomUUID()}`)
  await adapter.download(`${remoteDir(connection, remote.name)}/snapshots/${remote.snapshotID}.snap`, tmp)
  try {
    const downloaded = await fileSha256(tmp)
    if (downloaded !== remote.file_sha256) throw new SyncError("io", "下载内容校验失败，请重试")

    await deps.closeDatabase?.(dir)
    await backupCurrent(db)
    // 替换主库前清掉可能残留的 WAL/日志侧车文件，防止旧日志重放到新库上
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await rm(db + suffix, { force: true })
    }
    await copyFile(tmp, db)
    await rm(tmp, { force: true })

    if (options.pair) {
      registry.projects[name] = {
        uuid: remote.uuid,
        lastSynced: { snapshotID: remote.snapshotID, hash: remote.content_hash, at: remote.createdAt },
      }
      await writeRegistry(rootDir, registry)
    }
  } finally {
    await rm(tmp, { force: true })
  }
}

async function deleteRemoteProject(
  connection: SyncConnection,
  adapter: SyncAdapter,
  registry: Registry,
  name: string,
) {
  await adapter.remove(remoteDir(connection, name))
  delete registry.projects[name]
  await writeRegistry(connection.rootDir!, registry)
}

// ─── 库级入口 ───

/** 读取连接并创建适配器，然后在根目录锁内读登记并执行操作（登记必须在锁内读，避免并发下拿到旧快照） */
function withRoot<T>(deps: SyncDeps, fn: (ctx: { connection: SyncConnection; adapter: SyncAdapter; registry: Registry }) => Promise<T>): Promise<T> {
  const prepare = async () => {
    const connection = await readConnection(deps.configDir)
    if (!connection) throw new SyncError("io", "尚未配置云盘连接")
    if (!connection.rootDir) throw new SyncError("io", "尚未设置工作根目录")
    const adapter = await createAdapter(connection, await deps.getPassword?.())
    return { connection, adapter }
  }
  return prepare().then(({ connection, adapter }) =>
    withLock(connection.rootDir!, async () => {
      const registry = await readRegistry(connection.rootDir!)
      return fn({ connection, adapter, registry })
    }),
  )
}

export async function getStatus(deps: SyncDeps): Promise<LibraryStatus> {
  const connection = await readConnection(deps.configDir)
  if (!connection) return { projects: [] }
  const base = {
    connection: { url: connection.url, username: connection.username, remoteRoot: connection.remoteRoot },
    rootDir: connection.rootDir,
  }
  if (!connection.rootDir) return { ...base, projects: [] }

  const adapter = await createAdapter(connection, await deps.getPassword?.())
  const registry = await readRegistry(connection.rootDir)
  const planned = await buildPlan(deps, connection, adapter, registry)
  return {
    ...base,
    projects: planned
      .map((p): ProjectStatus | undefined => {
        const state = toProjectState[p.action]
        if (!state) return undefined
        if (p.action === "noop" && !p.reg) return undefined // 双向都消失的残留键不入列
        return {
          name: p.name,
          state,
          lastSyncedAt: p.reg?.lastSynced?.at,
          novels: p.remote?.meta.novels.map((novel) => novel.title),
        }
      })
      .filter((p): p is ProjectStatus => p !== undefined),
  }
}

/**
 * 库级一键同步：执行全部无歧义动作；同名异源、时间平局、批量删除
 * 转为决策项返回，由调用方（设置页）逐个弹窗后用 resolve 执行。
 */
export async function syncAll(deps: SyncDeps): Promise<{ results: RunResult[]; decisions: Decision[] }> {
  return withRoot(deps, async ({ connection, adapter, registry }) => {
    const planned = await buildPlan(deps, connection, adapter, registry)
    const results: RunResult[] = []
    const decisions: Decision[] = []

    // 单次运行要删多个远端项目时，不擅自动手，汇总成一个确认决策
    const deletions = planned.filter((p) => p.action === "delete_remote")
    const autoDelete = deletions.length <= 1
    if (!autoDelete) decisions.push({ kind: "delete_confirm", names: deletions.map((p) => p.name) })

    for (const p of planned) {
      if (p.action === "noop") continue
      if (p.action === "adopt") {
        // 内容一致的同名项目：登记配对，之后按同源项目正常走增量
        registry.projects[p.name] = {
          uuid: p.remote!.uuid,
          lastSynced: { snapshotID: p.remote!.snapshotID, hash: p.remote!.content_hash, at: p.remote!.createdAt },
        }
        await writeRegistry(connection.rootDir!, registry)
        continue
      }
      if (p.action === "cleanup") {
        delete registry.projects[p.name]
        await writeRegistry(connection.rootDir!, registry)
        continue
      }
      if (p.action === "pair_conflict") {
        decisions.push({
          kind: "pair_conflict",
          name: p.name,
          remote: {
            device: p.remote!.device.name,
            at: p.remote!.createdAt,
            novels: p.remote!.meta.novels.map((novel) => novel.title),
          },
        })
        continue
      }
      if (p.action === "tie_conflict") {
        decisions.push({
          kind: "tie_conflict",
          name: p.name,
          localTime: p.local?.contentTime ?? null,
          remoteTime: p.remote!.content_time ?? p.remote!.createdAt,
        })
        continue
      }
      if (p.action === "delete_remote") {
        if (!autoDelete) continue
        await deleteRemoteProject(connection, adapter, registry, p.name)
        results.push({ name: p.name, action: "deleted_remote" })
        continue
      }
      if (p.action === "upload_new" || p.action === "push" || p.action === "overwrite_remote") {
        // upload_new 总是分配新 UUID（自愈重传也是新身份）；push/overwrite 沿用配对 UUID
        const uuid = p.action === "upload_new" ? randomUUID() : p.reg!.uuid
        await uploadProject(deps, connection, adapter, registry, p.name, uuid)
        results.push({ name: p.name, action: "uploaded" })
        continue
      }
      // pull / overwrite_local / download_new
      await downloadProject(deps, connection, adapter, registry, p.name, p.remote!, { pair: true })
      results.push({ name: p.name, action: "downloaded" })
    }
    return { results, decisions }
  })
}

/** 执行单个决策项；每次基于最新状态重算，避免拿着过期计划动手 */
export async function resolve(
  deps: SyncDeps,
  input: { name?: string; action: ResolveAction; names?: readonly string[] },
): Promise<LibraryStatus> {
  await withRoot(deps, async ({ connection, adapter, registry }) => {
    if (input.action === "skip") return
    if (input.action === "confirm_delete") {
      for (const name of input.names ?? []) {
        await deleteRemoteProject(connection, adapter, registry, name)
      }
      return
    }
    const name = input.name
    if (!name) throw new SyncError("io", "缺少项目名")
    const planned = await buildPlan(deps, connection, adapter, registry)
    const p = planned.find((item) => item.name === name)
    // pair_conflict 下远端可能已变化；以最新清单为准
    const remote = p?.remote ?? parseManifest(await adapter.readJson(latestPath(remoteDir(connection, name))))

    if (input.action === "keep_remote") {
      if (!remote) throw new SyncError("not_found", "远端不存在该项目")
      await downloadProject(deps, connection, adapter, registry, name, remote, { pair: true })
      return
    }
    // 同源冲突（登记指纹与远端一致）沿用配对身份，否则其他机器会误判同名异源再次弹窗；
    // 只有异源占领远端时才分配新身份
    const uuid = p?.reg && remote && p.reg.uuid === remote.uuid ? p.reg.uuid : randomUUID()
    if (input.action === "keep_local") {
      await uploadProject(deps, connection, adapter, registry, name, uuid)
      return
    }
    // keep_both：远端内容落地为 name-2（不登记，下一轮作为新项目上传），本地占领远端
    if (!remote) throw new SyncError("not_found", "远端不存在该项目")
    const sibling = await freeSiblingName(connection.rootDir!, name)
    await downloadProject(deps, connection, adapter, registry, sibling, remote, { pair: false })
    await uploadProject(deps, connection, adapter, registry, name, uuid)
  })
  return getStatus(deps)
}

/** 为「两者都留」找一个空闲的兄弟目录名：name-2、name-3… */
async function freeSiblingName(rootDir: string, name: string): Promise<string> {
  for (let i = 2; ; i++) {
    const candidate = `${name}-${i}`
    if (!(await stat(path.join(rootDir, candidate)).catch(() => undefined))) return candidate
  }
}
