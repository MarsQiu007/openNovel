/**
 * 暂存变更共享服务 — setting-review-hub 任务 2.3。
 *
 * createStagedChangesFromPlan 是 stage 的落点：计划先过 validateOrganizePlan 完整校验，
 * 校验通过才按操作逐条落暂存（一条操作一行），同一目标的旧 pending 草案标为 superseded；
 * acceptStagedChange 是接受执行点：把草案转回整理计划做完整重校验，通过才
 * executeOrganizePlan 执行并留痕，失败不改任何数据。delete / merge 草案同样走此通路。
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { StagedChangeTable, getDb } from "./session-store.js"
import {
  executeOrganizePlan,
  loadOrganizeContext,
  validateOrganizePlan,
  type OrganizeEntity,
  type OrganizeEntityType,
  type OrganizePlan,
  type OrganizePlanFields,
  type OrganizeExecutionResult,
} from "./setting-reorganization.js"

type Db = ReturnType<typeof getDb>

export type StagedChangeRow = typeof StagedChangeTable.$inferSelect

const STAGED_KINDS = ["update", "merge", "delete"] as const
export type StagedKind = (typeof STAGED_KINDS)[number]

export async function listStagedChanges(
  db: Db,
  query: { novelId: string; status?: string; limit?: number; offset?: number },
): Promise<{ total: number; rows: StagedChangeRow[] }> {
  const status = query.status ?? "pending"
  const where = and(eq(StagedChangeTable.novel_id, query.novelId), eq(StagedChangeTable.status, status))
  const total = await db
    .select({ c: sql<number>`count(*)` })
    .from(StagedChangeTable)
    .where(where)
    .get()
  const rows = await db
    .select()
    .from(StagedChangeTable)
    .where(where)
    .orderBy(desc(StagedChangeTable.created_at))
    .limit(query.limit ?? 20)
    .offset(query.offset ?? 0)
    .all()
  return { total: total?.c ?? 0, rows }
}

export type CreateStagedChangesResult =
  | { ok: true; staged_ids: string[]; superseded_ids: string[] }
  | { ok: false; errors: string[] }

/** stage 落点：计划完整校验通过后按操作逐条落暂存（不执行），同目标旧 pending 草案标 superseded */
export async function createStagedChangesFromPlan(
  directory: string,
  novelId: string,
  plan: OrganizePlan,
  options: { source?: "agent" | "user"; evidence?: Record<string, unknown>; reason?: string } = {},
): Promise<CreateStagedChangesResult> {
  const context = await loadOrganizeContext(directory, novelId)
  const validation = validateOrganizePlan({
    plan,
    entries: context.entities,
    referencedKeys: context.referencedKeys,
    relatedCharacterIds: context.relatedCharacterIds,
  })
  if (!validation.ok) {
    return { ok: false, errors: validation.errors }
  }
  const db = getDb(directory)
  const stagedIds: string[] = []
  const supersededIds: string[] = []
  for (const operation of plan.operations) {
    const entryIds =
      operation.action === "update"
        ? [operation.id]
        : operation.action === "merge"
          ? [operation.target_id, ...operation.source_ids]
          : [operation.id]
    // 同一目标的旧 pending 草案被新草案替代
    const stale = await supersedePendingDrafts(db, novelId, operation.entity_type, operation.action, entryIds)
    supersededIds.push(...stale)
    const entity = context.entities.find((e) => e.entity_type === operation.entity_type && e.id === entryIds[0])
    const beforeJson =
      operation.action === "update"
        ? pickFields(entity, Object.keys(operation.fields))
        : operation.action === "merge"
          ? JSON.stringify({ target: pickFields(entity, Object.keys(operation.fields)) })
          : JSON.stringify({ title: entity?.title ?? "" })
    const id = crypto.randomUUID()
    db
      .insert(StagedChangeTable)
      .values({
        id,
        novel_id: novelId,
        source: options.source ?? "agent",
        kind: operation.action,
        entity_type: operation.entity_type,
        entry_ids: JSON.stringify(entryIds),
        before_json: beforeJson,
        after_json: JSON.stringify(operation.action === "delete" ? {} : operation.fields),
        reason: operation.reason || options.reason || "",
        evidence_json: JSON.stringify(options.evidence ?? {}),
        status: "pending",
      })
      .run()
    stagedIds.push(id)
  }
  return { ok: true, staged_ids: stagedIds, superseded_ids: supersededIds }
}

