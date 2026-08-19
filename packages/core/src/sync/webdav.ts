import { readFile, writeFile } from "fs/promises"
import { mkdir } from "fs/promises"
import path from "path"
import type { SyncAdapter } from "./adapter"

export class SyncError extends Error {
  constructor(
    readonly code: "auth" | "not_found" | "network" | "io" | "conflict",
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SyncError"
  }
}

interface WebDavClient {
  stat(path: string): Promise<{ size: number; lastmod: string; type: string }>
  createDirectory(path: string, options?: { recursive?: boolean }): Promise<void>
  putFileContents(path: string, data: Buffer | string, options?: { overwrite?: boolean }): Promise<boolean>
  getFileContents(path: string, options?: { format?: string }): Promise<Buffer | string>
  moveFile(from: string, to: string): Promise<void>
  deleteFile(path: string): Promise<void>
  getDirectoryContents(path: string): Promise<Array<{ basename: string; type: string }>>
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status
    if (typeof status === "number") return status
  }
  return undefined
}

/**
 * WebDAV 适配器（坚果云 / Nextcloud / Box 等）。
 *
 * 认证：authType 默认 Auto，按服务端 WWW-Authenticate 头自动协商 Basic/Digest
 * （坚果云 = 账号邮箱 + 应用密码，Basic）。`webdav` 包体积较大且只有用到时才需要，
 * 动态导入以保持启动性能。
 */
export async function createWebDavAdapter(options: {
  url: string
  username: string
  password: string
  /** 远端根目录（posix 风格，如 "/opennovel"），默认 "/" */
  root?: string
}): Promise<SyncAdapter> {
  const { createClient } = await import("webdav")
  // 归一化远端根目录：去掉首尾斜杠，避免拼接出 "//"
  const root = (options.root ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
  const resolve = (remotePath: string) =>
    "/" + [root, remotePath].join("/").split("/").filter(Boolean).join("/")

  const client = createClient(options.url, {
    username: options.username,
    password: options.password,
    maxBodyLength: Number.POSITIVE_INFINITY,
    maxContentLength: Number.POSITIVE_INFINITY,
  }) as unknown as WebDavClient

  async function call<T>(fn: (client: WebDavClient) => Promise<T>): Promise<T> {
    try {
      return await fn(client)
    } catch (error) {
      throw normalize(error)
    }
  }

  function normalize(error: unknown): SyncError {
    const status = statusOf(error)
    if (status === 401 || status === 403) {
      return new SyncError("auth", "云盘认证失败，请检查账号和应用密码（坚果云需在安全设置中生成应用密码）", error)
    }
    if (status === 404) return new SyncError("not_found", "远端路径不存在", error)
    if (status !== undefined) return new SyncError("io", `云盘请求失败（HTTP ${status}）`, error)
    return new SyncError("network", "无法连接云盘，请检查网络与服务器地址", error)
  }

  return {
    async stat(remotePath) {
      const info = await call((c) => c.stat(resolve(remotePath))).catch((error: unknown) => {
        if (error instanceof SyncError && error.code === "not_found") return undefined
        throw error
      })
      if (!info || info.type !== "file") return undefined
      return { size: info.size, mtime: Date.parse(info.lastmod) }
    },
    async mkdir(remotePath) {
      await call((c) => c.createDirectory(resolve(remotePath), { recursive: true }))
    },
    async upload(localFile, remotePath) {
      const data = await readFile(localFile)
      await call((c) => c.putFileContents(resolve(remotePath), data, { overwrite: true }))
    },
    async download(remotePath, localFile) {
      const data = await call((c) => c.getFileContents(resolve(remotePath), { format: "binary" }))
      await mkdir(path.dirname(localFile), { recursive: true })
      await writeFile(localFile, data)
    },
    async move(from, to) {
      await call((c) => c.moveFile(resolve(from), resolve(to)))
    },
    async remove(remotePath) {
      await call((c) => c.deleteFile(resolve(remotePath))).catch((error: unknown) => {
        if (error instanceof SyncError && error.code === "not_found") return
        throw error
      })
    },
    async list(remotePath) {
      const entries = await call((c) => c.getDirectoryContents(resolve(remotePath))).catch((error: unknown) => {
        if (error instanceof SyncError && error.code === "not_found") return []
        throw error
      })
      return entries.map((entry) => entry.basename)
    },
    async readJson(remotePath) {
      const text = await call((c) => c.getFileContents(resolve(remotePath), { format: "text" })).catch(
        (error: unknown) => {
          if (error instanceof SyncError && error.code === "not_found") return undefined
          throw error
        },
      )
      if (text === undefined) return undefined
      return JSON.parse(String(text))
    },
    async writeJson(remotePath, value) {
      await call((c) => c.putFileContents(resolve(remotePath), JSON.stringify(value, null, 2), { overwrite: true }))
    },
  }
}
