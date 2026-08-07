/**
 * 小说 DB 迁移。
 *
 * CREATE_TABLES_SQL 全部使用 CREATE TABLE IF NOT EXISTS，无法升级已存在的旧表，
 * 历史遗留的 schema 问题需要在这里显式迁移修复。
 */

type ExecFn = (sql: string) => unknown
type QueryFn = (sql: string) => unknown

/**
 * 修复 session_novel 的历史遗留外键。
 *
 * 早期 schema 中 session_novel 带有 `FOREIGN KEY (session_id) REFERENCES session(id)`，
 * 但 session 表只存在于 opennovel 存储库（opennovel.db），小说项目库（novel.db）中并没有。
 * Node 运行时（node:sqlite）在 prepare INSERT 时会解析外键父表，直接抛出
 * `no such table: main.session`，导致 system.transform 等 hook 整体失败；
 * Bun 运行时不做该解析所以此前未暴露。
 *
 * 检测到悬空外键时原地重建表（保留数据）去除该外键。迁移失败不阻塞 DB 打开。
 */
export function runMigrations(exec: ExecFn, query: QueryFn): void {
  // 1. 修复 session_novel 悬空外键
  try {
    const result = query("PRAGMA foreign_key_list(session_novel)")
    const fks = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const hasDanglingFk = fks.some((fk) => fk.table === "session")
    if (hasDanglingFk) {
      exec("BEGIN")
      try {
        exec("ALTER TABLE session_novel RENAME TO session_novel_legacy")
        exec(
          "CREATE TABLE session_novel (id text PRIMARY KEY, session_id text NOT NULL, novel_id text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE)",
        )
        exec(
          "INSERT INTO session_novel (id, session_id, novel_id, created_at) SELECT id, session_id, novel_id, created_at FROM session_novel_legacy",
        )
        exec("DROP TABLE session_novel_legacy")
        exec("COMMIT")
      } catch (error) {
        try {
          exec("ROLLBACK")
        } catch {
          // 回滚失败时忽略，保留现场便于排查
        }
        console.warn("[novel-store] session_novel migration failed:", error instanceof Error ? error.message : error)
      }
    }
  } catch {
    // session_novel 表不存在或 pragma 查询失败时跳过此迁移
  }

  // 2. 给 characters 表添加 status 列（始终执行，幂等）
  migrateCharacterStatus(exec, query)
}

/**
 * 给 characters 表添加 status 列（active / departed），用于角色退场生命周期。
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，先查 PRAGMA table_info 判断。
 */
function migrateCharacterStatus(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(characters)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const hasStatus = cols.some((c) => c.name === "status")
    if (!hasStatus) {
      exec("ALTER TABLE characters ADD COLUMN status text NOT NULL DEFAULT 'active'")
    }
  } catch {
    // characters 表不存在时无需迁移，CREATE_TABLES_SQL 会带 status 列创建
  }
}
