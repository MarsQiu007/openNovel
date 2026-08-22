/**
 * 会话存储 — 小说项目 DB / session 绑定边界
 *
 * 负责：表定义、DB 路径解析、schema 初始化、per-path Drizzle 缓存、
 * 会话标记（tagNovelSession / getNovelForSession / isNovelSession）、
 * 以及懒绑定（resolveNovelForSession）。
 *
 * 不持有任何 hook 或 tool 注册逻辑。
 */
import { eq, and, or, asc, desc, isNull } from "drizzle-orm"
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { createDb, type Db } from "#driver"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"

// ─── DDL 表定义 ───

export const SessionNovelTable = sqliteTable(
  "session_novel",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    novel_id: text().notNull(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("session_novel_session_id_idx").on(table.session_id),
    index("session_novel_novel_id_idx").on(table.novel_id),
  ],
)

export const NovelTable = sqliteTable("novels", {
  id: text().primaryKey(),
  title: text().notNull(),
  genre: text().notNull(),
  synopsis: text().notNull().default(""),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
  status: text().notNull().default("draft"),
})

export const CharacterTable = sqliteTable("characters", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  name: text().notNull(),
  role: text().notNull().default(""),
  description: text().notNull().default(""),
  status: text().notNull().default("active"),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const VolumeTable = sqliteTable("volumes", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  title: text().notNull(),
  summary: text().notNull().default(""),
  order: integer().notNull(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const ChapterTable = sqliteTable("chapters", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  volume_id: text(),
  title: text().notNull(),
  content: text().notNull().default(""),
  word_count: integer().notNull().default(0),
  status: text().notNull().default("draft"),
  order: integer().notNull(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const ChapterVersionTable = sqliteTable("chapter_versions", {
  id: text().primaryKey(),
  chapter_id: text().notNull(),
  version: integer().notNull(),
  content: text().notNull(),
  word_count: integer().notNull().default(0),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  created_by: text().notNull(),
})

export const ChapterReviewTable = sqliteTable("chapter_reviews", {
  id: text().primaryKey(),
  chapter_id: text().notNull(),
  round: integer().notNull(),
  source: text().notNull(),
  overall: text().notNull(),
  pass_count: integer().notNull().default(0),
  warn_count: integer().notNull().default(0),
  fail_count: integer().notNull().default(0),
  dimensions: text().notNull().default("[]"),
  summary: text().notNull().default(""),
  session_id: text(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const CharacterStateTable = sqliteTable("character_states", {
  id: text().primaryKey(),
  character_id: text().notNull(),
  chapter_id: text(),
  active: integer().notNull().default(1),
  location: text().notNull().default(""),
  mood: text().notNull().default(""),
  summary: text().notNull().default(""),
})

export const RelationshipTable = sqliteTable("relationships", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  char_a_id: text().notNull(),
  char_b_id: text().notNull(),
  type: text().notNull().default(""),
  description: text().notNull().default(""),
})

export const PlotThreadTable = sqliteTable("plot_threads", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  title: text().notNull(),
  status: text().notNull().default("open"),
  priority: text().notNull().default("medium"),
  description: text().notNull().default(""),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  closed_at: integer(),
})

export const ForeshadowingTable = sqliteTable("foreshadowing", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  planted_chapter_id: text(),
  resolved_chapter_id: text(),
  content: text().notNull(),
  state: text().notNull().default("planted"),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const WorldEntryTable = sqliteTable("world_entries", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  category: text().notNull().default(""),
  title: text().notNull(),
  content: text().notNull().default(""),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const ChapterSummaryTable = sqliteTable("chapter_summaries", {
  id: text().primaryKey(),
  chapter_id: text().notNull(),
  summary: text().notNull().default(""),
  key_events: text({ mode: "json" }).notNull().default("[]"),
  char_changes: text({ mode: "json" }).notNull().default("[]"),
})

export const StyleGuideTable = sqliteTable("style_guide", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  rules: text({ mode: "json" }).notNull().default("{}"),
  tone: text().notNull().default(""),
  pov: text().notNull().default(""),
  tense: text().notNull().default(""),
})

export const SoulTable = sqliteTable("soul", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  content: text().notNull().default(""),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const VolumeSummaryTable = sqliteTable("volume_summaries", {
  id: text().primaryKey(),
  volume_id: text().notNull(),
  summary: text().notNull().default(""),
  char_active: text({ mode: "json" }).notNull().default("[]"),
  char_dormant: text({ mode: "json" }).notNull().default("[]"),
  threads_open: text({ mode: "json" }).notNull().default("[]"),
  threads_closed: text({ mode: "json" }).notNull().default("[]"),
})

export const NovelStateLogTable = sqliteTable(
  "novel_state_log",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    chapter_id: text(),
    fact_type: text().notNull(),
    fact_data: text({ mode: "json" }).notNull(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("novel_state_log_novel_id_idx").on(table.novel_id),
    index("novel_state_log_chapter_id_idx").on(table.chapter_id),
    index("novel_state_log_fact_type_idx").on(table.novel_id, table.fact_type),
  ],
)

export const TensionLogTable = sqliteTable("tension_log", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  chapter_number: integer().notNull(),
  level: real().notNull(),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const HookRotationTable = sqliteTable(
  "hook_rotation",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    hook_type: text().notNull(),
    chapter_id: text(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("hook_rotation_novel_id_idx").on(table.novel_id),
    index("hook_rotation_created_at_idx").on(table.novel_id, table.created_at),
  ],
)

export const EntityRefTable = sqliteTable(
  "entity_refs",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    source_type: text().notNull(),
    source_id: text().notNull(),
    target_type: text().notNull(),
    target_id: text().notNull(),
    ref_field: text().notNull(),
    ref_text: text().notNull().default(""),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("entity_refs_target_idx").on(table.target_type, table.target_id),
    index("entity_refs_source_idx").on(table.source_type, table.source_id),
  ],
)

export const PendingUpdateTable = sqliteTable(
  "pending_updates",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    source_type: text().notNull(),
    source_id: text().notNull(),
    trigger_type: text().notNull(),
    trigger_id: text().notNull(),
    trigger_field: text().notNull().default(""),
    old_value: text().notNull().default(""),
    new_value: text().notNull().default(""),
    reason: text().notNull().default(""),
    status: text().notNull().default("pending"),
    priority: text().notNull().default("medium"),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    resolved_at: integer(),
  },
  (table) => [
    index("pending_updates_novel_id_idx").on(table.novel_id),
    index("pending_updates_status_idx").on(table.novel_id, table.status),
  ],
)

export const SagaSessionTable = sqliteTable(
  "saga_sessions",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    trigger_type: text().notNull(),
    trigger_id: text().notNull(),
    trigger_field: text().notNull().default(""),
    old_value: text().notNull().default(""),
    new_value: text().notNull().default(""),
    reason: text().notNull().default(""),
    status: text().notNull().default("started"),
    total_tasks: integer().notNull().default(0),
    completed_tasks: integer().notNull().default(0),
    failed_tasks: integer().notNull().default(0),
    current_task_id: text(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    updated_at: integer()
      .notNull()
      .$default(() => Date.now()),
    completed_at: integer(),
  },
  (table) => [
    index("saga_sessions_novel_id_idx").on(table.novel_id),
    index("saga_sessions_status_idx").on(table.novel_id, table.status),
  ],
)

export const DescriptionHistoryTable = sqliteTable(
  "description_history",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    entity_type: text().notNull(),
    entity_id: text().notNull(),
    field: text().notNull().default("description"),
    old_value: text().notNull().default(""),
    new_value: text().notNull().default(""),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("description_history_entity_idx").on(table.entity_type, table.entity_id)],
)

/**
 * 候选设定表 — observer 提取的"重要性不足"或"关系强度不足"的实体暂存这里。
 * 候选区是"半自动"反向设定的关键：避免 LLM 一次性污染 P5 设定层。
 *
 * 候选来源：
 * - character / world_entry / location 的 importance=1（次要设定，候选）
 * - relationship 的 type_strength="weak"（弱关系，候选）
 * - importance=0 / 一次性提及不入候选区，只入 chapter_summary.key_events
 *
 * 状态机：pending（初始）→ accepted（director 确认入库）| rejected（丢弃）| merged（合并到另一正式条目）
 */
export const PendingSettingTable = sqliteTable(
  "pending_settings",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    /** 候选类型：character / world_entry / location / relationship */
    candidate_type: text().notNull(),
    /** 来源章节 ID（从哪一章提取出来的） */
    source_chapter_id: text(),
    /** 完整的 entity_id 建议（如 char_xxx / world_xxx / rel_xxx_yyy） */
    suggested_entity_id: text().notNull().default(""),
    /** 候选 payload（JSON 字符串，accept 时按字段写入正式表） */
    payload_json: text().notNull().default("{}"),
    /** 候选重要性：1-3（observer 评的，0 不入候选区） */
    importance: integer().notNull().default(1),
    /** 关系强度：strong / weak（仅 relationship 类型有意义） */
    type_strength: text().default(""),
    /** 候选标题（用于显示和去重） */
    display_title: text().notNull().default(""),
    /** 状态：pending / accepted / rejected / merged */
    status: text().notNull().default("pending"),
    /** 合并目标 ID（status=merged 时记录被合并到哪个正式条目） */
    merged_into: text().default(""),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    resolved_at: integer(),
  },
  (table) => [
    index("pending_settings_novel_idx").on(table.novel_id, table.status),
    index("pending_settings_title_idx").on(table.novel_id, table.display_title),
  ],
)

/**
 * 世界观冲突表 — observer 提的 ⚠️ 冲突标注单独存这里，**不污染** WorldEntryTable.content。
 * 解决之前 task 14 的副作用：冲突标注写到 content 末尾，下次 writer 在 P5 看到污染的设定。
 *
 * 字段：
 * - world_entry_id：被冲突的条目（已入库或候选）
 * - conflict_note：冲突描述
 * - source_chapter_id：从哪一章发现冲突
 * - resolved：是否已由用户审阅
 */
export const WorldEntryConflictTable = sqliteTable(
  "world_entry_conflicts",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    /** 冲突涉及的 world_entry ID（可能指向正式表也可能指向候选表） */
    world_entry_id: text().notNull(),
    /** 冲突类型：number_inconsistency（同 category 数字冲突）| synonym_drift（跨 category 同义）| semantic_conflict（语义冲突） */
    conflict_kind: text().notNull().default("semantic_conflict"),
    /** 冲突来源：observer (自动提取) | user_report (用户报告) */
    source: text().notNull().default("observer"),
    source_chapter_id: text(),
    conflict_note: text().notNull().default(""),
    resolved: integer().notNull().default(0),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("world_entry_conflicts_novel_idx").on(table.novel_id, table.resolved)],
)

// ─── B/C 阶段：结构质量与协作体验 ───

export const StoryArcTable = sqliteTable(
  "story_arcs",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    arc_type: text().notNull(),
    title: text().notNull(),
    summary: text().notNull().default(""),
    status: text().notNull().default("planned"),
    target_character_id: text(),
    planned_start_chapter: integer(),
    planned_end_chapter: integer(),
    actual_start_chapter: integer(),
    actual_end_chapter: integer(),
    created_at: integer().notNull().$default(() => Date.now()),
    updated_at: integer().notNull().$default(() => Date.now()),
  },
  (table) => [
    index("story_arcs_novel_id_idx").on(table.novel_id),
    index("story_arcs_arc_type_idx").on(table.novel_id, table.arc_type),
  ],
)

export const ArcBeatTable = sqliteTable(
  "arc_beats",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    arc_id: text().notNull(),
    chapter_id: text(),
    chapter_order: integer(),
    label: text().notNull(),
    kind: text().notNull().default("note"),
    summary: text().notNull().default(""),
    status: text().notNull().default("planned"),
    created_at: integer().notNull().$default(() => Date.now()),
    updated_at: integer().notNull().$default(() => Date.now()),
  },
  (table) => [
    index("arc_beats_arc_id_idx").on(table.arc_id),
    index("arc_beats_novel_chapter_idx").on(table.novel_id, table.chapter_order),
    index("arc_beats_chapter_id_idx").on(table.chapter_id),
  ],
)

export const VolumeReviewTable = sqliteTable(
  "volume_reviews",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    volume_id: text().notNull(),
    round: integer().notNull(),
    overall: text().notNull().default(""),
    score: real(),
    strengths_json: text().notNull().default("[]"),
    weaknesses_json: text().notNull().default("[]"),
    structure_json: text().notNull().default("{}"),
    character_arcs_json: text().notNull().default("[]"),
    open_threads_json: text().notNull().default("[]"),
    recommendations_json: text().notNull().default("[]"),
    created_at: integer().notNull().$default(() => Date.now()),
  },
  (table) => [
    index("volume_reviews_volume_id_idx").on(table.volume_id, table.round),
    index("volume_reviews_novel_id_idx").on(table.novel_id),
  ],
)

export const EditorialReportTable = sqliteTable(
  "editorial_reports",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    scope_type: text().notNull().default("book"),
    scope_id: text(),
    summary: text().notNull().default(""),
    risks_json: text().notNull().default("[]"),
    recommendations_json: text().notNull().default("[]"),
    created_at: integer().notNull().$default(() => Date.now()),
  },
  (table) => [index("editorial_reports_novel_id_idx").on(table.novel_id, table.created_at)],
)

