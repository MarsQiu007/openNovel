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
  // bun:sqlite 默认不启用外键约束，必须显式开启，
  // 否则各表 ON DELETE CASCADE 全部失效（删除小说后子表数据残留为孤儿行）
  sqlite.exec("PRAGMA foreign_keys = ON")
  sqlite.exec(schemaSql)
  runMigrations(
    (sql) => sqlite.exec(sql),
    (sql) => sqlite.query(sql).all(),
  )
  return drizzle({ client: sqlite })
}
