/**
 * Node 运行时 SQLite 驱动。
 *
 * 通过 package.json 的 conditional `imports`（`#driver`）在 Node 下解析到本文件，
 * 供 Electron 侧车（Node ESM loader 不支持 `bun:` 协议）使用。
 */
import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"

export type Db = ReturnType<typeof drizzle>

export function createDb(path: string, schemaSql: string): Db {
  const sqlite = new DatabaseSync(path)
  sqlite.exec(schemaSql)
  return drizzle({ client: sqlite })
}
