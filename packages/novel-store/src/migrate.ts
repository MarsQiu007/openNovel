import { countWords } from "@opennovel-ai/schema/schema"

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
  // 单表缺失（外部建表器只建了部分表）不应中断后续迁移链
  try {
    cleanupOrphanRows(exec)
  } catch {
    // 忽略：孤儿清理是优化项，列补齐才是正确性前提
  }

  // 列补齐优先于一切结构性迁移：novels 表可能由外部建表器（core 全局库迁移）以旧结构创建，
  // 必须先补齐列，后续任何对该表的读写才不会因缺列失败
  migrateNovelMasterOutline(exec, query)
  migrateNovelContentNature(exec, query)

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
  migrateCharacterStates(exec, query)
  migrateTechniqueScope(exec, query)
  migrateTechniqueEvidence(exec, query)

  // 4. 批注执行轮次：批注表加关联列，旧轮次表补状态与快照列
  migrateAnnotationExecutionRound(exec, query)
  migrateChapterOutline(exec, query)
  migrateAnnotationExecutionRoundColumns(exec, query)
  migrateVolumeOutline(exec, query)
  migrateStorySpine(exec, query)
  migrateSyncQueue(exec, query)
  migrateSourceFingerprints(exec, query)
  migrateStorySpineEntries(exec, query)
  migrateAnnotationEndParagraphIndex(exec, query)
  migrateUnifiedAnnotations(exec, query)
  migrateSyncQueueSource(exec, query)
  cleanupUpgradeQueueScope(exec)
  migrateChapterContentFingerprint(exec, query)
  migrateChapterWordCount(exec, query)
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
    "DELETE FROM annotations WHERE novel_id NOT IN (SELECT id FROM novels)",
    "DELETE FROM annotation_rounds WHERE novel_id NOT IN (SELECT id FROM novels)",
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

/**
 * 把角色状态重建为章节强绑定快照。状态记录脱离章节没有业务含义，
 * 旧表中缺少 chapter_id 的记录无法安全推断归属，迁移时按无效数据清理。
 */
function migrateCharacterStates(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(character_states)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const chapterColumn = cols.find((c) => c.name === "chapter_id")
    if (!chapterColumn || Number(chapterColumn.notnull) === 1) return
    exec("BEGIN")
    try {
      exec("DELETE FROM character_states WHERE chapter_id IS NULL OR chapter_id NOT IN (SELECT id FROM chapters)")
      exec("ALTER TABLE character_states RENAME TO character_states_legacy")
      exec(
        "CREATE TABLE character_states (id text PRIMARY KEY, character_id text NOT NULL, chapter_id text NOT NULL, active integer DEFAULT 1 NOT NULL, location text DEFAULT '' NOT NULL, mood text DEFAULT '' NOT NULL, summary text DEFAULT '' NOT NULL, FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE)",
      )
      exec(
        "INSERT INTO character_states (id, character_id, chapter_id, active, location, mood, summary) SELECT id, character_id, chapter_id, active, location, mood, summary FROM character_states_legacy",
      )
      exec("DROP TABLE character_states_legacy")
      exec("COMMIT")
    } catch (error) {
      try {
        exec("ROLLBACK")
      } catch {
        // 回滚失败时保留现场便于排查
      }
      console.warn("[novel-store] character_states migration failed:", error instanceof Error ? error.message : error)
    }
  } catch {
    // character_states 表不存在时无需迁移，CREATE_TABLES_SQL 会按新契约创建
  }
}

/**
 * 给 chapters 表添加 outline 列。旧项目的章纲正文存放在 Markdown 文件中；
 * 读取层负责懒导入，迁移只保证数据库有字段。
 */
function migrateChapterOutline(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(chapters)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    if (!cols.some((c) => c.name === "outline")) {
      exec("ALTER TABLE chapters ADD COLUMN outline text DEFAULT '' NOT NULL")
    }
  } catch {
    // chapters 表不存在时无需迁移，CREATE_TABLES_SQL 会带 outline 列创建
  }
}