export const ChapterAnnotationTable = sqliteTable(
  "chapter_annotations",
  {
    id: text().primaryKey(),
    novel_id: text().notNull(),
    chapter_id: text().notNull(),
    parent_id: text(),
    source: text().notNull().default("user"),
    anchor_type: text().notNull().default("paragraph"),
    paragraph_index: integer(),
    start_offset: integer(),
    end_offset: integer(),
    quote: text().notNull().default(""),
    comment: text().notNull().default(""),
    suggested_replacement: text(),
    status: text().notNull().default("open"),
    author_session_id: text(),
    created_at: integer().notNull().$default(() => Date.now()),
    updated_at: integer().notNull().$default(() => Date.now()),
  },
  (table) => [
    index("chapter_annotations_chapter_id_idx").on(table.chapter_id, table.status),
    index("chapter_annotations_novel_id_idx").on(table.novel_id),
  ],
)

export const OutlineCanvasLayoutTable = sqliteTable("outline_canvas_layout", {
  novel_id: text().primaryKey(),
  layout_json: text({ mode: "json" }).notNull().default("{}"),
  updated_at: integer().notNull().$default(() => Date.now()),
})

export const TechniqueTable = sqliteTable("techniques", {
  id: text().primaryKey(),
  name: text().notNull(),
  principle: text().notNull(),
  instruction: text().notNull(),
  scene_types: text().notNull().default("[]"),
  level: text().notNull(),
  evidence: text().notNull().default("[]"),
  common_misuse: text().notNull().default(""),
  confidence: real().notNull().default(0.5),
  status: text().notNull().default("unverified"),
  embedding: text(),
  usage_count: integer().notNull().default(0),
  last_used_at: integer(),
  created_at: integer().notNull().$default(() => Date.now()),
  updated_at: integer().notNull().$default(() => Date.now()),
}, (table) => [
  index("technique_status_idx").on(table.status),
  index("technique_level_idx").on(table.level),
])

export const TechniqueFeedbackTable = sqliteTable("technique_feedback", {
  id: text().primaryKey(),
  technique_id: text().notNull(),
  chapter_id: text().notNull(),
  score: real().notNull(),
  was_used: integer().notNull().default(0),
  comment: text().notNull().default(""),
  created_at: integer().notNull().$default(() => Date.now()),
}, (table) => [
  index("technique_feedback_technique_id_idx").on(table.technique_id),
  index("technique_feedback_chapter_id_idx").on(table.chapter_id),
])

export const TechniqueShadowLogTable = sqliteTable("technique_shadow_log", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  chapter_number: integer().notNull(),
  scene_type: text().notNull(),
  query_text: text().notNull().default(""),
  retrieved_technique_ids: text().notNull().default("[]"),
  retrieved_technique_names: text().notNull().default("[]"),
  created_at: integer().notNull().$default(() => Date.now()),
}, (table) => [
  index("technique_shadow_log_novel_id_idx").on(table.novel_id),
])


// ─── DB 路径解析 ───

/**
 * 获取项目级数据库路径 - 每个小说项目独立数据库，实现完全隔离。
 *
 * 优先级：OPENNOVEL_DB 显式指定 > PluginInput.directory 推导 > process.cwd() 兜底。
 */
export function getDbPath(directory?: string | null): string {
  const env = process.env.OPENNOVEL_DB
  if (env) return env
  const base = directory ?? process.cwd()
  return join(base, ".novel", "novel.db")
}

