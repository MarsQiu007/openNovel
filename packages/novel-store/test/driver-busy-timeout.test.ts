/**
 * SQLite 驱动 PRAGMA 对齐测试。
 *
 * core 与 novel-store（含桌面侧车）会共享同一库文件，跨连接 DDL/写入竞争必须在
 * 驱动层等待锁释放（busy_timeout = 5000），默认 0ms 会瞬时抛 database is locked。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, getDb } from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `driver-busy-timeout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  closeDb(projectDir)
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下 DB 文件可能短暂占用，进程退出后系统回收
  }
})

describe("SQLite 驱动 PRAGMA", () => {
  test("busy_timeout 与 core 对齐为 5000ms", () => {
    const db = getDb(projectDir)
    const rows = db.all("PRAGMA busy_timeout") as Array<{ timeout: number }>
    expect(rows[0]?.timeout).toBe(5000)
  })
})