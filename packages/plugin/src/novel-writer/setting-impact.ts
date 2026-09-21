/**
 * 统一设定影响面服务（SettingImpactService）。
 *
 * 把 entity_refs 引用扫描、结构性依赖和语义建议整合到一个流程：
 * 修改前 planImpact 查询影响（只读），修改后 applyImpact 生成任务并产出统一报告。
 * 所有正式设定修改入口（manage_characters / update_setting / save_novel_settings /
 * create_relationship / organize_settings / 候选区接受 / observer 状态提交）都应
 * 复用本服务，避免各路径自写一套级联提醒。
 *
 * 稳定任务键：(novel_id, trigger_type, trigger_id, trigger_field, source_type, source_id)
 * 在创建时判重，同一变更对同一受影响对象不会产生重复任务（无需 schema 迁移）。
 * 语义建议复用 pending_updates.status：requires_confirmation（待确认）→ confirm 后转
 * pending 进入执行队列；ignored 表示用户已拒绝。
 */
import { and, eq, ne, or } from "drizzle-orm"
import {
  getDb,
  EntityRefTable,
  PendingUpdateTable,
  ChapterTable,
  CharacterTable,
  RelationshipTable,
  ForeshadowingTable,
  PlotThreadTable,
  WorldEntryTable,
} from "@opennovel-ai/novel-store"

// ─── 类型定义 ───

/** 触发一次影响分析的变更意图（已解析为真实 ID 与新旧值） */
export type ChangeIntent = {
  novelId: string
  entityType: string
  entityId: string
  field: string
  oldValue: string
  newValue: string
  reason: string
}

/** 影响发现：确定性引用 / 结构性依赖 / 语义建议 */
export type ImpactFinding = {
  kind: "deterministic" | "structural" | "semantic"
  sourceType: string
  sourceId: string
  refField: string
  refText: string
  priority: "high" | "medium" | "low"
}

/** 统一影响报告（工具输出 metadata 的固定结构） */
export type ImpactReport = {
  impact_plan: {
    entity_type: string
    entity_id: string
    field: string
    old_value: string
    new_value: string
  }
  findings: ImpactFinding[]
  task_count: number
  pending_count: number
  blocked_writing: boolean
  next_actions: string[]
}

// ─── 内部工具 ───

type Db = ReturnType<typeof getDb>

function cascadePriority(triggerType: string, sourceType: string): "high" | "medium" | "low" {
  if (triggerType === "character" && sourceType === "relationship") return "high"
  if (triggerType === "world_entry" && sourceType === "chapter") return "high"
  if (triggerType === "style") return "high"
  if (triggerType === "character" && sourceType === "chapter") return "medium"
  if (triggerType === "plot_thread" && sourceType === "chapter") return "medium"
  if (triggerType === "foreshadow" && sourceType === "chapter") return "medium"
  return "low"
}

/** 已写正文的章节存在时才产生统改任务——初始建设定阶段不产生 */
async function hasWrittenChapters(db: Db, novelId: string): Promise<boolean> {
  const rows = await db
    .select({ id: ChapterTable.id })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), ne(ChapterTable.status, "outline")))
    .limit(1)
    .all()
  return rows.length > 0
}

// ─── 影响计划查询（只读） ───

/**
 * 查询一次变更的影响计划。不修改数据库：只读 entity_refs 引用与结构性依赖。
 * 语义建议不在确定性查询范围内（由 AI 侧另行提出）。
 */
export async function planImpact(db: Db, intent: ChangeIntent): Promise<ImpactFinding[]> {
  if (!intent.entityType || !intent.entityId) {
    throw new Error("影响计划需要 entityType 与 entityId：变更意图不完整")
  }
  const findings: ImpactFinding[] = []
  const seen = new Set<string>()

  const refs = await db
    .select({
      source_type: EntityRefTable.source_type,
      source_id: EntityRefTable.source_id,
      ref_field: EntityRefTable.ref_field,
      ref_text: EntityRefTable.ref_text,
    })
    .from(EntityRefTable)
    .where(
      and(
        eq(EntityRefTable.novel_id, intent.novelId),
        eq(EntityRefTable.target_type, intent.entityType),
        eq(EntityRefTable.target_id, intent.entityId),
      ),
    )
    .all()
  for (const ref of refs) {
    const key = `d:${ref.source_type}:${ref.source_id}:${ref.ref_field}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({
      kind: "deterministic",
      sourceType: ref.source_type,
      sourceId: ref.source_id,
      refField: ref.ref_field,
      refText: ref.ref_text,
      priority: cascadePriority(intent.entityType, ref.source_type),
    })
  }

  for (const dep of await structuralDeps(db, intent)) {
    const key = `s:${dep.sourceType}:${dep.sourceId}:${dep.refField}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push(dep)
  }
  return findings
}