/**
 * 给 chapter_annotations 表添加 execution_round_id 列（可空外键，指向 annotation_execution_rounds）。
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，先查 PRAGMA table_info 判断。
 */
function migrateAnnotationExecutionRound(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(chapter_annotations)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const hasCol = cols.some((c) => c.name === "execution_round_id")
    if (!hasCol) {
      exec("ALTER TABLE chapter_annotations ADD COLUMN execution_round_id text")
    }
  } catch {
    // chapter_annotations 表不存在时无需迁移，CREATE_TABLES_SQL 会带该列创建
  }
}

/**
 * 给旧版 annotation_execution_rounds 表补 status / annotations_snapshot / chapter_version_id 列。
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，先查 PRAGMA table_info 判断。
 */
function migrateAnnotationExecutionRoundColumns(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(annotation_execution_rounds)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const columns = new Set(cols.map((c) => String(c.name)))
    if (!columns.has("status")) {
      exec("ALTER TABLE annotation_execution_rounds ADD COLUMN status text NOT NULL DEFAULT 'running'")
    }
    if (!columns.has("annotations_snapshot")) {
      exec("ALTER TABLE annotation_execution_rounds ADD COLUMN annotations_snapshot text NOT NULL DEFAULT '[]'")
    }
    if (!columns.has("chapter_version_id")) {
      exec("ALTER TABLE annotation_execution_rounds ADD COLUMN chapter_version_id text")
    }
  } catch {
    // annotation_execution_rounds 表不存在时无需迁移，CREATE_TABLES_SQL 会带新列创建
  }
}

/**
 * 给 novels 表添加 master_outline 列。旧项目的总纲正文存放在 Markdown 文件中；
 * 读取层负责懒导入，迁移只保证数据库有字段。
 */
function migrateNovelMasterOutline(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(novels)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    if (!cols.some((c) => c.name === "master_outline")) {
      exec("ALTER TABLE novels ADD COLUMN master_outline text DEFAULT '' NOT NULL")
    }
  } catch {
    // novels 表不存在时无需迁移，CREATE_TABLES_SQL 会带 master_outline 列创建
  }
}

/**
 * 给 volumes 表添加 outline 列。旧项目的卷纲正文存放在 Markdown 文件中；
 * 读取层负责懒导入，迁移只保证数据库有字段。
 */
function migrateVolumeOutline(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(volumes)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    if (!cols.some((c) => c.name === "outline")) {
      exec("ALTER TABLE volumes ADD COLUMN outline text DEFAULT '' NOT NULL")
    }
  } catch {
    // volumes 表不存在时无需迁移，CREATE_TABLES_SQL 会带 outline 列创建
  }
}

/**
 * 给 novels 表添加 story_spine 列。旧数据该字段为 NULL（不渲染主轴段落）。
 */
function migrateStorySpine(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(novels)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    if (!cols.some((c) => c.name === "story_spine")) {
      exec("ALTER TABLE novels ADD COLUMN story_spine text")
    }
  } catch {
    // novels 表不存在时无需迁移，CREATE_TABLES_SQL 会带 story_spine 列创建
  }
}
/**
 * 新增手动编辑同步队列表（幂等，CREATE TABLE IF NOT EXISTS 已在 DDL 中处理）。
 * 仅需给 novels 表确认 story_spine 列已存在即可。
 */
function migrateSyncQueue(exec: ExecFn, query: QueryFn): void {
  // CREATE_TABLES_SQL 使用 IF NOT EXISTS，新库自动创建
  // 旧库迁移时 novel-store 的 createDb 会先执行 DDL，因此这里无需额外操作
  void exec
  void query
}

/**
 * 为派生数据表添加 source_fingerprint 可空列（幂等）。
 *
 * 旧数据缺少指纹列，列为 NULL，查询侧统一按"待校验"处理。
 */
