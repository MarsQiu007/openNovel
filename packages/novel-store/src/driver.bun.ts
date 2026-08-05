/**
 * Bun 运行时 SQLite 驱动。
 *
 * 通过 package.json 的 conditional `imports`（`#driver`）在 Bun 下解析到本文件。
 */
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { runMigrations } from "./migrate.js"

export type Db = ReturnType<typeof drizzle>

export function createDb(path: string, schemaSql: string): Db {
  const sqlite = new Database(path)
  sqlite.exec(schemaSql)
  runMigrations(
    (sql) => sqlite.exec(sql),
    (sql) => sqlite.query(sql).all(),
  )
  return drizzle({ client: sqlite })
}
