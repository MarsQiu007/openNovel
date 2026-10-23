import { Layer } from "effect"
import {
  acceptPendingSetting,
  listPendingSettingRows,
  mergePendingSettings,
  rejectPendingSetting,
} from "@opennovel-ai/plugin/novel-writer/setting-review-candidates"
import { listConflicts, resolveConflict } from "@opennovel-ai/plugin/novel-writer/setting-review-conflicts"
import { acceptStagedChange, listStagedChanges, rejectStagedChange } from "@opennovel-ai/plugin/novel-writer/setting-review-staged"
import { runSettingReviewBatch } from "@opennovel-ai/plugin/novel-writer/setting-review-batch"
import { loadOrganizeEntities } from "@opennovel-ai/plugin/novel-writer/setting-reorganization"
import { SettingReviewInbox, type ReviewInboxListQuery, type SettingReviewInboxService } from "@opennovel-ai/server/setting-review-inbox"
import { getDb } from "@opennovel-ai/plugin/novel-writer/session-store"
import { PendingSettingTable, StagedChangeTable, WorldEntryConflictTable } from "@opennovel-ai/novel-store"
import { eq, sql } from "drizzle-orm"
import type {
  ReviewInboxCandidateAcceptInput,
  ReviewInboxCandidateMergeInput,
  ReviewInboxCandidateOperationResult,
  ReviewInboxConflictResolveInput,
  ReviewInboxConflictResolveResult,
  ReviewInboxCounts,
  ReviewInboxItem,
  ReviewInboxListResult,
  ReviewInboxStagedAcceptInput,
  ReviewInboxStagedResolveResult,
  ReviewInboxBatchInput,
  ReviewInboxBatchResult,
} from "@opennovel-ai/schema/novel"
import type { OrganizeEntity } from "@opennovel-ai/plugin/novel-writer/setting-reorganization"

type Db = ReturnType<typeof getDb>

const PAYLOAD_PREVIEW_LIMIT = 160

function preview(text: string): string {
  return text.length > PAYLOAD_PREVIEW_LIMIT ? text.slice(0, PAYLOAD_PREVIEW_LIMIT) + "…" : text
}

function titleOf(entity: OrganizeEntity | undefined, fallback: string): string {
  if (!entity) return fallback
  return entity.title || entity.name || fallback
}

function countsOf(db: Db, novelId: string): ReviewInboxCounts {
  const pending = db
    .select({ c: sql<number>`count(*)` })
    .from(PendingSettingTable)
    .where(eq(PendingSettingTable.novel_id, novelId))
    .get()?.c ?? 0
  const conflicts = db
    .select({ c: sql<number>`count(*)` })
    .from(WorldEntryConflictTable)
    .where(sql`${WorldEntryConflictTable.novel_id} = ${novelId} AND ${WorldEntryConflictTable.resolved} = 0`)
    .get()?.c ?? 0
  const staged = db
    .select({ c: sql<number>`count(*)` })
    .from(StagedChangeTable)
    .where(sql`${StagedChangeTable.novel_id} = ${novelId} AND ${StagedChangeTable.status} = 'pending'`)
    .get()?.c ?? 0
  return { candidates: pending, conflicts, staged, total: pending + conflicts + staged }
}

function candidateItem(row: typeof PendingSettingTable.$inferSelect): ReviewInboxItem {
  return {
    id: row.id,
    source: "candidate",
    kind: row.candidate_type,
    title: row.display_title,
    targetId: row.suggested_entity_id || null,
    summary: preview(row.payload_json),
    evidence: row.type_strength ? `type_strength=${row.type_strength}` : `importance=${row.importance}`,
    before: "",
    after: row.payload_json,
    status: row.status,
    createdAt: row.created_at,
    sourceChapterId: row.source_chapter_id,
    reviewNote: row.review_note,
  }
}

