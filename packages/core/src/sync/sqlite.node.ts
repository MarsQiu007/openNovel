/**
 * Node 运行时的同步快照驱动（Electron 侧车不支持 `bun:` 协议）。
 *
 * 通过 package.json 的 conditional `imports`（`#sync-sqlite`）在 Node 下解析到本文件。
 */
import { DatabaseSync } from "node:sqlite"

/** 将 source 数据库的一致性快照写入 target（VACUUM INTO 会隐式检查点 WAL） */
export function vacuumInto(source: string, target: string) {
  const db = new DatabaseSync(source, { readOnly: true, open: true })
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    db.close()
  }
}

/** 在快照副本上执行只读查询（用于提取小说标题等同步元信息） */
export function queryAll(source: string, sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(source, { readOnly: true, open: true })
  try {
    return db.prepare(sql).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}
