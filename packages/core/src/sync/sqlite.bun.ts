/**
 * Bun 运行时的同步快照驱动。
 *
 * 通过 package.json 的 conditional `imports`（`#sync-sqlite`）在 Bun 下解析到本文件。
 * 只负责以只读方式打开任意 SQLite 文件并执行 VACUUM INTO，与 drizzle 无关。
 */
import { Database } from "bun:sqlite"

/** 将 source 数据库的一致性快照写入 target（VACUUM INTO 会隐式检查点 WAL） */
export function vacuumInto(source: string, target: string) {
  const db = new Database(source, { readonly: true, create: false })
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    db.close()
  }
}

/** 在快照副本上执行只读查询（用于提取小说标题等同步元信息） */
export function queryAll(source: string, sql: string): Record<string, unknown>[] {
  const db = new Database(source, { readonly: true, create: false })
  try {
    return db.query(sql).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}
