import { sqliteTable, text, integer, index, primaryKey, real, uniqueIndex } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { ProjectTable } from "../project/sql"
import type { SessionMessage } from "./message"
import type { Prompt } from "./prompt"
import type { SessionInput } from "./input"
import type { Snapshot } from "../snapshot"
import { PermissionV1 } from "../v1/permission"
import { ProjectV2 } from "../project"
import type { SessionSchema } from "./schema"
import type { MessageID, PartID, SessionV1 } from "../v1/session"
import { WorkspaceV2 } from "../workspace"
import { Timestamps } from "../database/schema.sql"
import type { SystemContext } from "../system-context/index"
import { AgentV2 } from "../agent"
import type { Revert } from "@opennovel-ai/schema/revert"

type SessionMessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "type" | "id">
type V1MessageData = Omit<SessionV1.Info, "id" | "sessionID">
type V1PartData = Omit<SessionV1.Part, "id" | "sessionID" | "messageID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    parent_id: text().$type<SessionSchema.ID>(),
    slug: text().notNull(),
    directory: DatabasePath.directoryColumn().notNull(),
    path: DatabasePath.pathColumn(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.LegacyFileDiff[]>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    revert: text({ mode: "json" }).$type<Revert.State>(),
    permission: text({ mode: "json" }).$type<PermissionV1.Ruleset>(),
    agent: text(),
    model: text({ mode: "json" }).$type<{
      id: string
      providerID: string
      variant?: string
    }>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1MessageData>(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1PartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const SessionMessageTable = sqliteTable(
  "session_message",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionMessage.Type>().notNull(),
    seq: integer().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<SessionMessageData>(),
  },
  (table) => [
    uniqueIndex("session_message_session_seq_idx").on(table.session_id, table.seq),
    index("session_message_session_type_seq_idx").on(table.session_id, table.type, table.seq),
    index("session_message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id),
    index("session_message_time_created_idx").on(table.time_created),
  ],
)

export const SessionInputTable = sqliteTable(
  "session_input",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    prompt: text({ mode: "json" }).notNull().$type<Prompt>(),
    delivery: text().$type<SessionInput.Delivery>().notNull(),
    admitted_seq: integer().notNull(),
    promoted_seq: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("session_input_session_pending_delivery_seq_idx").on(
      table.session_id,
      table.promoted_seq,
      table.delivery,
      table.admitted_seq,
    ),
    uniqueIndex("session_input_session_admitted_seq_idx").on(table.session_id, table.admitted_seq),
    uniqueIndex("session_input_session_promoted_seq_idx").on(table.session_id, table.promoted_seq),
  ],
)

export const SessionContextEpochTable = sqliteTable("session_context_epoch", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline: text().notNull(),
  snapshot: text({ mode: "json" }).notNull().$type<SystemContext.Snapshot>(),
  baseline_seq: integer().notNull(),
})

// ============================================================================
// 小说写作相关表 (Novel Writing Tables)
// ============================================================================

/** 小说表 - 存储小说基本信息 */
export const NovelTable = sqliteTable(
  "novels",
  {
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
  },
  (table) => [index("novels_status_idx").on(table.status)],
)

/** 卷表 - 小说的卷/部结构 */
export const VolumeTable = sqliteTable(
  "volumes",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    summary: text().notNull().default(""),
    order: integer().notNull(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("volumes_novel_id_idx").on(table.novel_id),
    index("volumes_novel_order_idx").on(table.novel_id, table.order),
  ],
)

/** 章节表 - 存储每章内容 */
export const ChapterTable = sqliteTable(
  "chapters",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    volume_id: text().references(() => VolumeTable.id, { onDelete: "set null" }),
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
  },
  (table) => [
    index("chapters_novel_id_idx").on(table.novel_id),
    index("chapters_volume_id_idx").on(table.volume_id),
    index("chapters_novel_order_idx").on(table.novel_id, table.order),
  ],
)

/** 章节版本表 - 追踪章节修改历史 */
export const ChapterVersionTable = sqliteTable(
  "chapter_versions",
  {
    id: text().primaryKey(),
    chapter_id: text()
      .notNull()
      .references(() => ChapterTable.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    content: text().notNull(),
    word_count: integer().notNull().default(0),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    created_by: text().notNull(),
  },
  (table) => [
    index("chapter_versions_chapter_id_idx").on(table.chapter_id),
    index("chapter_versions_chapter_version_idx").on(table.chapter_id, table.version),
  ],
)

/** 角色表 - 小说角色定义 */
export const CharacterTable = sqliteTable(
  "characters",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    role: text().notNull().default(""),
    description: text().notNull().default(""),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("characters_novel_id_idx").on(table.novel_id)],
)

