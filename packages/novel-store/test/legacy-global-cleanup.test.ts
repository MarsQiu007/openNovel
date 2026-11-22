import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, existsSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { closeDb, closeDbPath, removeLegacyGlobalTechniqueStore } from "../src/index.js"

let rootDir: string
let globalPath: string
let projectDir: string

beforeEach(() => {
  rootDir = join(tmpdir(), `legacy-global-cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  globalPath = join(rootDir, "techniques.db")
  projectDir = join(rootDir, "book")
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
  process.env.OPENNOVEL_TECHNIQUE_DB = globalPath
  process.env.OPENNOVEL_DB = join(projectDir, ".novel", "novel.db")
})

afterEach(() => {
  closeDb(projectDir)
  closeDbPath(globalPath)
  delete process.env.OPENNOVEL_TECHNIQUE_DB
  delete process.env.OPENNOVEL_DB
  rmSync(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

describe("旧全局技法库清理", () => {
  test("删除全局库与 sidecar，不触碰书籍库", () => {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) writeFileSync(`${globalPath}${suffix}`, "legacy")
    const bookDb = new Database(join(projectDir, ".novel", "novel.db"))
    try {
      bookDb.query("SELECT 1").all()
    } finally {
      bookDb.close()
    }

    removeLegacyGlobalTechniqueStore()

    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      expect(existsSync(`${globalPath}${suffix}`)).toBe(false)
    }
    expect(existsSync(join(projectDir, ".novel", "novel.db"))).toBe(true)
  })

  test("全局库不存在时保持 no-op", () => {
    removeLegacyGlobalTechniqueStore()
    expect(existsSync(join(rootDir, "opennovel", "techniques.db"))).toBe(false)
  })
})