function migrateSourceFingerprints(exec: ExecFn, query: QueryFn): void {
  const targets = [
    { table: "chapter_summaries", column: "source_fingerprint" },
    { table: "segment_summaries", column: "source_fingerprint" },
    { table: "entity_refs", column: "source_fingerprint" },
  ]
  for (const { table, column } of targets) {
    try {
      const result = query(`PRAGMA table_info(${table})`)
      const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
      if (cols.length > 0 && !cols.some((c) => c.name === column)) {
        exec(`ALTER TABLE ${table} ADD COLUMN ${column} text`)
      }
    } catch {
      // 表不存在时跳过，CREATE_TABLES_SQL 会在新库中带该列创建
    }
  }
}

/**
 * 结构化故事主轴条目表在 DDL 中已使用 IF NOT EXISTS 创建。
 * 旧 novels.story_spine 文本保留为兼容渲染缓存，不自动迁移，
 * 查询侧在结构化条目为空时回退读取旧文本并标记 status = "legacy"。
 */
function migrateStorySpineEntries(exec: ExecFn, query: QueryFn): void {
  void exec
  void query
}


/**
 * 为两张批注表添加 end_paragraph_index 可空列（幂等）。
 *
 * 跨段批注锚点的结束段落索引；为空表示单段批注，旧数据行为不变。
 */
function migrateAnnotationEndParagraphIndex(exec: ExecFn, query: QueryFn): void {
  const targets = [
    { table: "chapter_annotations", column: "end_paragraph_index" },
    { table: "world_entry_annotations", column: "end_paragraph_index" },
  ]
  for (const { table, column } of targets) {
    try {
      const result = query(`PRAGMA table_info(${table})`)
      const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
      if (cols.length > 0 && !cols.some((c) => c.name === column)) {
        exec(`ALTER TABLE ${table} ADD COLUMN ${column} integer`)
      }
    } catch {
      // 表不存在时跳过，CREATE_TABLES_SQL 会在新库中带该列创建
    }
  }
}


/**
 * 统一批注模型迁移：把四张旧批注/轮次表的数据一次性搬入 annotations / annotation_rounds。
 *
 * 映射规则：chapter_annotations → (chapter, chapter_id, content)；
 * world_entry_annotations → (world_entry, world_entry_id, content)；
 * 旧轮次表的 chapter_version_id / content_history_id 统一为 result_ref_id。
 * 保留原 ID 与 execution_round_id 关联；按目标表已有 ID 跳过实现幂等。
 * 旧表物理保留一个版本周期供回滚，代码不再读写。
 */