// ─── Schema 初始化 ───

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS novels (id text PRIMARY KEY, title text NOT NULL, genre text NOT NULL, synopsis text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, status text DEFAULT 'draft' NOT NULL);
CREATE TABLE IF NOT EXISTS volumes (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, summary text DEFAULT '' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS chapters (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text, title text NOT NULL, content text DEFAULT '' NOT NULL, word_count integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, "order" integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS chapter_versions (id text PRIMARY KEY, chapter_id text NOT NULL, version integer NOT NULL, content text NOT NULL, word_count integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, created_by text NOT NULL, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS chapter_reviews (id text PRIMARY KEY, chapter_id text NOT NULL, round integer NOT NULL, source text NOT NULL, overall text NOT NULL, pass_count integer DEFAULT 0 NOT NULL, warn_count integer DEFAULT 0 NOT NULL, fail_count integer DEFAULT 0 NOT NULL, dimensions text DEFAULT '[]' NOT NULL, summary text DEFAULT '' NOT NULL, session_id text, created_at integer NOT NULL, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS chapter_reviews_chapter_idx ON chapter_reviews(chapter_id, round);
CREATE TABLE IF NOT EXISTS characters (id text PRIMARY KEY, novel_id text NOT NULL, name text NOT NULL, role text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, status text DEFAULT 'active' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS character_states (id text PRIMARY KEY, character_id text NOT NULL, chapter_id text, active integer DEFAULT 1 NOT NULL, location text DEFAULT '' NOT NULL, mood text DEFAULT '' NOT NULL, summary text DEFAULT '' NOT NULL, FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS chapter_summaries (id text PRIMARY KEY, chapter_id text NOT NULL, summary text DEFAULT '' NOT NULL, key_events text DEFAULT '[]' NOT NULL, char_changes text DEFAULT '[]' NOT NULL, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS foreshadowing (id text PRIMARY KEY, novel_id text NOT NULL, planted_chapter_id text, resolved_chapter_id text, content text NOT NULL, state text DEFAULT 'planted' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (planted_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL, FOREIGN KEY (resolved_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS novel_state_log (id text PRIMARY KEY, novel_id text NOT NULL, chapter_id text, fact_type text NOT NULL, fact_data text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS plot_threads (id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, status text DEFAULT 'open' NOT NULL, priority text DEFAULT 'medium' NOT NULL, description text DEFAULT '' NOT NULL, created_at integer NOT NULL, closed_at integer, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS relationships (id text PRIMARY KEY, novel_id text NOT NULL, char_a_id text NOT NULL, char_b_id text NOT NULL, type text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (char_a_id) REFERENCES characters(id) ON DELETE CASCADE, FOREIGN KEY (char_b_id) REFERENCES characters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS session_novel (id text PRIMARY KEY, session_id text NOT NULL, novel_id text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS style_guide (id text PRIMARY KEY, novel_id text NOT NULL, rules text DEFAULT '{}' NOT NULL, tone text DEFAULT '' NOT NULL, pov text DEFAULT '' NOT NULL, tense text DEFAULT '' NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS soul (id text PRIMARY KEY, novel_id text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS volume_summaries (id text PRIMARY KEY, volume_id text NOT NULL, summary text DEFAULT '' NOT NULL, char_active text DEFAULT '[]' NOT NULL, char_dormant text DEFAULT '[]' NOT NULL, threads_open text DEFAULT '[]' NOT NULL, threads_closed text DEFAULT '[]' NOT NULL, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS world_entries (id text PRIMARY KEY, novel_id text NOT NULL, category text DEFAULT '' NOT NULL, title text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS tension_log (id text PRIMARY KEY, novel_id text NOT NULL, chapter_number integer NOT NULL, level real NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pending_settings (id text PRIMARY KEY, novel_id text NOT NULL, candidate_type text NOT NULL, source_chapter_id text, suggested_entity_id text DEFAULT '' NOT NULL, payload_json text DEFAULT '{}' NOT NULL, importance integer DEFAULT 1 NOT NULL, type_strength text DEFAULT '' NOT NULL, display_title text DEFAULT '' NOT NULL, status text DEFAULT 'pending' NOT NULL, merged_into text DEFAULT '' NOT NULL, created_at integer NOT NULL, resolved_at integer, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (source_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS pending_settings_novel_idx ON pending_settings(novel_id, status);
CREATE INDEX IF NOT EXISTS pending_settings_title_idx ON pending_settings(novel_id, display_title);
CREATE TABLE IF NOT EXISTS world_entry_conflicts (id text PRIMARY KEY, novel_id text NOT NULL, world_entry_id text NOT NULL, conflict_kind text DEFAULT 'semantic_conflict' NOT NULL, source text DEFAULT 'observer' NOT NULL, source_chapter_id text, conflict_note text DEFAULT '' NOT NULL, resolved integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (source_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS world_entry_conflicts_novel_idx ON world_entry_conflicts(novel_id, resolved);
CREATE TABLE IF NOT EXISTS story_arcs (id text PRIMARY KEY, novel_id text NOT NULL, arc_type text NOT NULL, title text NOT NULL, summary text DEFAULT '' NOT NULL, status text DEFAULT 'planned' NOT NULL, target_character_id text, planned_start_chapter integer, planned_end_chapter integer, actual_start_chapter integer, actual_end_chapter integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (target_character_id) REFERENCES characters(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS story_arcs_novel_id_idx ON story_arcs(novel_id);
CREATE INDEX IF NOT EXISTS story_arcs_arc_type_idx ON story_arcs(novel_id, arc_type);
CREATE TABLE IF NOT EXISTS arc_beats (id text PRIMARY KEY, novel_id text NOT NULL, arc_id text NOT NULL, chapter_id text, chapter_order integer, label text NOT NULL, kind text DEFAULT 'note' NOT NULL, summary text DEFAULT '' NOT NULL, status text DEFAULT 'planned' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (arc_id) REFERENCES story_arcs(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS arc_beats_arc_id_idx ON arc_beats(arc_id);
CREATE INDEX IF NOT EXISTS arc_beats_novel_chapter_idx ON arc_beats(novel_id, chapter_order);
CREATE INDEX IF NOT EXISTS arc_beats_chapter_id_idx ON arc_beats(chapter_id);
CREATE TABLE IF NOT EXISTS volume_reviews (id text PRIMARY KEY, novel_id text NOT NULL, volume_id text NOT NULL, round integer NOT NULL, overall text DEFAULT '' NOT NULL, score real, strengths_json text DEFAULT '[]' NOT NULL, weaknesses_json text DEFAULT '[]' NOT NULL, structure_json text DEFAULT '{}' NOT NULL, character_arcs_json text DEFAULT '[]' NOT NULL, open_threads_json text DEFAULT '[]' NOT NULL, recommendations_json text DEFAULT '[]' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS volume_reviews_volume_id_idx ON volume_reviews(volume_id, round);
CREATE INDEX IF NOT EXISTS volume_reviews_novel_id_idx ON volume_reviews(novel_id);
CREATE TABLE IF NOT EXISTS editorial_reports (id text PRIMARY KEY, novel_id text NOT NULL, scope_type text DEFAULT 'book' NOT NULL, scope_id text, summary text DEFAULT '' NOT NULL, risks_json text DEFAULT '[]' NOT NULL, recommendations_json text DEFAULT '[]' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS editorial_reports_novel_id_idx ON editorial_reports(novel_id, created_at);
CREATE TABLE IF NOT EXISTS chapter_annotations (id text PRIMARY KEY, novel_id text NOT NULL, chapter_id text NOT NULL, parent_id text, source text DEFAULT 'user' NOT NULL, anchor_type text DEFAULT 'paragraph' NOT NULL, paragraph_index integer, start_offset integer, end_offset integer, quote text DEFAULT '' NOT NULL, comment text DEFAULT '' NOT NULL, suggested_replacement text, status text DEFAULT 'open' NOT NULL, author_session_id text, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE, FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE, FOREIGN KEY (parent_id) REFERENCES chapter_annotations(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS chapter_annotations_chapter_id_idx ON chapter_annotations(chapter_id, status);
CREATE INDEX IF NOT EXISTS chapter_annotations_novel_id_idx ON chapter_annotations(novel_id);
CREATE TABLE IF NOT EXISTS outline_canvas_layout (novel_id text PRIMARY KEY, layout_json text DEFAULT '{}' NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS hook_rotation (id text PRIMARY KEY, novel_id text NOT NULL, hook_type text NOT NULL, chapter_id text, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS hook_rotation_novel_id_idx ON hook_rotation(novel_id);
CREATE INDEX IF NOT EXISTS hook_rotation_created_at_idx ON hook_rotation(novel_id, created_at);
CREATE TABLE IF NOT EXISTS entity_refs (id text PRIMARY KEY, novel_id text NOT NULL, source_type text NOT NULL, source_id text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, ref_field text NOT NULL, ref_text text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS entity_refs_target_idx ON entity_refs(target_type, target_id);
CREATE INDEX IF NOT EXISTS entity_refs_source_idx ON entity_refs(source_type, source_id);
CREATE TABLE IF NOT EXISTS pending_updates (id text PRIMARY KEY, novel_id text NOT NULL, source_type text NOT NULL, source_id text NOT NULL, trigger_type text NOT NULL, trigger_id text NOT NULL, trigger_field text DEFAULT '' NOT NULL, old_value text DEFAULT '' NOT NULL, new_value text DEFAULT '' NOT NULL, reason text DEFAULT '' NOT NULL, status text DEFAULT 'pending' NOT NULL, priority text DEFAULT 'medium' NOT NULL, created_at integer NOT NULL, resolved_at integer, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS pending_updates_novel_id_idx ON pending_updates(novel_id);
CREATE INDEX IF NOT EXISTS pending_updates_status_idx ON pending_updates(novel_id, status);
CREATE TABLE IF NOT EXISTS saga_sessions (id text PRIMARY KEY, novel_id text NOT NULL, trigger_type text NOT NULL, trigger_id text NOT NULL, trigger_field text DEFAULT '' NOT NULL, old_value text DEFAULT '' NOT NULL, new_value text DEFAULT '' NOT NULL, reason text DEFAULT '' NOT NULL, status text DEFAULT 'started' NOT NULL, total_tasks integer DEFAULT 0 NOT NULL, completed_tasks integer DEFAULT 0 NOT NULL, failed_tasks integer DEFAULT 0 NOT NULL, current_task_id text, created_at integer NOT NULL, updated_at integer NOT NULL, completed_at integer, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS saga_sessions_novel_id_idx ON saga_sessions(novel_id);
CREATE INDEX IF NOT EXISTS saga_sessions_status_idx ON saga_sessions(novel_id, status);
CREATE TABLE IF NOT EXISTS description_history (id text PRIMARY KEY, novel_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, field text DEFAULT 'description' NOT NULL, old_value text DEFAULT '' NOT NULL, new_value text DEFAULT '' NOT NULL, created_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS description_history_entity_idx ON description_history(entity_type, entity_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chapter_summary_fts USING fts5(novel_id UNINDEXED, chapter_id UNINDEXED, chapter_order UNINDEXED, title, body, tokenize = 'trigram');
INSERT INTO chapter_summary_fts(novel_id, chapter_id, chapter_order, title, body)
SELECT c.novel_id, s.chapter_id, c."order", c.title, COALESCE(s.summary, '') || ' ' || COALESCE(s.key_events, '[]')
FROM chapter_summaries s
JOIN chapters c ON c.id = s.chapter_id
WHERE NOT EXISTS (
  SELECT 1 FROM chapter_summary_fts f WHERE f.novel_id = c.novel_id AND f.chapter_id = s.chapter_id
);
CREATE TABLE IF NOT EXISTS techniques (id text PRIMARY KEY, name text NOT NULL, principle text NOT NULL, instruction text NOT NULL, scene_types text DEFAULT '[]' NOT NULL, level text NOT NULL, evidence text DEFAULT '[]' NOT NULL, common_misuse text DEFAULT '' NOT NULL, confidence real DEFAULT 0.5 NOT NULL, status text DEFAULT 'unverified' NOT NULL, embedding text, usage_count integer DEFAULT 0 NOT NULL, last_used_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS technique_status_idx ON techniques(status);
CREATE INDEX IF NOT EXISTS technique_level_idx ON techniques(level);
CREATE TABLE IF NOT EXISTS technique_feedback (id text PRIMARY KEY, technique_id text NOT NULL, chapter_id text NOT NULL, score real NOT NULL, was_used integer DEFAULT 0 NOT NULL, comment text DEFAULT '' NOT NULL, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS technique_feedback_technique_id_idx ON technique_feedback(technique_id);
CREATE INDEX IF NOT EXISTS technique_feedback_chapter_id_idx ON technique_feedback(chapter_id);
CREATE TABLE IF NOT EXISTS technique_shadow_log (id text PRIMARY KEY, novel_id text NOT NULL, chapter_number integer NOT NULL, scene_type text NOT NULL, query_text text DEFAULT '' NOT NULL, retrieved_technique_ids text DEFAULT '[]' NOT NULL, retrieved_technique_names text DEFAULT '[]' NOT NULL, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS technique_shadow_log_novel_id_idx ON technique_shadow_log(novel_id);`

// ─── DB 连接缓存 ───

const _dbCache = new Map<string, Db>()

export function getDb(directory?: string | null, options?: { fresh?: boolean }): Db {
  const dbPath = getDbPath(directory)
  if (!options?.fresh) {
    const cached = _dbCache.get(dbPath)
    if (cached) return cached
  }
  const dir = join(dbPath, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = createDb(dbPath, CREATE_TABLES_SQL)
  if (!options?.fresh) _dbCache.set(dbPath, db)
  return db
}

/**
 * 关闭并驱逐某项目的缓存连接。
 *
 * 云盘同步拉取远端快照替换 novel.db 文件前必须调用——否则替换后旧连接
 * 仍持有已失效的文件句柄，后续写入会落到被替换掉的旧文件上。
 */
export function closeDb(directory?: string | null): void {
  const dbPath = getDbPath(directory)
  const cached = _dbCache.get(dbPath)
  if (!cached) return
  _dbCache.delete(dbPath)
  cached.$client.close()
}

// ─── 会话标记 API ───

/**
 * 将会话标记为小说会话（幂等）
 *
 * 同一 (sessionId, novelId) 已存在时直接返回，不重复插入。
 */
export async function tagNovelSession(sessionId: string, novelId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  const existing = await db
    .select({ id: SessionNovelTable.id })
    .from(SessionNovelTable)
    .where(and(eq(SessionNovelTable.session_id, sessionId), eq(SessionNovelTable.novel_id, novelId)))
    .limit(1)
    .all()
  if (existing.length > 0) return
  const id = crypto.randomUUID()
  await db.insert(SessionNovelTable).values({ id, session_id: sessionId, novel_id: novelId }).run()
}

/**
 * 获取会话关联的小说 ID
 */
export async function getNovelForSession(sessionId: string, directory?: string | null): Promise<string | undefined> {
  const db = getDb(directory)
  const rows = await db.select().from(SessionNovelTable).where(eq(SessionNovelTable.session_id, sessionId)).all()
  return rows[0]?.novel_id
}

/**
 * 列出当前目录下所有「会话 ↔ 小说」绑定关系（含小说标题），
 * 供会话页侧边栏一次性构建书籍分组，避免逐会话 N+1 查询。
 */
export async function listSessionNovelBindings(
  directory?: string | null,
): Promise<Array<{ sessionID: string; novelID: string; novelTitle: string }>> {
  const db = getDb(directory)
  const rows = await db
    .select({
      sessionID: SessionNovelTable.session_id,
      novelID: SessionNovelTable.novel_id,
      novelTitle: NovelTable.title,
    })
    .from(SessionNovelTable)
    .innerJoin(NovelTable, eq(SessionNovelTable.novel_id, NovelTable.id))
    .all()
  return rows
}

/**
 * 检查是否为小说会话
 */
export async function isNovelSession(sessionId: string, directory?: string | null): Promise<boolean> {
  const novelId = await getNovelForSession(sessionId, directory)
  return novelId !== undefined
}

/**
 * 解析会话关联的小说 ID，未绑定则尝试懒绑定。
 *
 * 懒绑定规则：当 DB 中恰好存在一本小说时，将其标记为该会话的小说并继续；
 * 0 本或多本均跳过，避免错误绑定。
 */
export async function resolveNovelForSession(
  sessionId: string,
  directory?: string | null,
): Promise<string | undefined> {
  const db = getDb(directory)
  const rows = await db
    .select({ novel_id: SessionNovelTable.novel_id })
    .from(SessionNovelTable)
    .where(eq(SessionNovelTable.session_id, sessionId))
    .limit(1)
    .all()
  if (rows.length > 0) return rows[0].novel_id

  const novels = await db.select({ id: NovelTable.id }).from(NovelTable).limit(2).all()
  if (novels.length !== 1) return undefined
  const novelId = novels[0].id
  await tagNovelSession(sessionId, novelId, directory)
  return novelId
}

// ─── Approval gate (re-export) ───

export * from "./approval.js"

// ─── Project mode helpers (re-export) ───

export * from "./mode.js"

export async function createChapter(
  novelId: string,
  title: string,
  order?: number,
  volumeId?: string | null,
  directory?: string | null,
): Promise<typeof ChapterTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  const nextOrder = order ?? 0
  await db
    .insert(ChapterTable)
    .values({
      id,
      novel_id: novelId,
      volume_id: volumeId ?? null,
      title,
      order: nextOrder,
      status: "draft",
      word_count: 0,
      created_at: now,
      updated_at: now,
    })
    .run()
  return db.select().from(ChapterTable).where(eq(ChapterTable.id, id)).get()!
}

export async function deleteChapter(chapterId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(ChapterVersionTable).where(eq(ChapterVersionTable.chapter_id, chapterId)).run()
  await db.delete(ChapterTable).where(eq(ChapterTable.id, chapterId)).run()
}

export async function createVolume(
  novelId: string,
  title: string,
  summary?: string,
  directory?: string | null,
): Promise<typeof VolumeTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const existing = await db.select().from(VolumeTable).where(eq(VolumeTable.novel_id, novelId)).all()
  const nextOrder = existing.reduce((max, v) => Math.max(max, v.order), 0) + 1
  await db
    .insert(VolumeTable)
    .values({ id, novel_id: novelId, title, summary: summary ?? "", order: nextOrder, created_at: Date.now() })
    .run()
  return db.select().from(VolumeTable).where(eq(VolumeTable.id, id)).get()!
}

export async function updateVolume(
  volumeId: string,
  fields: { title?: string; summary?: string },
  directory?: string | null,
): Promise<typeof VolumeTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.summary !== undefined) updates.summary = fields.summary
  await db.update(VolumeTable).set(updates).where(eq(VolumeTable.id, volumeId)).run()
  return db.select().from(VolumeTable).where(eq(VolumeTable.id, volumeId)).get()!
}

export async function deleteVolume(volumeId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.update(ChapterTable).set({ volume_id: null }).where(eq(ChapterTable.volume_id, volumeId)).run()
  await db.delete(VolumeTable).where(eq(VolumeTable.id, volumeId)).run()
}

export async function updateChapter(
  chapterId: string,
  fields: { title?: string; status?: string },
  directory?: string | null,
): Promise<typeof ChapterTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = { updated_at: Date.now() }
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.status !== undefined) updates.status = fields.status
  await db.update(ChapterTable).set(updates).where(eq(ChapterTable.id, chapterId)).run()
  return db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
}

export async function moveChapter(
  chapterId: string,
  action: "up" | "down" | "to-volume",
  volumeId: string | undefined,
  directory?: string | null,
): Promise<typeof ChapterTable.$inferSelect> {
  const db = getDb(directory)
  const chapter = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)

  if (action === "to-volume") {
    const target = volumeId ?? null
    const siblings = await db
      .select()
      .from(ChapterTable)
      .where(
        target
          ? and(eq(ChapterTable.novel_id, chapter.novel_id), eq(ChapterTable.volume_id, target))
          : and(eq(ChapterTable.novel_id, chapter.novel_id), isNull(ChapterTable.volume_id)),
      )
      .all()
    const nextOrder = siblings.reduce((max, c) => Math.max(max, c.order), 0) + 1
    await db
      .update(ChapterTable)
      .set({ volume_id: target, order: nextOrder, updated_at: Date.now() })
      .where(eq(ChapterTable.id, chapterId))
      .run()
    return db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
  }

  const group = await db
    .select()
    .from(ChapterTable)
    .where(
      chapter.volume_id
        ? and(eq(ChapterTable.novel_id, chapter.novel_id), eq(ChapterTable.volume_id, chapter.volume_id))
        : and(eq(ChapterTable.novel_id, chapter.novel_id), isNull(ChapterTable.volume_id)),
    )
    .orderBy(asc(ChapterTable.order))
    .all()
  const index = group.findIndex((c) => c.id === chapterId)
  const swapWith = action === "up" ? group[index - 1] : group[index + 1]
  if (swapWith) {
    const now = Date.now()
    await db
      .update(ChapterTable)
      .set({ order: swapWith.order, updated_at: now })
      .where(eq(ChapterTable.id, chapterId))
      .run()
    await db
      .update(ChapterTable)
      .set({ order: chapter.order, updated_at: now })
      .where(eq(ChapterTable.id, swapWith.id))
      .run()
  }
  return db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()!
}

export async function createRelationship(
  novelId: string,
  charAId: string,
  charBId: string,
  type: string,
  description?: string,
  directory?: string | null,
): Promise<typeof RelationshipTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  await db
    .insert(RelationshipTable)
    .values({ id, novel_id: novelId, char_a_id: charAId, char_b_id: charBId, type, description: description ?? "" })
    .run()
  return db.select().from(RelationshipTable).where(eq(RelationshipTable.id, id)).get()!
}

export async function updateRelationship(
  relationshipId: string,
  fields: { type?: string; description?: string },
  directory?: string | null,
): Promise<typeof RelationshipTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.type !== undefined) updates.type = fields.type
  if (fields.description !== undefined) updates.description = fields.description
  await db.update(RelationshipTable).set(updates).where(eq(RelationshipTable.id, relationshipId)).run()
  return db.select().from(RelationshipTable).where(eq(RelationshipTable.id, relationshipId)).get()!
}

export async function deleteRelationship(relationshipId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(RelationshipTable).where(eq(RelationshipTable.id, relationshipId)).run()
}

export async function createCharacterState(
  characterId: string,
  input: { chapterId?: string; location?: string; mood?: string; summary?: string },
  directory?: string | null,
): Promise<typeof CharacterStateTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  await db
    .insert(CharacterStateTable)
    .values({
      id,
      character_id: characterId,
      chapter_id: input.chapterId ?? null,
      active: 1,
      location: input.location ?? "",
      mood: input.mood ?? "",
      summary: input.summary ?? "",
    })
    .run()
  return db.select().from(CharacterStateTable).where(eq(CharacterStateTable.id, id)).get()!
}

export async function updateCharacterState(
  stateId: string,
  fields: { active?: number; location?: string; mood?: string; summary?: string },
  directory?: string | null,
): Promise<typeof CharacterStateTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.active !== undefined) updates.active = fields.active
  if (fields.location !== undefined) updates.location = fields.location
  if (fields.mood !== undefined) updates.mood = fields.mood
  if (fields.summary !== undefined) updates.summary = fields.summary
  await db.update(CharacterStateTable).set(updates).where(eq(CharacterStateTable.id, stateId)).run()
  return db.select().from(CharacterStateTable).where(eq(CharacterStateTable.id, stateId)).get()!
}

export async function deleteCharacterState(stateId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(CharacterStateTable).where(eq(CharacterStateTable.id, stateId)).run()
}

export async function upsertStyleGuide(
  novelId: string,
  fields: { tone?: string; pov?: string; tense?: string; rules?: Record<string, string> },
  directory?: string | null,
): Promise<typeof StyleGuideTable.$inferSelect> {
  const db = getDb(directory)
  const existing = await db.select().from(StyleGuideTable).where(eq(StyleGuideTable.novel_id, novelId)).get()
  if (!existing) {
    const id = crypto.randomUUID()
    await db
      .insert(StyleGuideTable)
      .values({
        id,
        novel_id: novelId,
        tone: fields.tone ?? "",
        pov: fields.pov ?? "",
        tense: fields.tense ?? "",
        // rules 列是 drizzle json 模式，直接传对象（内部会序列化一次）；再 JSON.stringify 会产生双重编码
        rules: fields.rules ?? {},
      })
      .run()
    return db.select().from(StyleGuideTable).where(eq(StyleGuideTable.id, id)).get()!
  }
  const updates: Record<string, unknown> = {}
  if (fields.tone !== undefined) updates.tone = fields.tone
  if (fields.pov !== undefined) updates.pov = fields.pov
  if (fields.tense !== undefined) updates.tense = fields.tense
  if (fields.rules !== undefined) updates.rules = fields.rules
  await db.update(StyleGuideTable).set(updates).where(eq(StyleGuideTable.id, existing.id)).run()
  return db.select().from(StyleGuideTable).where(eq(StyleGuideTable.id, existing.id)).get()!
}

export async function getSoul(
  novelId: string,
  directory?: string | null,
): Promise<typeof SoulTable.$inferSelect | undefined> {
  const db = getDb(directory)
  return db.select().from(SoulTable).where(eq(SoulTable.novel_id, novelId)).get()
}

export async function upsertSoul(
  novelId: string,
  content: string,
  directory?: string | null,
): Promise<typeof SoulTable.$inferSelect> {
  const db = getDb(directory)
  const existing = await db.select().from(SoulTable).where(eq(SoulTable.novel_id, novelId)).get()
  if (!existing) {
    const id = crypto.randomUUID()
    await db.insert(SoulTable).values({ id, novel_id: novelId, content }).run()
    return db.select().from(SoulTable).where(eq(SoulTable.id, id)).get()!
  }
  await db.update(SoulTable).set({ content, updated_at: Date.now() }).where(eq(SoulTable.id, existing.id)).run()
  return db.select().from(SoulTable).where(eq(SoulTable.id, existing.id)).get()!
}

export async function updateNovel(
  novelId: string,
  fields: { title?: string; synopsis?: string; genre?: string },
  directory?: string | null,
): Promise<typeof NovelTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = { updated_at: Date.now() }
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.synopsis !== undefined) updates.synopsis = fields.synopsis
  if (fields.genre !== undefined) updates.genre = fields.genre
  await db.update(NovelTable).set(updates).where(eq(NovelTable.id, novelId)).run()
  return db.select().from(NovelTable).where(eq(NovelTable.id, novelId)).get()!
}

export async function deleteNovel(novelId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(NovelTable).where(eq(NovelTable.id, novelId)).run()
}

export async function createCharacter(
  novelId: string,
  name: string,
  role?: string,
  description?: string,
  directory?: string | null,
): Promise<typeof CharacterTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(CharacterTable)
    .values({
      id,
      novel_id: novelId,
      name,
      role: role ?? "",
      description: description ?? "",
      created_at: now,
    })
    .run()
  return db.select().from(CharacterTable).where(eq(CharacterTable.id, id)).get()!
}

export async function updateCharacter(
  characterId: string,
  fields: { name?: string; role?: string; description?: string; status?: string },
  directory?: string | null,
): Promise<typeof CharacterTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.name !== undefined) updates.name = fields.name
  if (fields.role !== undefined) updates.role = fields.role
  if (fields.description !== undefined) updates.description = fields.description
  if (fields.status !== undefined) updates.status = fields.status
  await db.update(CharacterTable).set(updates).where(eq(CharacterTable.id, characterId)).run()
  return db.select().from(CharacterTable).where(eq(CharacterTable.id, characterId)).get()!
}

/**
 * 删除角色。
 *
 * 保护规则：
 * 1. 主角（role=protagonist）禁止删除——删主角等于删小说。
 * 2. 已在章节正文中出场过的角色禁止硬删——叙事历史不可抹除，
 *    应改用退场（updateCharacter status=departed）。
 * 3. 满足删除条件时手动级联清理 character_states / relationships / entity_refs，
 *    不依赖 FK CASCADE（Node 运行时 foreign_keys 行为不稳）。
 */
export async function deleteCharacter(characterId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  const [char] = await db.select().from(CharacterTable).where(eq(CharacterTable.id, characterId)).all()
  if (!char) return
  if (char.role === "protagonist") {
    throw new Error("PROTAGONIST_CANNOT_BE_DELETED")
  }
  const appeared = await db
    .select({ id: EntityRefTable.id })
    .from(EntityRefTable)
    .where(
      and(
        eq(EntityRefTable.target_type, "character"),
        eq(EntityRefTable.target_id, characterId),
        eq(EntityRefTable.source_type, "chapter"),
      ),
    )
    .limit(1)
    .all()
  if (appeared.length > 0) {
    throw new Error("CHARACTER_APPEARED_IN_CHAPTERS")
  }
  await db.delete(CharacterStateTable).where(eq(CharacterStateTable.character_id, characterId)).run()
  await db
    .delete(RelationshipTable)
    .where(or(eq(RelationshipTable.char_a_id, characterId), eq(RelationshipTable.char_b_id, characterId)))
    .run()
  await db
    .delete(EntityRefTable)
    .where(and(eq(EntityRefTable.target_type, "character"), eq(EntityRefTable.target_id, characterId)))
    .run()
  await db.delete(CharacterTable).where(eq(CharacterTable.id, characterId)).run()
}

export async function createTensionPoint(
  novelId: string,
  chapterNumber: number,
  level: number,
  directory?: string | null,
): Promise<typeof TensionLogTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(TensionLogTable)
    .values({
      id,
      novel_id: novelId,
      chapter_number: chapterNumber,
      level,
      created_at: now,
    })
    .run()
  return db.select().from(TensionLogTable).where(eq(TensionLogTable.id, id)).get()!
}

export async function updateTensionPoint(
  pointId: string,
  level: number,
  directory?: string | null,
): Promise<typeof TensionLogTable.$inferSelect> {
  const db = getDb(directory)
  await db.update(TensionLogTable).set({ level }).where(eq(TensionLogTable.id, pointId)).run()
  return db.select().from(TensionLogTable).where(eq(TensionLogTable.id, pointId)).get()!
}

export async function deleteTensionPoint(pointId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(TensionLogTable).where(eq(TensionLogTable.id, pointId)).run()
}

export async function createPlotThread(
  novelId: string,
  title: string,
  priority?: string,
  description?: string,
  directory?: string | null,
): Promise<typeof PlotThreadTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(PlotThreadTable)
    .values({
      id,
      novel_id: novelId,
      title,
      status: "open",
      priority: priority ?? "medium",
      description: description ?? "",
      created_at: now,
    })
    .run()
  return db.select().from(PlotThreadTable).where(eq(PlotThreadTable.id, id)).get()!
}

export async function updatePlotThread(
  threadId: string,
  fields: { title?: string; status?: string; priority?: string; description?: string },
  directory?: string | null,
): Promise<typeof PlotThreadTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.status !== undefined) {
    updates.status = fields.status
    updates.closed_at = fields.status === "closed" ? Date.now() : null
  }
  if (fields.priority !== undefined) updates.priority = fields.priority
  if (fields.description !== undefined) updates.description = fields.description
  await db.update(PlotThreadTable).set(updates).where(eq(PlotThreadTable.id, threadId)).run()
  return db.select().from(PlotThreadTable).where(eq(PlotThreadTable.id, threadId)).get()!
}

export async function deletePlotThread(threadId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(PlotThreadTable).where(eq(PlotThreadTable.id, threadId)).run()
}

export async function createForeshadowing(
  novelId: string,
  content: string,
  plantedChapterId?: string | null,
  directory?: string | null,
): Promise<typeof ForeshadowingTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(ForeshadowingTable)
    .values({
      id,
      novel_id: novelId,
      planted_chapter_id: plantedChapterId ?? null,
      content,
      state: "planted",
      created_at: now,
    })
    .run()
  return db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.id, id)).get()!
}

export async function updateForeshadowing(
  entryId: string,
  fields: { content?: string; state?: string; resolvedChapterId?: string | null },
  directory?: string | null,
): Promise<typeof ForeshadowingTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.content !== undefined) updates.content = fields.content
  if (fields.state !== undefined) updates.state = fields.state
  if (fields.resolvedChapterId !== undefined) updates.resolved_chapter_id = fields.resolvedChapterId
  await db.update(ForeshadowingTable).set(updates).where(eq(ForeshadowingTable.id, entryId)).run()
  return db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.id, entryId)).get()!
}

export async function deleteForeshadowing(entryId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(ForeshadowingTable).where(eq(ForeshadowingTable.id, entryId)).run()
}

export async function createWorldEntry(
  novelId: string,
  category: string,
  title: string,
  content?: string,
  directory?: string | null,
): Promise<typeof WorldEntryTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(WorldEntryTable)
    .values({
      id,
      novel_id: novelId,
      category,
      title,
      content: content ?? "",
      created_at: now,
    })
    .run()
  return db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, id)).get()!
}

export async function updateWorldEntry(
  entryId: string,
  fields: { category?: string; title?: string; content?: string },
  directory?: string | null,
): Promise<typeof WorldEntryTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = {}
  if (fields.category !== undefined) updates.category = fields.category
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.content !== undefined) updates.content = fields.content
  await db.update(WorldEntryTable).set(updates).where(eq(WorldEntryTable.id, entryId)).run()
  return db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).get()!
}

export async function deleteWorldEntry(entryId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).run()
}

// ─── 章节评审（审批详情） ───

export type ChapterReviewDimension = {
  dimension: string
  status: "PASS" | "WARN" | "FAIL"
  detail: string
  evidence?: string
}

/**
 * 写入一条章节评审记录。round 自动推导：内容在上次评审之后发生过变更
 * （chapter.updated_at > 最近评审 created_at）则开启新一轮，否则并入当前轮。
 */
export async function createChapterReview(
  chapterId: string,
  input: {
    source: "deterministic" | "auditor" | "human"
    overall: "PASS" | "WARN" | "FAIL"
    dimensions?: ChapterReviewDimension[]
    summary?: string
    sessionId?: string
  },
  directory?: string | null,
): Promise<typeof ChapterReviewTable.$inferSelect> {
  const db = getDb(directory)
  const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).all()
  if (!chapter) throw new Error(`未找到章节 ${chapterId}`)
  const latest = await db
    .select()
    .from(ChapterReviewTable)
    .where(eq(ChapterReviewTable.chapter_id, chapterId))
    .orderBy(desc(ChapterReviewTable.created_at))
    .limit(1)
    .get()
  const round = !latest ? 1 : chapter.updated_at > latest.created_at ? latest.round + 1 : latest.round
  const dimensions = input.dimensions ?? []
  const id = crypto.randomUUID()
  await db
    .insert(ChapterReviewTable)
    .values({
      id,
      chapter_id: chapterId,
      round,
      source: input.source,
      overall: input.overall,
      pass_count: dimensions.filter((d) => d.status === "PASS").length,
      warn_count: dimensions.filter((d) => d.status === "WARN").length,
      fail_count: dimensions.filter((d) => d.status === "FAIL").length,
      dimensions: JSON.stringify(dimensions),
      summary: input.summary ?? "",
      session_id: input.sessionId ?? null,
    })
    .run()
  return db.select().from(ChapterReviewTable).where(eq(ChapterReviewTable.id, id)).get()!
}

export async function listChapterReviews(
  chapterId: string,
  directory?: string | null,
): Promise<(typeof ChapterReviewTable.$inferSelect)[]> {
  const db = getDb(directory)
  return db
    .select()
    .from(ChapterReviewTable)
    .where(eq(ChapterReviewTable.chapter_id, chapterId))
    .orderBy(desc(ChapterReviewTable.created_at))
    .all()
}


// ─── B/C 阶段 CRUD ───

export async function createStoryArc(
  novelId: string,
  input: {
    arcType: string
    title: string
    summary?: string
    status?: string
    targetCharacterId?: string | null
    plannedStartChapter?: number | null
    plannedEndChapter?: number | null
  },
  directory?: string | null,
): Promise<typeof StoryArcTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(StoryArcTable)
    .values({
      id,
      novel_id: novelId,
      arc_type: input.arcType,
      title: input.title,
      summary: input.summary ?? "",
      status: input.status ?? "planned",
      target_character_id: input.targetCharacterId ?? null,
      planned_start_chapter: input.plannedStartChapter ?? null,
      planned_end_chapter: input.plannedEndChapter ?? null,
      created_at: now,
      updated_at: now,
    })
    .run()
  return db.select().from(StoryArcTable).where(eq(StoryArcTable.id, id)).get()!
}

export async function updateStoryArc(
  arcId: string,
  fields: {
    title?: string
    summary?: string
    status?: string
    arcType?: string
    targetCharacterId?: string | null
    plannedStartChapter?: number | null
    plannedEndChapter?: number | null
    actualStartChapter?: number | null
    actualEndChapter?: number | null
  },
  directory?: string | null,
): Promise<typeof StoryArcTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = { updated_at: Date.now() }
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.summary !== undefined) updates.summary = fields.summary
  if (fields.status !== undefined) updates.status = fields.status
  if (fields.arcType !== undefined) updates.arc_type = fields.arcType
  if (fields.targetCharacterId !== undefined) updates.target_character_id = fields.targetCharacterId
  if (fields.plannedStartChapter !== undefined) updates.planned_start_chapter = fields.plannedStartChapter
  if (fields.plannedEndChapter !== undefined) updates.planned_end_chapter = fields.plannedEndChapter
  if (fields.actualStartChapter !== undefined) updates.actual_start_chapter = fields.actualStartChapter
  if (fields.actualEndChapter !== undefined) updates.actual_end_chapter = fields.actualEndChapter
  await db.update(StoryArcTable).set(updates).where(eq(StoryArcTable.id, arcId)).run()
  return db.select().from(StoryArcTable).where(eq(StoryArcTable.id, arcId)).get()!
}

export async function deleteStoryArc(arcId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(ArcBeatTable).where(eq(ArcBeatTable.arc_id, arcId)).run()
  await db.delete(StoryArcTable).where(eq(StoryArcTable.id, arcId)).run()
}

export async function listStoryArcs(
  novelId: string,
  directory?: string | null,
): Promise<(typeof StoryArcTable.$inferSelect)[]> {
  const db = getDb(directory)
  return db
    .select()
    .from(StoryArcTable)
    .where(eq(StoryArcTable.novel_id, novelId))
    .orderBy(asc(StoryArcTable.created_at))
    .all()
}

export async function createArcBeat(
  arcId: string,
  input: {
    chapterId?: string | null
    chapterOrder?: number | null
    label: string
    kind?: string
    summary?: string
    status?: string
    novelId?: string
  },
  directory?: string | null,
): Promise<typeof ArcBeatTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  const arc = await db.select().from(StoryArcTable).where(eq(StoryArcTable.id, arcId)).get()
  if (!arc) throw new Error(`Story arc not found: ${arcId}`)
  await db
    .insert(ArcBeatTable)
    .values({
      id,
      novel_id: input.novelId ?? arc.novel_id,
      arc_id: arcId,
      chapter_id: input.chapterId ?? null,
      chapter_order: input.chapterOrder ?? null,
      label: input.label,
      kind: input.kind ?? "note",
      summary: input.summary ?? "",
      status: input.status ?? "planned",
      created_at: now,
      updated_at: now,
    })
    .run()
  return db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, id)).get()!
}

export async function updateArcBeat(
  beatId: string,
  fields: {
    label?: string
    kind?: string
    summary?: string
    status?: string
    chapterId?: string | null
    chapterOrder?: number | null
  },
  directory?: string | null,
): Promise<typeof ArcBeatTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = { updated_at: Date.now() }
  if (fields.label !== undefined) updates.label = fields.label
  if (fields.kind !== undefined) updates.kind = fields.kind
  if (fields.summary !== undefined) updates.summary = fields.summary
  if (fields.status !== undefined) updates.status = fields.status
  if (fields.chapterId !== undefined) updates.chapter_id = fields.chapterId
  if (fields.chapterOrder !== undefined) updates.chapter_order = fields.chapterOrder
  await db.update(ArcBeatTable).set(updates).where(eq(ArcBeatTable.id, beatId)).run()
  return db.select().from(ArcBeatTable).where(eq(ArcBeatTable.id, beatId)).get()!
}

export async function deleteArcBeat(beatId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(ArcBeatTable).where(eq(ArcBeatTable.id, beatId)).run()
}

export async function listArcBeats(
  arcId: string,
  directory?: string | null,
): Promise<(typeof ArcBeatTable.$inferSelect)[]> {
  const db = getDb(directory)
  return db
    .select()
    .from(ArcBeatTable)
    .where(eq(ArcBeatTable.arc_id, arcId))
    .orderBy(asc(ArcBeatTable.chapter_order), asc(ArcBeatTable.created_at))
    .all()
}

export async function createVolumeReview(
  volumeId: string,
  input: {
    novelId?: string
    overall?: string
    score?: number | null
    strengths?: string[]
    weaknesses?: string[]
    structure?: Record<string, unknown>
    characterArcs?: Array<Record<string, unknown>>
    openThreads?: string[]
    recommendations?: string[]
  },
  directory?: string | null,
): Promise<typeof VolumeReviewTable.$inferSelect> {
  const db = getDb(directory)
  const volume = await db.select().from(VolumeTable).where(eq(VolumeTable.id, volumeId)).get()
  if (!volume) throw new Error(`Volume not found: ${volumeId}`)
  const latest = await db
    .select()
    .from(VolumeReviewTable)
    .where(eq(VolumeReviewTable.volume_id, volumeId))
    .orderBy(desc(VolumeReviewTable.round))
    .limit(1)
    .get()
  const round = latest ? latest.round + 1 : 1
  const id = crypto.randomUUID()
  await db
    .insert(VolumeReviewTable)
    .values({
      id,
      novel_id: input.novelId ?? volume.novel_id,
      volume_id: volumeId,
      round,
      overall: input.overall ?? "",
      score: input.score ?? null,
      strengths_json: JSON.stringify(input.strengths ?? []),
      weaknesses_json: JSON.stringify(input.weaknesses ?? []),
      structure_json: JSON.stringify(input.structure ?? {}),
      character_arcs_json: JSON.stringify(input.characterArcs ?? []),
      open_threads_json: JSON.stringify(input.openThreads ?? []),
      recommendations_json: JSON.stringify(input.recommendations ?? []),
      created_at: Date.now(),
    })
    .run()
  return db.select().from(VolumeReviewTable).where(eq(VolumeReviewTable.id, id)).get()!
}

export async function listVolumeReviews(
  volumeId: string,
  directory?: string | null,
): Promise<(typeof VolumeReviewTable.$inferSelect)[]> {
  const db = getDb(directory)
  return db
    .select()
    .from(VolumeReviewTable)
    .where(eq(VolumeReviewTable.volume_id, volumeId))
    .orderBy(desc(VolumeReviewTable.round))
    .all()
}

export async function createEditorialReport(
  novelId: string,
  input: {
    scopeType?: string
    scopeId?: string | null
    summary?: string
    risks?: Array<Record<string, unknown>>
    recommendations?: string[]
  },
  directory?: string | null,
): Promise<typeof EditorialReportTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  await db
    .insert(EditorialReportTable)
    .values({
      id,
      novel_id: novelId,
      scope_type: input.scopeType ?? "book",
      scope_id: input.scopeId ?? null,
      summary: input.summary ?? "",
      risks_json: JSON.stringify(input.risks ?? []),
      recommendations_json: JSON.stringify(input.recommendations ?? []),
      created_at: Date.now(),
    })
    .run()
  return db.select().from(EditorialReportTable).where(eq(EditorialReportTable.id, id)).get()!
}

export async function listEditorialReports(
  novelId: string,
  directory?: string | null,
): Promise<(typeof EditorialReportTable.$inferSelect)[]> {
  const db = getDb(directory)
  return db
    .select()
    .from(EditorialReportTable)
    .where(eq(EditorialReportTable.novel_id, novelId))
    .orderBy(desc(EditorialReportTable.created_at))
    .all()
}

export async function createChapterAnnotation(
  chapterId: string,
  novelId: string,
  input: {
    parentId?: string | null
    source?: string
    anchorType?: string
    paragraphIndex?: number | null
    startOffset?: number | null
    endOffset?: number | null
    quote?: string
    comment?: string
    suggestedReplacement?: string | null
    authorSessionId?: string | null
  },
  directory?: string | null,
): Promise<typeof ChapterAnnotationTable.$inferSelect> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(ChapterAnnotationTable)
    .values({
      id,
      novel_id: novelId,
      chapter_id: chapterId,
      parent_id: input.parentId ?? null,
      source: input.source ?? "user",
      anchor_type: input.anchorType ?? "paragraph",
      paragraph_index: input.paragraphIndex ?? null,
      start_offset: input.startOffset ?? null,
      end_offset: input.endOffset ?? null,
      quote: input.quote ?? "",
      comment: input.comment ?? "",
      suggested_replacement: input.suggestedReplacement ?? null,
      status: "open",
      author_session_id: input.authorSessionId ?? null,
      created_at: now,
      updated_at: now,
    })
    .run()
  return db.select().from(ChapterAnnotationTable).where(eq(ChapterAnnotationTable.id, id)).get()!
}

export async function updateChapterAnnotation(
  annotationId: string,
  fields: {
    comment?: string
    status?: string
    suggestedReplacement?: string | null
    quote?: string
  },
  directory?: string | null,
): Promise<typeof ChapterAnnotationTable.$inferSelect> {
  const db = getDb(directory)
  const updates: Record<string, unknown> = { updated_at: Date.now() }
  if (fields.comment !== undefined) updates.comment = fields.comment
  if (fields.status !== undefined) updates.status = fields.status
  if (fields.suggestedReplacement !== undefined) updates.suggested_replacement = fields.suggestedReplacement
  if (fields.quote !== undefined) updates.quote = fields.quote
  await db.update(ChapterAnnotationTable).set(updates).where(eq(ChapterAnnotationTable.id, annotationId)).run()
  return db.select().from(ChapterAnnotationTable).where(eq(ChapterAnnotationTable.id, annotationId)).get()!
}

export async function deleteChapterAnnotation(annotationId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.delete(ChapterAnnotationTable).where(eq(ChapterAnnotationTable.id, annotationId)).run()
}

export async function listChapterAnnotations(
  chapterId: string,
  directory?: string | null,
  filter?: { status?: string },
): Promise<(typeof ChapterAnnotationTable.$inferSelect)[]> {
  const db = getDb(directory)
  const query = db
    .select()
    .from(ChapterAnnotationTable)
    .where(
      filter?.status
        ? and(eq(ChapterAnnotationTable.chapter_id, chapterId), eq(ChapterAnnotationTable.status, filter.status))
        : eq(ChapterAnnotationTable.chapter_id, chapterId),
    )
    .orderBy(asc(ChapterAnnotationTable.paragraph_index), desc(ChapterAnnotationTable.created_at))
  return query.all()
}

export async function getOutlineCanvasLayout(
  novelId: string,
  directory?: string | null,
): Promise<typeof OutlineCanvasLayoutTable.$inferSelect | undefined> {
  const db = getDb(directory)
  return db.select().from(OutlineCanvasLayoutTable).where(eq(OutlineCanvasLayoutTable.novel_id, novelId)).get()
}

export async function upsertOutlineCanvasLayout(
  novelId: string,
  layout: Record<string, unknown>,
  directory?: string | null,
): Promise<typeof OutlineCanvasLayoutTable.$inferSelect> {
  const db = getDb(directory)
  const existing = await db
    .select()
    .from(OutlineCanvasLayoutTable)
    .where(eq(OutlineCanvasLayoutTable.novel_id, novelId))
    .get()
  if (!existing) {
    await db
      .insert(OutlineCanvasLayoutTable)
      .values({ novel_id: novelId, layout_json: layout, updated_at: Date.now() })
      .run()
  } else {
    await db
      .update(OutlineCanvasLayoutTable)
      .set({ layout_json: layout, updated_at: Date.now() })
      .where(eq(OutlineCanvasLayoutTable.novel_id, novelId))
      .run()
  }
  return db.select().from(OutlineCanvasLayoutTable).where(eq(OutlineCanvasLayoutTable.novel_id, novelId)).get()!
}

export async function listStructureForEditor(
  novelId: string,
  directory?: string | null,
): Promise<{
  volumes: (typeof VolumeTable.$inferSelect)[]
  chapters: (typeof ChapterTable.$inferSelect)[]
  arcs: (typeof StoryArcTable.$inferSelect)[]
  beats: (typeof ArcBeatTable.$inferSelect)[]
  threads: (typeof PlotThreadTable.$inferSelect)[]
  foreshadowing: (typeof ForeshadowingTable.$inferSelect)[]
  characters: (typeof CharacterTable.$inferSelect)[]
}> {
  const db = getDb(directory)
  const [volumes, chapters, arcs, beats, threads, foreshadowing, characters] = await Promise.all([
    db.select().from(VolumeTable).where(eq(VolumeTable.novel_id, novelId)).orderBy(asc(VolumeTable.order)).all(),
    db
      .select()
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, novelId))
      .orderBy(asc(ChapterTable.order))
      .all(),
    db.select().from(StoryArcTable).where(eq(StoryArcTable.novel_id, novelId)).orderBy(asc(StoryArcTable.created_at)).all(),
    db
      .select()
      .from(ArcBeatTable)
      .where(eq(ArcBeatTable.novel_id, novelId))
      .orderBy(asc(ArcBeatTable.chapter_order), asc(ArcBeatTable.created_at))
      .all(),
    db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all(),
    db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.novel_id, novelId)).all(),
    db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all(),
  ])
  return { volumes, chapters, arcs, beats, threads, foreshadowing, characters }
}