/** 草案 → 整理计划（accept 重校验用） */
function stagedToPlan(row: StagedChangeRow): OrganizePlan | null {
  const entryIds = JSON.parse(row.entry_ids) as string[]
  const after = JSON.parse(row.after_json) as OrganizePlanFields
  const entityType = row.entity_type as OrganizeEntityType
  if (row.kind === "update" && entryIds.length === 1 && entryIds[0]) {
    return { version: 2, operations: [{ action: "update", entity_type: entityType, id: entryIds[0], fields: after, reason: row.reason }] }
  }
  if (row.kind === "merge" && entryIds.length >= 2 && entryIds[0]) {
    return {
      version: 2,
      operations: [{ action: "merge", entity_type: entityType, target_id: entryIds[0], source_ids: entryIds.slice(1), fields: after, reason: row.reason }],
    }
  }
  if (row.kind === "delete" && entryIds.length === 1 && entryIds[0]) {
    return { version: 2, operations: [{ action: "delete", entity_type: entityType, id: entryIds[0], reason: row.reason }] }
  }
  return null
}

export type AcceptStagedChangeResult =
  | { ok: true; staged_id: string; execution: OrganizeExecutionResult }
  | { ok: false; error?: string; errors?: string[] }

/** 接受执行点：重校验通过才执行并留痕；校验失败不改任何数据 */
export async function acceptStagedChange(
  directory: string,
  stagedId: string,
  options: { afterOverride?: Record<string, unknown> } = {},
): Promise<AcceptStagedChangeResult> {
  const db = getDb(directory)
  const [row] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, stagedId)).all()
  if (!row) {
    return { ok: false, error: `暂存变更不存在：${stagedId.slice(0, 8)}` }
  }
  if (row.status !== "pending") {
    return { ok: false, error: `暂存变更为 ${row.status} 状态，不可接受` }
  }
  if (!STAGED_KINDS.includes(row.kind as StagedKind)) {
    return { ok: false, error: `未知的暂存变更类型：${row.kind}` }
  }
  const draft = options.afterOverride
    ? { ...row, after_json: JSON.stringify(options.afterOverride) }
    : row
  const plan = stagedToPlan(draft)
  if (!plan) {
    return { ok: false, error: `暂存变更数据不完整（kind=${row.kind}, entry_ids=${row.entry_ids}）` }
  }
  // 接受即用户显式确认：仍走服务端完整重校验（编辑后的 after 同样受限）
  const context = await loadOrganizeContext(directory, row.novel_id)
  const validation = validateOrganizePlan({
    plan,
    entries: context.entities,
    referencedKeys: context.referencedKeys,
    relatedCharacterIds: context.relatedCharacterIds,
  })
  if (!validation.ok) {
    return { ok: false, errors: validation.errors }
  }
  const execution = await executeOrganizePlan(plan, { directory, novelId: row.novel_id })
  const failed = execution.results.find((r) => r.status === "failed")
  if (failed) {
    // 执行失败（如并发修改）：保持 pending，让用户可重试或编辑后重试
    return { ok: false, error: failed.error ?? "暂存变更执行失败" }
  }
  db
    .update(StagedChangeTable)
    .set({ status: "accepted", resolved_at: Date.now() })
    .where(eq(StagedChangeTable.id, stagedId))
    .run()
  return { ok: true, staged_id: stagedId, execution }
}

export type RejectStagedChangeResult =
  | { ok: true; staged_id: string }
  | { ok: false; error: string }

export async function rejectStagedChange(db: Db, stagedId: string): Promise<RejectStagedChangeResult> {
  const [row] = await db.select().from(StagedChangeTable).where(eq(StagedChangeTable.id, stagedId)).all()
  if (!row) {
    return { ok: false, error: `暂存变更不存在：${stagedId.slice(0, 8)}` }
  }
  if (row.status !== "pending") {
    return { ok: false, error: `暂存变更为 ${row.status} 状态，不可拒绝` }
  }
  db
    .update(StagedChangeTable)
    .set({ status: "rejected", resolved_at: Date.now() })
    .where(eq(StagedChangeTable.id, stagedId))
    .run()
  return { ok: true, staged_id: stagedId }
}

/** 超越同目标旧草案：与本次操作同实体类型、同动作且目标重叠的 pending 草案标为 superseded */
async function supersedePendingDrafts(
  db: Db,
  novelId: string,
  entityType: OrganizeEntityType,
  kind: StagedKind,
  entryIds: string[],
): Promise<string[]> {
  const pending = await db
    .select()
    .from(StagedChangeTable)
    .where(and(eq(StagedChangeTable.novel_id, novelId), eq(StagedChangeTable.status, "pending")))
    .all()
  const ids = pending
    .filter((row) => row.entity_type === entityType && row.kind === kind)
    .filter((row) => (JSON.parse(row.entry_ids) as string[]).some((id) => entryIds.includes(id)))
    .map((row) => row.id)
  if (ids.length === 0) return []
  await db
    .update(StagedChangeTable)
    .set({ status: "superseded", resolved_at: Date.now() })
    .where(inArray(StagedChangeTable.id, ids))
    .run()
  return ids
}

function pickFields(entity: OrganizeEntity | undefined, fields: string[]): string {
  if (!entity) return "{}"
  const picked: Record<string, unknown> = {}
  for (const field of fields) {
    picked[field] = (entity as Record<string, unknown>)[field]
  }
  return JSON.stringify(picked)
}