/** 结构性依赖：数据库外键或稳定关系（关系端点、伏笔章节、剧情线归属） */
async function structuralDeps(db: Db, intent: ChangeIntent): Promise<ImpactFinding[]> {
  const out: ImpactFinding[] = []
  if (intent.entityType === "character") {
    // 关系两端任一命中即视为结构依赖
    const rels = await db
      .select({ id: RelationshipTable.id, type: RelationshipTable.type })
      .from(RelationshipTable)
      .where(
        and(
          eq(RelationshipTable.novel_id, intent.novelId),
          or(eq(RelationshipTable.char_a_id, intent.entityId), eq(RelationshipTable.char_b_id, intent.entityId)),
        ),
      )
      .all()
    for (const rel of rels) {
      out.push({
        kind: "structural",
        sourceType: "relationship",
        sourceId: rel.id,
        refField: "char_endpoints",
        refText: `关系「${rel.type}」以该角色为一端`,
        priority: "high",
      })
    }
  }
  if (intent.entityType === "foreshadow") {
    const rows = await db
      .select({ id: ForeshadowingTable.id, planted: ForeshadowingTable.planted_chapter_id, content: ForeshadowingTable.content })
      .from(ForeshadowingTable)
      .where(and(eq(ForeshadowingTable.novel_id, intent.novelId), eq(ForeshadowingTable.id, intent.entityId)))
      .all()
    for (const row of rows) {
      if (!row.planted) continue
      out.push({
        kind: "structural",
        sourceType: "chapter",
        sourceId: row.planted,
        refField: "planted_chapter",
        refText: `伏笔「${row.content.slice(0, 30)}」埋设于该章`,
        priority: "medium",
      })
    }
  }
  if (intent.entityType === "plot_thread") {
    const rows = await db
      .select({ id: PlotThreadTable.id, title: PlotThreadTable.title })
      .from(PlotThreadTable)
      .where(and(eq(PlotThreadTable.novel_id, intent.novelId), eq(PlotThreadTable.id, intent.entityId)))
      .all()
    for (const row of rows) {
      out.push({
        kind: "structural",
        sourceType: "plot_thread",
        sourceId: row.id,
        refField: "thread_status",
        refText: `剧情线「${row.title}」的状态变化影响后续大纲`,
        priority: "medium",
      })
    }
  }
  return out
}

// ─── 任务生成 ───

/**
 * 按影响计划创建任务（确定性 + 结构性）。稳定键判重：同一变更对同一对象
 * （含 trigger_field）已有 pending 任务时不重复创建。返回新增任务数。
 */
export async function applyImpact(db: Db, intent: ChangeIntent): Promise<number> {
  if (!intent.entityType || !intent.entityId) {
    throw new Error("影响任务需要 entityType 与 entityId：变更意图不完整")
  }
  if (!(await hasWrittenChapters(db, intent.novelId))) return 0
  const findings = await planImpact(db, intent)
  let count = 0
  for (const finding of findings) {
    const existing = await db
      .select({ id: PendingUpdateTable.id })
      .from(PendingUpdateTable)
      .where(
        and(
          eq(PendingUpdateTable.novel_id, intent.novelId),
          eq(PendingUpdateTable.source_type, finding.sourceType),
          eq(PendingUpdateTable.source_id, finding.sourceId),
          eq(PendingUpdateTable.trigger_type, intent.entityType),
          eq(PendingUpdateTable.trigger_id, intent.entityId),
          eq(PendingUpdateTable.trigger_field, intent.field),
          eq(PendingUpdateTable.status, "pending"),
        ),
      )
      .limit(1)
      .all()
    if (existing.length > 0) continue
    await db
      .insert(PendingUpdateTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: intent.novelId,
        source_type: finding.sourceType,
        source_id: finding.sourceId,
        trigger_type: intent.entityType,
        trigger_id: intent.entityId,
        trigger_field: intent.field,
        old_value: intent.oldValue,
        new_value: intent.newValue,
        reason: intent.reason,
        status: "pending",
        priority: finding.priority,
      } as any)
      .run()
    count++
  }
  return count
}

