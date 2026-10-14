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
  try {
    // bun:sqlite 默认不启用外键约束，必须显式开启，
    // 否则各表 ON DELETE CASCADE 全部失效（删除小说后子表数据残留为孤儿行）
    sqlite.exec("PRAGMA foreign_keys = ON")
    // 与 core 侧（busy_timeout = 5000）对齐：共享同一库文件的多个连接发生 DDL/写入竞争时
    // 应等待锁释放而不是立即失败——默认 0ms 会瞬时抛 database is locked，
    // 且 exec 逐条提交、遇错中止，会留下非事务半成品建库。
    sqlite.exec("PRAGMA busy_timeout = 5000")
    sqlite.exec(schemaSql)
    runMigrations(
      (sql) => sqlite.exec(sql),
      (sql) => sqlite.query(sql).all(),
    )
  } catch (error) {
    // 建库/迁移失败也要关闭连接，否则文件句柄随错误泄漏
    sqlite.close()
    throw error
  }
  return drizzle({ client: sqlite })
}