function migrateUnifiedAnnotations(exec: ExecFn, query: QueryFn): void {
  const tableExists = (name: string): boolean => {
    try {
      const result = query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`)
      return Array.isArray(result) && result.length > 0
    } catch {
      return false
    }
  }

  const copies: Array<{ from: string; sql: string }> = [
    {
      from: "chapter_annotations",
      sql: `INSERT INTO annotations (id, novel_id, parent_id, target_type, target_id, field, source, anchor_type, paragraph_index, start_offset, end_offset, end_paragraph_index, quote, comment, suggested_replacement, status, author_session_id, execution_round_id, created_at, updated_at)
        SELECT id, novel_id, parent_id, 'chapter', chapter_id, 'content', source, anchor_type, paragraph_index, start_offset, end_offset, end_paragraph_index, quote, comment, suggested_replacement, status, author_session_id, execution_round_id, created_at, updated_at
        FROM chapter_annotations WHERE id NOT IN (SELECT id FROM annotations)`,
    },
    {
      from: "world_entry_annotations",
      sql: `INSERT INTO annotations (id, novel_id, parent_id, target_type, target_id, field, source, anchor_type, paragraph_index, start_offset, end_offset, end_paragraph_index, quote, comment, suggested_replacement, status, author_session_id, execution_round_id, created_at, updated_at)
        SELECT id, novel_id, parent_id, 'world_entry', world_entry_id, 'content', source, anchor_type, paragraph_index, start_offset, end_offset, end_paragraph_index, quote, comment, suggested_replacement, status, author_session_id, execution_round_id, created_at, updated_at
        FROM world_entry_annotations WHERE id NOT IN (SELECT id FROM annotations)`,
    },
    {
      from: "annotation_execution_rounds",
      sql: `INSERT INTO annotation_rounds (id, novel_id, target_type, target_id, prompt_snapshot, status, annotations_snapshot, result_summary, result_ref_id, created_at)
        SELECT id, novel_id, 'chapter', chapter_id, prompt_snapshot, status, annotations_snapshot, result_summary, chapter_version_id, created_at
        FROM annotation_execution_rounds WHERE id NOT IN (SELECT id FROM annotation_rounds)`,
    },
    {
      from: "world_entry_annotation_rounds",
      sql: `INSERT INTO annotation_rounds (id, novel_id, target_type, target_id, prompt_snapshot, status, annotations_snapshot, result_summary, result_ref_id, created_at)
        SELECT id, novel_id, 'world_entry', world_entry_id, prompt_snapshot, status, annotations_snapshot, result_summary, content_history_id, created_at
        FROM world_entry_annotation_rounds WHERE id NOT IN (SELECT id FROM annotation_rounds)`,
    },
  ]

  // 批注 parent_id 自引用外键按行即时校验，INSERT...SELECT 不保证父行先于子行写入，
  // 搬移期间临时关闭外键检查，结束后恢复
  try {
    exec("PRAGMA foreign_keys = OFF")
  } catch {
    // pragma 失败时按原状继续，失败会在下方逐表捕获
  }
  for (const { from, sql } of copies) {
    if (!tableExists(from)) continue
    try {
      exec(sql)
    } catch (error) {
      // 单表搬移失败不阻塞 DB 打开，下次打开会按幂等规则重试
      console.warn(`[novel-store] unified annotation migration skipped ${from}:`, error instanceof Error ? error.message : error)
    }
  }
  try {
    exec("PRAGMA foreign_keys = ON")
  } catch {
    // 恢复失败不阻塞 DB 打开
  }

  // 清理目标实体已不存在的孤儿批注与轮次（旧库可能在外键关闭期删除过章节/条目）
  const orphanCleanup = [
    "DELETE FROM annotations WHERE target_type='chapter' AND target_id NOT IN (SELECT id FROM chapters)",
    "DELETE FROM annotations WHERE target_type='world_entry' AND target_id NOT IN (SELECT id FROM world_entries)",
    "DELETE FROM annotation_rounds WHERE target_type='chapter' AND target_id NOT IN (SELECT id FROM chapters)",
    "DELETE FROM annotation_rounds WHERE target_type='world_entry' AND target_id NOT IN (SELECT id FROM world_entries)",
  ]
  for (const sql of orphanCleanup) {
    try {
      exec(sql)
    } catch {
      // 表不存在时跳过（全新库由 CREATE_TABLES_SQL 建表后此处为 0 行操作）
    }
  }
}

/**
 * 同步队列表添加 source 可空来源列（幂等，向后兼容）。
 *
 * 旧行回填 'manual'；升级任务写入 'upgrade'。列带 NOT NULL DEFAULT，
 * SQLite 加列时自动填充默认值。
 */
function migrateSyncQueueSource(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(manual_edit_sync_queue)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    if (cols.length > 0 && !cols.some((c) => c.name === "source")) {
      exec("ALTER TABLE manual_edit_sync_queue ADD COLUMN source text NOT NULL DEFAULT 'manual'")
    }
    exec("CREATE INDEX IF NOT EXISTS manual_edit_sync_queue_source_idx ON manual_edit_sync_queue(novel_id, source)")
  } catch {
    // 表不存在时跳过，CREATE_TABLES_SQL 会在新库中带该列创建
  }
}

/**
 * 清理升级队列中跨书错绑的章节任务。
 *
 * 历史升级实现曾把其他书的章节 ID 写入当前书的 upgrade 队列，
 * worker 消费时会因章节归属不匹配失败。这里在 source 列迁移后删除
 * 这些无效记录，保留章节归属正确的任务。
 */
function cleanupUpgradeQueueScope(exec: ExecFn): void {
  try {
    exec(`
      DELETE FROM manual_edit_sync_queue
      WHERE source = 'upgrade'
        AND entity = 'chapter'
        AND entity_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM chapters
          WHERE chapters.id = manual_edit_sync_queue.entity_id
            AND chapters.novel_id = manual_edit_sync_queue.novel_id
        )
    `)
  } catch {
    // 表或列不存在时跳过，后续 schema 迁移完成后的下次打开会重试
  }
}

/**
 * chapters 表添加 content_fingerprint 可空列（幂等）。
 *
 * 正文指纹基准（derived-data-upgrade Phase 1 回填）；列为 NULL 表示
 * 尚未建立基准，打开旧书不影响任何现有行为。
 */
function migrateChapterContentFingerprint(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(chapters)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    if (cols.length > 0 && !cols.some((c) => c.name === "content_fingerprint")) {
      exec("ALTER TABLE chapters ADD COLUMN content_fingerprint text")
    }
  } catch {
    // 表不存在时跳过，CREATE_TABLES_SQL 会在新库中带该列创建
  }
}

/**
 * 给 techniques 表添加 scope 列（内容性质：general/adult，默认 general）。
 * 始终执行、幂等：旧行零迁移可读，新库由 CREATE_TABLES_SQL 带列建表。
 */
export function migrateTechniqueScope(exec: ExecFn, query: QueryFn): void {
  try {
    const result = query("PRAGMA table_info(techniques)")
    const cols = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const hasScope = cols.some((c) => c.name === "scope")
    if (!hasScope) {
      exec("ALTER TABLE techniques ADD COLUMN scope text NOT NULL DEFAULT 'general'")
    }
  } catch {
    // techniques 表不存在时无需迁移，CREATE_TABLES_SQL 会带 scope 列创建
  }
}

/**
 * novels 表新增 content_nature 列 + 存量书一次性置位。
 *
 * 书级内容性质的唯一持久化来源（'general' | 'adult'，默认 'general'）。
 * 幂等：ALTER 与置位均只在"检测到无列"的当次执行，重复建连为纯 no-op；
 * 用户后续显式改回的值永远不会被置位翻转。注册顺序须在 migrateTechniqueScope 之后
 * （置位依赖 techniques.scope 列已就绪；旧库 scope 默认 general，因此旧库本次全部落 general）。
 * novels/techniques 表不存在时跳过（全局库无 novels 表）。
 */
export function migrateNovelContentNature(exec: ExecFn, query: QueryFn): void {
  // 全局库无 novels 表，显式查表存在性（PRAGMA 对缺失表返回空结果而不抛错）
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name='novels'")
  if (!Array.isArray(tables) || tables.length === 0) return
  try {
    const result = query("PRAGMA table_info(novels)")
    const cols = Array.isArray(result) ? result : []
    const hasNature = cols.some((c) => typeof c === "object" && c !== null && "name" in c && c.name === "content_nature")
    if (hasNature) return // 置位仅在加列当次执行：天然一次性，重复建连不会翻转用户后续显式改回的值
    exec("ALTER TABLE novels ADD COLUMN content_nature text NOT NULL DEFAULT 'general'")
    const techTables = query("SELECT name FROM sqlite_master WHERE type='table' AND name='techniques'")
    const hasTechniques = Array.isArray(techTables) && techTables.length > 0
    if (hasTechniques) {
      exec(
        "UPDATE novels SET content_nature='adult' WHERE EXISTS (SELECT 1 FROM techniques WHERE scope='adult')",
      )
    }
  } catch {
    // 加列/置位失败不阻塞 DB 打开：读列 helper 对缺列从紧回落 general，检测确认条可事后兜住
  }
}

/**
 * 证据元素补全规则判定：元素为对象时给出按规则回填后的字段与是否发生实际写入。
 *
 * 规则（与入库校验单一事实源，normalizeTechniqueEvidence 复用）：
 * sourceTitle 缺失（含 null/非字符串值）时取该元素的 sourceLocation，其余缺失字符串字段补空串。
 */
export type EvidenceElementInspection =
  | { kind: "not_object" }
  | { kind: "object"; element: Record<string, unknown>; changed: boolean }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function inspectEvidenceElement(element: unknown): EvidenceElementInspection {
  if (!isPlainRecord(element)) return { kind: "not_object" }
  const sourceLocation = typeof element.sourceLocation === "string" ? element.sourceLocation : ""
  const filled = {
    sourceTitle: typeof element.sourceTitle === "string" ? element.sourceTitle : sourceLocation,
    sourceLocation,
    excerpt: typeof element.excerpt === "string" ? element.excerpt : "",
    annotation: typeof element.annotation === "string" ? element.annotation : "",
  }
  const changed =
    filled.sourceTitle !== element.sourceTitle ||
    filled.sourceLocation !== element.sourceLocation ||
    filled.excerpt !== element.excerpt ||
    filled.annotation !== element.annotation
  return { kind: "object", element: filled, changed }
}

/**
 * techniques 证据条目补全（幂等迁移，书库与全局库建连统一执行）。
 *
 * save_technique 直写 DB 绕过协议校验，历史行 evidence 元素缺 sourceTitle 等必填
 * 字段，导致管理接口响应编码失败。逐行解析回填：仅当有字段实际写入时才 UPDATE，
 * 重复建连为纯 no-op、不回写已有非空值。evidence JSON 整体损坏或元素非对象时
 * 跳过该行（文件级损坏应显式暴露，由列表行级容错兜底跳过）。
 * 全局库 techniques 表结构与书库一致，仅操作该表天然安全。
 */
export function migrateTechniqueEvidence(exec: ExecFn, query: QueryFn): void {
  try {
    const rows = query("SELECT id, evidence FROM techniques")
    if (!Array.isArray(rows)) return
    rows.forEach((row) => {
      if (typeof row !== "object" || row === null) return
      const raw = "evidence" in row ? row.evidence : null
      if (typeof raw !== "string") return
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      if (!Array.isArray(parsed)) return
      let changed = false
      const filled = parsed.map((element) => {
        const result = inspectEvidenceElement(element)
        if (result.kind === "not_object") return element
        if (result.changed) changed = true
        return result.element
      })
      if (!changed) return
      const json = JSON.stringify(filled).replace(/'/g, "''")
      const id = String(row.id).replace(/'/g, "''")
      exec(`UPDATE techniques SET evidence = '${json}' WHERE id = '${id}'`)
    })
  } catch {
    // techniques 表不存在或迁移失败时不阻塞 DB 打开
  }
}

/**
 * 按网文字数口径重算历史 word_count（汉字逐字 + 英文/数字按词，不含标点/空白/换行）。
 *
 * 早期部分写入路径按 content.length（UTF-16 全字符，含标点空白）落库，与写作管线
 * countWords 口径不一致，表现为同一章阅读/编辑/侧边栏字数分歧。逐行重算 chapters
 * 与 chapter_versions 两表：仅当重算值与现值不同才 UPDATE，重复建连零写入（幂等）。
 * 全局库（opennovel.db）无 chapters 表，查 sqlite_master 存在性后整体跳过。
 * 失败不阻塞 DB 打开。
 */
export function migrateChapterWordCount(exec: ExecFn, query: QueryFn): void {
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chapters', 'chapter_versions')")
  const names = Array.isArray(tables)
    ? tables
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => t.name)
    : []
  if (!names.includes("chapters")) return
  try {
    for (const table of ["chapters", "chapter_versions"]) {
      if (!names.includes(table)) continue
      const rows = query("SELECT id, content, word_count FROM " + table)
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (typeof row !== "object" || row === null) continue
        const id = "id" in row ? row.id : null
        const content = "content" in row ? row.content : null
        const current = "word_count" in row ? row.word_count : null
        if (typeof id !== "string" || typeof content !== "string" || typeof current !== "number") continue
        const recomputed = countWords(content)
        if (recomputed === current) continue
        exec("UPDATE " + table + " SET word_count = " + recomputed + " WHERE id = '" + id.replace(/'/g, "''") + "'")
      }
    }
  } catch {
    // 重算失败不阻塞 DB 打开
  }
}