/** 角色状态表 - 每章角色状态快照 */
export const CharacterStateTable = sqliteTable(
  "character_states",
  {
    id: text().primaryKey(),
    character_id: text()
      .notNull()
      .references(() => CharacterTable.id, { onDelete: "cascade" }),
    chapter_id: text()
      .notNull()
      .references(() => ChapterTable.id, { onDelete: "cascade" }),
    active: integer().notNull().default(1),
    location: text().notNull().default(""),
    mood: text().notNull().default(""),
    summary: text().notNull().default(""),
  },
  (table) => [
    index("character_states_character_id_idx").on(table.character_id),
    index("character_states_chapter_id_idx").on(table.chapter_id),
  ],
)

/** 关系表 - 角色之间的关系 */
export const RelationshipTable = sqliteTable(
  "relationships",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    char_a_id: text()
      .notNull()
      .references(() => CharacterTable.id, { onDelete: "cascade" }),
    char_b_id: text()
      .notNull()
      .references(() => CharacterTable.id, { onDelete: "cascade" }),
    type: text().notNull().default(""),
    description: text().notNull().default(""),
  },
  (table) => [
    index("relationships_novel_id_idx").on(table.novel_id),
    index("relationships_char_a_id_idx").on(table.char_a_id),
    index("relationships_char_b_id_idx").on(table.char_b_id),
  ],
)

/** 剧情线索表 - 追踪小说剧情线 */
export const PlotThreadTable = sqliteTable(
  "plot_threads",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    status: text().notNull().default("open"),
    priority: text().notNull().default("medium"),
    description: text().notNull().default(""),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    closed_at: integer(),
  },
  (table) => [index("plot_threads_novel_id_idx").on(table.novel_id), index("plot_threads_status_idx").on(table.status)],
)

/** 伏笔表 - 追踪伏笔的埋设与回收 */
export const ForeshadowingTable = sqliteTable(
  "foreshadowing",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    planted_chapter_id: text().references(() => ChapterTable.id, { onDelete: "set null" }),
    resolved_chapter_id: text().references(() => ChapterTable.id, { onDelete: "set null" }),
    content: text().notNull(),
    state: text().notNull().default("planted"),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("foreshadowing_novel_id_idx").on(table.novel_id), index("foreshadowing_state_idx").on(table.state)],
)

/** 世界观条目表 - 存储世界观设定 */
export const WorldEntryTable = sqliteTable(
  "world_entries",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    category: text().notNull().default(""),
    title: text().notNull(),
    content: text().notNull().default(""),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("world_entries_novel_id_idx").on(table.novel_id),
    index("world_entries_category_idx").on(table.novel_id, table.category),
  ],
)

/** 章节摘要表 - 每章的摘要信息 */
export const ChapterSummaryTable = sqliteTable(
  "chapter_summaries",
  {
    id: text().primaryKey(),
    chapter_id: text()
      .notNull()
      .references(() => ChapterTable.id, { onDelete: "cascade" }),
    summary: text().notNull().default(""),
    key_events: text({ mode: "json" }).notNull().default("[]"),
    char_changes: text({ mode: "json" }).notNull().default("[]"),
  },
  (table) => [index("chapter_summaries_chapter_id_idx").on(table.chapter_id)],
)

/** 卷摘要表 - 卷级别的摘要（用于层级压缩） */
export const VolumeSummaryTable = sqliteTable(
  "volume_summaries",
  {
    id: text().primaryKey(),
    volume_id: text()
      .notNull()
      .references(() => VolumeTable.id, { onDelete: "cascade" }),
    summary: text().notNull().default(""),
    char_active: text({ mode: "json" }).notNull().default("[]"),
    char_dormant: text({ mode: "json" }).notNull().default("[]"),
    threads_open: text({ mode: "json" }).notNull().default("[]"),
    threads_closed: text({ mode: "json" }).notNull().default("[]"),
  },
  (table) => [index("volume_summaries_volume_id_idx").on(table.volume_id)],
)

/** 风格指南表 - 小说写作风格设定 */
export const StyleGuideTable = sqliteTable(
  "style_guide",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    rules: text({ mode: "json" }).notNull().default("{}"),
    tone: text().notNull().default(""),
    pov: text().notNull().default(""),
    tense: text().notNull().default(""),
  },
  (table) => [index("style_guide_novel_id_idx").on(table.novel_id)],
)

/** 会话标记表 - 区分小说写作会话与普通会话 */
export const SessionNovelTable = sqliteTable(
  "session_novel",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("session_novel_session_id_idx").on(table.session_id),
    index("session_novel_novel_id_idx").on(table.novel_id),
  ],
)

/**
 * 状态日志表 (append-only) - 记录每章的状态变更
 * fact_type 可选值: character / relationship / plot_thread / foreshadow / world_entry / chapter_summary / style / timeline / location
 * fact_data 为 JSON 格式的事实数据
 * 此表只允许追加，不允许修改或删除已有记录
 */
export const NovelStateLogTable = sqliteTable(
  "novel_state_log",
  {
    id: text().primaryKey(),
    novel_id: text()
      .notNull()
      .references(() => NovelTable.id, { onDelete: "cascade" }),
    chapter_id: text().references(() => ChapterTable.id, { onDelete: "set null" }),
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
