import { mkdir, copyFile, readFile, rename, writeFile } from "fs/promises"
import { readdir, stat } from "fs/promises"
import path from "path"
import type { RemoteStat, SyncAdapter } from "./adapter"

/**
 * 本地文件夹适配器：把远端映射到文件系统目录。
 *
 * 双重用途：
 * 1. 测试 fixture —— 不依赖网络即可做真实端到端同步测试。
 * 2. 免费功能 —— 指向云盘桌面客户端的同步目录（OneDrive/Dropbox/坚果云同步文件夹），
 *    由云盘客户端自己完成上传。
 */
export function createLocalFolderAdapter(root: string): SyncAdapter {
  const resolve = (remotePath: string) => path.join(root, ...remotePath.split("/").filter(Boolean))

  return {
    async stat(remotePath) {
      const info = await stat(resolve(remotePath)).catch(() => undefined)
      if (!info?.isFile()) return undefined
      const result: RemoteStat = { size: info.size, mtime: info.mtimeMs }
      return result
    },
    async mkdir(remotePath) {
      await mkdir(resolve(remotePath), { recursive: true })
    },
    async upload(localFile, remotePath) {
      const target = resolve(remotePath)
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(localFile, target)
    },
    async download(remotePath, localFile) {
      await mkdir(path.dirname(localFile), { recursive: true })
      await copyFile(resolve(remotePath), localFile)
    },
    async move(from, to) {
      const target = resolve(to)
      await mkdir(path.dirname(target), { recursive: true })
      await rename(resolve(from), target)
    },
    async remove(remotePath) {
      const { rm } = await import("fs/promises")
      await rm(resolve(remotePath), { recursive: true, force: true })
    },
    async list(remotePath) {
      const entries = await readdir(resolve(remotePath), { withFileTypes: true }).catch(() => [])
      return entries.filter((entry) => entry.isDirectory() || entry.isFile()).map((entry) => entry.name)
    },
    async readJson(remotePath) {
      const text = await readFile(resolve(remotePath), "utf8").catch(() => undefined)
      if (text === undefined) return undefined
      return JSON.parse(text)
    },
    async writeJson(remotePath, value) {
      const target = resolve(remotePath)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, JSON.stringify(value, null, 2))
    },
  }
}
