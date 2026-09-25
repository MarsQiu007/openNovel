/**
 * 手动编辑目录 — 服务端权威配置。
 *
 * 每个会修改小说数据的手动 UI 写入端点都必须在此登记，
 * 声明实体、可编辑字段、数据类别、AI 感知策略和同步策略。
 * 未在目录中声明的正式数据写入路径不应暴露给用户。
 */

export type ManualEditCategory = "creative_fact" | "workflow_fact" | "ui_preference"

export type ManualEditSyncStrategy = "queued" | "immediate" | "none"

export type ManualEditAiPerception = "context" | "gate" | "flow_only" | "none"

export interface ManualEditDirectoryEntry {
  readonly endpoint: string
  readonly entity: string
  readonly fields: readonly string[]
  readonly category: ManualEditCategory
  readonly aiPerception: ManualEditAiPerception
  readonly sync: ManualEditSyncStrategy
}

const entries: readonly ManualEditDirectoryEntry[] = [
  // ─── 书籍创建与删除 ───
  { endpoint: "novel.create", entity: "novel", fields: ["title", "genre", "synopsis"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete", entity: "novel", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },
  { endpoint: "novel.update", entity: "novel", fields: ["title", "synopsis", "genre"], category: "creative_fact", aiPerception: "context", sync: "queued" },

  // ─── 章节正文 ───
  { endpoint: "novel.update-content", entity: "chapter", fields: ["content"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.restore-version", entity: "chapter", fields: ["content"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.rollback", entity: "chapter", fields: ["content"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-outline", entity: "chapter", fields: ["outline"], category: "creative_fact", aiPerception: "context", sync: "queued" },

  // ─── 风格指南与灵魂设定 ───
  { endpoint: "novel.update-style-guide", entity: "style_guide", fields: ["tone", "pov", "tense", "rules"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-soul", entity: "soul", fields: ["content"], category: "creative_fact", aiPerception: "context", sync: "queued" },

  // ─── 角色 ───
  { endpoint: "novel.create-character", entity: "character", fields: ["name", "role", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-character", entity: "character", fields: ["name", "role", "description", "status"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-character", entity: "character", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },
  { endpoint: "novel.create-character-state", entity: "character_state", fields: ["active", "location", "mood", "summary"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-character-state", entity: "character_state", fields: ["active", "location", "mood", "summary"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-character-state", entity: "character_state", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 关系 ───
  { endpoint: "novel.create-relationship", entity: "relationship", fields: ["char_a_id", "char_b_id", "type", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-relationship", entity: "relationship", fields: ["type", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-relationship", entity: "relationship", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 世界观 ───
  { endpoint: "novel.create-world-entry", entity: "world_entry", fields: ["category", "title", "content"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-world-entry", entity: "world_entry", fields: ["category", "title", "content"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-world-entry", entity: "world_entry", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 剧情线 ───
  { endpoint: "novel.create-plot-thread", entity: "plot_thread", fields: ["title", "status", "priority", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-plot-thread", entity: "plot_thread", fields: ["title", "status", "priority", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-plot-thread", entity: "plot_thread", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 伏笔 ───
  { endpoint: "novel.create-foreshadowing", entity: "foreshadowing", fields: ["content", "state", "planted_chapter_id", "resolved_chapter_id"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-foreshadowing", entity: "foreshadowing", fields: ["content", "state", "planted_chapter_id", "resolved_chapter_id"], category: "creative_fact", aiPerception: "context", sync: "queued" },

  // ─── 卷 ───
  { endpoint: "novel.create-volume", entity: "volume", fields: ["title", "summary", "outline"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-volume", entity: "volume", fields: ["title", "summary", "outline"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-volume", entity: "volume", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 章节 ───
  { endpoint: "novel.create-chapter", entity: "chapter", fields: ["title", "volume_id"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-chapter", entity: "chapter", fields: ["title", "status"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-chapter", entity: "chapter", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },
  { endpoint: "novel.move-chapter", entity: "chapter", fields: ["order", "volume_id"], category: "creative_fact", aiPerception: "context", sync: "queued" },

  // ─── 张力点 ───
  { endpoint: "novel.create-tension", entity: "tension", fields: ["level"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-tension", entity: "tension", fields: ["level"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-tension", entity: "tension", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 故事主轴 ───
  { endpoint: "novel.create-arc", entity: "story_arc", fields: ["title", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-arc", entity: "story_arc", fields: ["title", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-arc", entity: "story_arc", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },
  { endpoint: "novel.create-beat", entity: "arc_beat", fields: ["title", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.update-beat", entity: "arc_beat", fields: ["title", "description"], category: "creative_fact", aiPerception: "context", sync: "queued" },
  { endpoint: "novel.delete-beat", entity: "arc_beat", fields: ["*"], category: "creative_fact", aiPerception: "gate", sync: "queued" },

  // ─── 工作流数据 ───
  { endpoint: "novel.approval", entity: "approval", fields: ["action", "comment"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.create-volume-review", entity: "volume_review", fields: ["content"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.create-editorial-report", entity: "editorial_report", fields: ["content"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.create-annotation", entity: "annotation", fields: ["content"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.update-annotation", entity: "annotation", fields: ["content", "resolved"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.delete-annotation", entity: "annotation", fields: ["*"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.create-annotation-round", entity: "annotation_round", fields: ["content"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.update-annotation-round", entity: "annotation_round", fields: ["content"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.settings-organization.analyze", entity: "settings_organization", fields: ["scope"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.settings-organization.dry-run", entity: "settings_organization", fields: ["plan"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },
  { endpoint: "novel.settings-organization.apply", entity: "settings_organization", fields: ["plan", "confirmed"], category: "workflow_fact", aiPerception: "flow_only", sync: "none" },

  // ─── UI 偏好 ───
  { endpoint: "novel.upsert-canvas-layout", entity: "canvas_layout", fields: ["layout"], category: "ui_preference", aiPerception: "none", sync: "none" },
]

export const ManualEditDirectory: ReadonlyMap<string, ManualEditDirectoryEntry> = new Map(
  entries.map((entry) => [entry.endpoint, entry]),
)

export function getManualEditEntry(endpoint: string): ManualEditDirectoryEntry | undefined {
  return ManualEditDirectory.get(endpoint)
}

export function isCreativeFactEdit(endpoint: string): boolean {
  return ManualEditDirectory.get(endpoint)?.category === "creative_fact"
}

export function requiresAiSync(endpoint: string): boolean {
  const entry = ManualEditDirectory.get(endpoint)
  return entry?.category === "creative_fact" && entry.sync === "queued"
}
