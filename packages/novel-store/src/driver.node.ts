/**
 * Node 运行时 SQLite 驱动。
 *
 * 通过 package.json 的 conditional `imports`（`#driver`）在 Node 下解析到本文件，
 * 供 Electron 侧车（Node ESM loader 不支持 `bun:` 协议）使用。
 */
import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { runMigrations } from "./migrate.js"

export type Db = ReturnType<typeof drizzle>

export function createDb(path: string, schemaSql: string): Db {
  const sqlite = new DatabaseSync(path)
  try {
    // node:sqlite 默认已启用外键（enableForeignKeys: true），这里显式开启
    // 与 bun 驱动行为对齐，避免运行时差异导致 ON DELETE CASCADE 失效
    sqlite.exec("PRAGMA foreign_keys = ON")
    sqlite.exec(schemaSql)
    runMigrations(
      (sql) => sqlite.exec(sql),
      (sql) => sqlite.prepare(sql).all(),
    )
  } catch (error) {
    // 建库/迁移失败也要关闭连接，否则文件句柄随错误泄漏
    sqlite.close()
    throw error
  }
  return drizzle({ client: sqlite })
}