/** 语义影响建议入库：requires_confirmation 状态，确认前不进入执行队列 */
export async function createSemanticSuggestions(
  db: Db,
  intent: ChangeIntent,
  suggestions: { sourceType: string; sourceId: string; refField: string; refText: string; priority?: "high" | "medium" | "low" }[],
): Promise<number> {
  if (!(await hasWrittenChapters(db, intent.novelId))) return 0
  let count = 0
  for (const s of suggestions) {
    const existing = await db
      .select({ id: PendingUpdateTable.id })
      .from(PendingUpdateTable)
      .where(
        and(
          eq(PendingUpdateTable.novel_id, intent.novelId),
          eq(PendingUpdateTable.source_type, s.sourceType),
          eq(PendingUpdateTable.source_id, s.sourceId),
          eq(PendingUpdateTable.trigger_type, intent.entityType),
          eq(PendingUpdateTable.trigger_id, intent.entityId),
          eq(PendingUpdateTable.trigger_field, s.refField),
          eq(PendingUpdateTable.status, "requires_confirmation"),
        ),
      )
      .limit(1)
      .all()
    if (existing.length > 0) continue
    await db
      .insert(PendingUpdateTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: intent.novelId,
        source_type: s.sourceType,
        source_id: s.sourceId,
        trigger_type: intent.entityType,
        trigger_id: intent.entityId,
        trigger_field: s.refField,
        old_value: intent.oldValue,
        new_value: intent.newValue,
        reason: `[语义建议] ${intent.reason}：${s.refText}`,
        status: "requires_confirmation",
        priority: s.priority ?? "low",
      } as any)
      .run()
    count++
  }
  return count
}

/** 用户确认语义建议 → 转 pending 进入执行队列 */
export async function confirmSemanticSuggestion(db: Db, taskId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: PendingUpdateTable.id, status: PendingUpdateTable.status })
    .from(PendingUpdateTable)
    .where(eq(PendingUpdateTable.id, taskId))
    .limit(1)
    .all()
  if (!row || row.status !== "requires_confirmation") return false
  await db
    .update(PendingUpdateTable)
    .set({ status: "pending" } as any)
    .where(eq(PendingUpdateTable.id, taskId))
    .run()
  return true
}

/** 用户拒绝语义建议 → 标记 ignored，系统不据此自动修改任何内容 */
export async function ignoreSemanticSuggestion(db: Db, taskId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: PendingUpdateTable.id, status: PendingUpdateTable.status })
    .from(PendingUpdateTable)
    .where(eq(PendingUpdateTable.id, taskId))
    .limit(1)
    .all()
  if (!row || row.status !== "requires_confirmation") return false
  await db
    .update(PendingUpdateTable)
    .set({ status: "ignored", resolved_at: Date.now() } as any)
    .where(eq(PendingUpdateTable.id, taskId))
    .run()
  return true
}

// ─── 统一报告 ───

/** 汇总统一影响报告：任务数、待处理数、门禁状态与建议动作 */
export async function buildImpactReport(
  db: Db,
  intent: ChangeIntent,
  findings: ImpactFinding[],
  tasksCreated: number,
): Promise<ImpactReport> {
  const pending = await db
    .select({ id: PendingUpdateTable.id, priority: PendingUpdateTable.priority, status: PendingUpdateTable.status })
    .from(PendingUpdateTable)
    .where(and(eq(PendingUpdateTable.novel_id, intent.novelId), eq(PendingUpdateTable.status, "pending")))
    .all()
  const confirmations = await db
    .select({ id: PendingUpdateTable.id })
    .from(PendingUpdateTable)
    .where(
      and(eq(PendingUpdateTable.novel_id, intent.novelId), eq(PendingUpdateTable.status, "requires_confirmation")),
    )
    .all()
  const high = pending.filter((t) => t.priority === "high")
  const nextActions: string[] = []
  if (pending.length > 0) nextActions.push(`用 cascade_list_pending 查看待处理任务（当前 ${pending.length} 个）`)
  if (high.length > 0) nextActions.push(`优先处理 ${high.length} 个高优先级任务`)
  if (confirmations.length > 0) nextActions.push(`用 impact_semantic_review 确认或忽略 ${confirmations.length} 条语义建议`)
  if (pending.length > 0) nextActions.push("用 cascade_execute 批量处理；门禁未解除前不要写新章节")
  return {
    impact_plan: {
      entity_type: intent.entityType,
      entity_id: intent.entityId,
      field: intent.field,
      old_value: intent.oldValue.slice(0, 200),
      new_value: intent.newValue.slice(0, 200),
    },
    findings: findings.slice(0, 20),
    task_count: tasksCreated,
    pending_count: pending.length,
    blocked_writing: pending.length > 0,
    next_actions: nextActions,
  }
}

/** 实体名称（用于报告与提示词） */
export async function entityLabel(db: Db, entityType: string, entityId: string): Promise<string> {
  if (entityType === "character") {
    const [row] = await db.select({ name: CharacterTable.name }).from(CharacterTable).where(eq(CharacterTable.id, entityId)).limit(1).all()
    return row?.name ?? entityId
  }
  if (entityType === "world_entry") {
    const [row] = await db.select({ title: WorldEntryTable.title }).from(WorldEntryTable).where(eq(WorldEntryTable.id, entityId)).limit(1).all()
    return row?.title ?? entityId
  }
  return entityId
}