function conflictItem(row: typeof WorldEntryConflictTable.$inferSelect, entryTitle: string | null): ReviewInboxItem {
  return {
    id: row.id,
    source: "conflict",
    kind: row.conflict_kind,
    title: entryTitle ?? "（条目缺失）",
    targetId: row.world_entry_id,
    summary: row.conflict_note,
    evidence: row.conflict_note,
    before: "",
    after: "",
    status: row.resolved === 1 ? "resolved" : "unresolved",
    createdAt: row.created_at,
    sourceChapterId: row.source_chapter_id,
    reviewNote: row.resolution_note,
  }
}

function stagedItem(
  row: typeof StagedChangeTable.$inferSelect,
  entities: OrganizeEntity[],
): ReviewInboxItem {
  const entryIds = JSON.parse(row.entry_ids) as string[]
  const target = entities.find((entity) => entity.id === entryIds[0])
  return {
    id: row.id,
    source: "staged",
    kind: row.kind,
    title: titleOf(target, preview(row.reason) || `（${row.entity_type}）`),
    targetId: entryIds[0] ?? null,
    summary: row.reason,
    evidence: Object.keys(JSON.parse(row.evidence_json) as Record<string, unknown>).length
      ? row.evidence_json
      : "批处理 / stage 产出",
    before: row.before_json,
    after: row.after_json,
    status: row.status,
    createdAt: row.created_at,
    sourceChapterId: null,
    reviewNote: row.review_note,
  }
}

function mapImpact(impact: { task_count: number; pending_count: number; blocked_writing: boolean }) {
  return { taskCount: impact.task_count, pendingCount: impact.pending_count, blockedWriting: impact.blocked_writing }
}

function rejectedCandidate(error: string, formatErrors?: string[]): ReviewInboxCandidateOperationResult {
  return formatErrors ? { ok: false, error, formatErrors } : { ok: false, error }
}

