import { readFile, writeFile, mkdir } from "fs/promises"
import path from "path"

/** 云盘连接配置（全局，密码不落盘——走凭据存储） */
export interface SyncConnection {
  url: string
  username: string
  /** 远端根目录，默认 "opennovel" */
  remoteRoot: string
  /** 本地工作根目录；其下含 .novel/ 的子目录即同步项目 */
  rootDir?: string
}

/**
 * 根目录级配对登记，存 `<root>/.sync/registry.json`。
 * 项目目录被删除后登记仍在——「同步过又消失」才能识别为删除并传播到远端。
 */
export interface Registry {
  version: 1
  projects: Record<string, RegisteredProject>
}

export interface RegisteredProject {
  /** 项目身份指纹；与远端 latest.json 的 uuid 一致才算同源 */
  uuid: string
  lastSynced: {
    snapshotID: string
    /** 同步点本地库的逻辑内容哈希 */
    hash: string
    at: number
  } | null
}

const CONNECTION_FILE = "sync.json"

export async function readConnection(configDir: string): Promise<SyncConnection | undefined> {
  const text = await readFile(path.join(configDir, CONNECTION_FILE), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const parsed = JSON.parse(text) as Partial<SyncConnection>
  if (typeof parsed.url !== "string" || typeof parsed.username !== "string") return undefined
  return {
    url: parsed.url,
    username: parsed.username,
    remoteRoot: typeof parsed.remoteRoot === "string" && parsed.remoteRoot ? parsed.remoteRoot : "opennovel",
    rootDir: typeof parsed.rootDir === "string" && parsed.rootDir ? parsed.rootDir : undefined,
  }
}

export async function writeConnection(configDir: string, connection: SyncConnection) {
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, CONNECTION_FILE), JSON.stringify(connection, null, 2))
}

export async function removeConnection(configDir: string) {
  const { rm } = await import("fs/promises")
  await rm(path.join(configDir, CONNECTION_FILE), { force: true })
}

const registryFile = (rootDir: string) => path.join(rootDir, ".sync", "registry.json")

export async function readRegistry(rootDir: string): Promise<Registry> {
  const text = await readFile(registryFile(rootDir), "utf8").catch(() => undefined)
  if (text === undefined) return { version: 1, projects: {} }
  const parsed = JSON.parse(text) as Partial<Registry>
  if (typeof parsed.projects !== "object" || parsed.projects === null) return { version: 1, projects: {} }
  return { version: 1, projects: parsed.projects }
}

export async function writeRegistry(rootDir: string, registry: Registry) {
  const file = registryFile(rootDir)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(registry, null, 2))
}
