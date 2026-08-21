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
  // 1. 清理历史遗留孤儿行（早期 bun 驱动未开启外键，删除小说后子表数据全部残留）。
  //    必须先于 session_novel 重建执行——重建时的 INSERT...SELECT 在外键开启下
  //    遇到孤儿绑定行会违反 novels(id) 外键导致回滚。
  cleanupOrphanRows(exec)

  // 2. 修复 session_novel 悬空外键
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
        // 过滤孤儿绑定（novel_id 已不存在）：外键开启下 INSERT 会违反 novels(id) 约束导致回滚
        exec(
          "INSERT INTO session_novel (id, session_id, novel_id, created_at) SELECT id, session_id, novel_id, created_at FROM session_novel_legacy WHERE novel_id IN (SELECT id FROM novels)",
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

  // 3. 给 characters 表添加 status 列（始终执行，幂等）
  migrateCharacterStatus(exec, query)
}

/**
 * 清理父行已不存在的孤儿数据。
 *
 * 历史背景：bun:sqlite 默认不启用外键约束，各表的 ON DELETE CASCADE 长期失效，
 * 删除小说/章节/角色/卷后子表数据残留。驱动层现已统一开启 PRAGMA foreign_keys，
 * 本迁移负责清理存量孤儿行（ deepest-first 顺序，幂等，常规情况下全为 0 行操作）。
 */
function cleanupOrphanRows(exec: ExecFn): void {
  const statements = [
    // 孙层：父表为 chapters / characters / volumes
    "DELETE FROM chapter_versions WHERE chapter_id NOT IN (SELECT id FROM chapters)",
    "DELETE FROM chapter_reviews WHERE chapter_id NOT IN (SELECT id FROM chapters)",
    "DELETE FROM chapter_summaries WHERE chapter_id NOT IN (SELECT id FROM chapters)",
    "DELETE FROM character_states WHERE character_id NOT IN (SELECT id FROM characters)",
    "DELETE FROM character_states WHERE chapter_id IS NOT NULL AND chapter_id NOT IN (SELECT id FROM chapters)",
    "DELETE FROM volume_summaries WHERE volume_id NOT IN (SELECT id FROM volumes)",
    // 子层：父表为 novels
    "DELETE FROM volumes WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM chapters WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM characters WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM foreshadowing WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM novel_state_log WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM plot_threads WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM relationships WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM session_novel WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM style_guide WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM soul WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM world_entries WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM tension_log WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM hook_rotation WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM entity_refs WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM pending_updates WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM saga_sessions WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM description_history WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM story_arcs WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM arc_beats WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM volume_reviews WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM editorial_reports WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM chapter_annotations WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM outline_canvas_layout WHERE novel_id NOT IN (SELECT id FROM novels)",
  ]
  try {
    // 逐条执行：带悬空外键的旧表（如指向不存在 session 表的 session_novel）
    // 在外键开启下无法执行 DELETE，跳过交给后续重建迁移处理，不影响其他表清理
    for (const sql of statements) {
      try {
        exec(sql)
      } catch {
        // 跳过失败语句
      }
    }
  } catch (error) {
    // 清理失败不阻塞 DB 打开
    console.warn("[novel-store] orphan cleanup failed:", error instanceof Error ? error.message : error)
  }
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