export function createSettingReviewInboxService(): SettingReviewInboxService {
  return {
    async list(novelID, directory, query: ReviewInboxListQuery) {
      const db = getDb(directory)
      const counts = countsOf(db, novelID)
      const limit = query.limit ?? 50
      const offset = query.offset ?? 0
      const source = query.source
      const items: ReviewInboxItem[] = []
      const wants = (candidate: "candidate" | "conflict" | "staged") => !source || source === candidate
      if (wants("candidate")) {
        const rows = await listPendingSettingRows(db, { novelId: novelID, limit: limit + offset, offset: 0 })
        items.push(...rows.rows.slice(offset, offset + limit).map(candidateItem))
      }
      if (wants("conflict")) {
        const rows = await listConflicts(db, { novelId: novelID, limit: limit + offset, offset: 0 })
        items.push(...rows.rows.slice(offset, offset + limit).map((row) => conflictItem(row, row.entry_title)))
      }
      if (wants("staged")) {
        const rows = await listStagedChanges(db, { novelId: novelID, limit: limit + offset, offset: 0 })
        const entities = await loadOrganizeEntities(directory, novelID)
        items.push(...rows.rows.slice(offset, offset + limit).map((row) => stagedItem(row, entities)))
      }
      items.sort((a, b) => b.createdAt - a.createdAt)
      const result: ReviewInboxListResult = { items: items.slice(0, limit), total: counts.total, counts }
      return result
    },

    async counts(novelID, directory) {
      return countsOf(getDb(directory), novelID)
    },

    async acceptCandidate(novelID, directory, candidateID, input: ReviewInboxCandidateAcceptInput) {
      const result = await acceptPendingSetting(getDb(directory), candidateID, { allowNewCategory: input.allowNewCategory })
      if (!result.ok) return rejectedCandidate(result.error, result.format_errors)
      return {
        ok: true,
        pendingId: result.pending_id,
        createdId: result.created_id,
        candidateType: result.candidate_type,
        displayTitle: result.display_title,
        impact: mapImpact(result.impact),
      }
    },

    async rejectCandidate(novelID, directory, candidateID) {
      const result = await rejectPendingSetting(getDb(directory), candidateID)
      if (!result.ok) return rejectedCandidate(result.error)
      return { ok: true, pendingId: result.pending_id, candidateType: result.candidate_type, displayTitle: result.display_title }
    },

    async mergeCandidates(novelID, directory, input: ReviewInboxCandidateMergeInput) {
      const result = await mergePendingSettings(getDb(directory), [...input.pendingIds], {
        newId: input.newId,
        allowNewCategory: input.allowNewCategory,
      })
      if (!result.ok) return rejectedCandidate(result.error, result.format_errors)
      return {
        ok: true,
        pendingId: result.source_pending_ids[0],
        createdId: result.created_id,
        candidateType: result.candidate_type,
        displayTitle: result.display_title,
        impact: mapImpact(result.impact),
      }
    },

    async resolveConflict(novelID, directory, conflictID, input: ReviewInboxConflictResolveInput) {
      const result = await resolveConflict(getDb(directory), conflictID, {
        action: input.action,
        content: input.content,
        note: input.note,
        source: input.source,
      })
      if (!result.ok) return { ok: false, error: result.error }
      return {
        ok: true,
        conflictId: result.conflict_id,
        action: result.action,
        stagedChangeId: result.staged_change_id,
        rewriteTasks: result.rewrite_tasks,
      }
    },

    async acceptStaged(novelID, directory, stagedID, input: ReviewInboxStagedAcceptInput) {
      const result = await acceptStagedChange(directory, stagedID, {
        afterOverride: input.after as Record<string, unknown> | undefined,
      })
      if (!result.ok) {
        return { ok: false, stagedId: stagedID, error: result.error, errors: result.errors }
      }
      return {
        ok: true,
        stagedId: result.staged_id,
        execution: {
          ok: result.execution.ok,
          errors: [],
          results: result.execution.results.map((item) => ({
            index: item.index,
            action: item.action,
            entityType: item.entity_type,
            status: item.status,
            entryIds: [...item.entry_ids],
            changedFields: item.changed_fields,
            historyCount: item.history_count,
            cascadeTasks: item.cascade_tasks,
            error: item.error,
          })),
          remaining: result.execution.remaining.map((item) => ({
            index: item.index,
            action: item.action,
            entityType: item.entity_type,
            entryIds: [...item.entry_ids],
          })),
        },
      }
    },

    async rejectStaged(novelID, directory, stagedID) {
      const result = await rejectStagedChange(getDb(directory), stagedID)
      if (!result.ok) return { ok: false, stagedId: stagedID, error: result.error }
      return { ok: true, stagedId: result.staged_id }
    },

    async batch(novelID, directory, input: ReviewInboxBatchInput) {
      const failed = (errors: string[]): ReviewInboxBatchResult => ({
        ok: false,
        autoExecuted: 0,
        pendingAdded: 0,
        stagedIds: [],
        supersededIds: [],
        errors,
      })
      let plan: unknown
      try {
        plan = JSON.parse(input.planJson)
      } catch (error) {
        return failed([`planJson 解析失败：${error instanceof Error ? error.message : String(error)}`])
      }
      if (!plan || typeof plan !== "object" || !Array.isArray((plan as { operations?: unknown }).operations)) {
        return failed(["planJson 必须是含 operations 数组的整理计划"])
      }
      const result = await runSettingReviewBatch(directory, novelID, plan as Parameters<typeof runSettingReviewBatch>[2], {
        source: input.source ?? "user",
      })
      if (!result.ok) return failed(result.errors)
      return {
        ok: true,
        autoExecuted: result.auto_executed,
        pendingAdded: result.pending_added,
        stagedIds: result.staged_ids,
        supersededIds: result.superseded_ids,
        execution: result.execution
          ? {
              ok: result.execution.ok,
              errors: [],
              results: result.execution.results.map((item) => ({
                index: item.index,
                action: item.action,
                entityType: item.entity_type,
                status: item.status,
                entryIds: [...item.entry_ids],
                changedFields: item.changed_fields,
                historyCount: item.history_count,
                cascadeTasks: item.cascade_tasks,
                error: item.error,
              })),
              remaining: result.execution.remaining.map((item) => ({
                index: item.index,
                action: item.action,
                entityType: item.entity_type,
                entryIds: [...item.entry_ids],
              })),
            }
          : undefined,
        errors: [],
      }
    },
  }
}

export const SettingReviewInboxLayer = Layer.succeed(SettingReviewInbox, createSettingReviewInboxService())
