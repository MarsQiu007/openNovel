/**
 * 冲突读取与处理共享服务 — setting-review-hub 任务 2.2。
 *
 * listConflicts 提供冲突的分页读取（默认未解决）；resolveConflict 落两条处理路径：
 * 按正文更新 → 生成暂存草案进收件箱（可编辑后接受）；保留现状 → 忽略留痕。
 * 处理后记录处理方式（resolution_kind）、备注（resolution_note）与时间（resolved_at），
 * 草案侧通过 evidence_json.conflict_id 与冲突互相可见。
 */

import { and, desc, eq, sql } from "drizzle-orm"
import { withTransaction, type Tx } from "@opennovel-ai/novel-store"
import {
  StagedChangeTable,
  WorldEntryConflictTable,
  WorldEntryTable,
  getDb,
} from "./session-store.js"
import { normalizeSettingText, settingTextFormatError } from "./setting-text.js"

type Db = ReturnType<typeof getDb>

export type ConflictRow = typeof WorldEntryConflictTable.$inferSelect & { entry_title: string | null }

export async function listConflicts(
  db: Db,
  query: { novelId: string; status?: "unresolved" | "resolved"; limit?: number; offset?: number },
): Promise<{ total: number; rows: ConflictRow[] }> {
  const resolved = query.status === "resolved" ? 1 : 0
  const where = and(eq(WorldEntryConflictTable.novel_id, query.novelId), eq(WorldEntryConflictTable.resolved, resolved))
  const total = await db
    .select({ c: sql<number>`count(*)` })
    .from(WorldEntryConflictTable)
    .where(where)
    .get()
  const rows = await db
    .select({ conflict: WorldEntryConflictTable, entry_title: WorldEntryTable.title })
    .from(WorldEntryConflictTable)
    .leftJoin(WorldEntryTable, eq(WorldEntryTable.id, WorldEntryConflictTable.world_entry_id))
    .where(where)
    .orderBy(desc(WorldEntryConflictTable.created_at))
    .limit(query.limit ?? 20)
    .offset(query.offset ?? 0)
    .all()
  return { total: total?.c ?? 0, rows: rows.map((r) => ({ ...r.conflict, entry_title: r.entry_title })) }
}

export type ResolveConflictInput = {
  action: "update_entry" | "keep_current"
  /** update_entry 必填：草案的 after content（依据正文或用户编辑） */
  content?: string
  /** 处理备注 → resolution_note */
  note?: string
  /** 暂存草案来源；agent 工具路径传 agent（默认 user） */
  source?: "agent" | "user"
}

export type ResolveConflictResult =
  | { ok: true; conflict_id: string; action: ResolveConflictInput["action"]; staged_change_id?: string }
  | { ok: false; error: string }

export async function resolveConflict(db: Db, conflictId: string, input: ResolveConflictInput): Promise<ResolveConflictResult> {
  const [conflict] = await db.select().from(WorldEntryConflictTable).where(eq(WorldEntryConflictTable.id, conflictId)).all()
  if (!conflict) {
    return { ok: false, error: `冲突不存在：${conflictId.slice(0, 8)}` }
  }
  if (conflict.resolved === 1) {
    return { ok: false, error: `冲突已处理（${conflict.resolution_kind || "已解决"}），不可重复处理` }
  }
  const resolvedAt = Date.now()
  if (input.action === "keep_current") {
    withTransaction(db, (tx: Tx) => {
      markResolved(tx, conflictId, "ignored", input.note ?? "", resolvedAt)
    })
    return { ok: true, conflict_id: conflictId, action: "keep_current" }
  }
  // update_entry：依据冲突说明与草案内容生成暂存变更，进收件箱等接受
  const content = input.content
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, error: "按正文更新需要提供草案内容" }
  }
  const [entry] = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, conflict.world_entry_id)).all()
  if (!entry) {
    return { ok: false, error: `关联的世界观条目不存在：${conflict.world_entry_id.slice(0, 8)}` }
  }
  const normalized = normalizeSettingText(content)
  const formatError = settingTextFormatError(normalized, "world_entry", "content")
  if (formatError) {
    return { ok: false, error: `world_entry.content：${formatError}` }
  }
  const stagedChangeId = crypto.randomUUID()
  withTransaction(db, (tx: Tx) => {
    markResolved(tx, conflictId, "update_draft", input.note ?? "", resolvedAt)
    tx
      .insert(StagedChangeTable)
      .values({
        id: stagedChangeId,
        novel_id: conflict.novel_id,
        source: input.source ?? "user",
        kind: "update",
        entity_type: "world_entry",
        entry_ids: JSON.stringify([conflict.world_entry_id]),
        before_json: JSON.stringify({ title: entry.title, category: entry.category, content: entry.content }),
        after_json: JSON.stringify({ content: normalized }),
        reason: conflict.conflict_note,
        evidence_json: JSON.stringify({
          conflict_id: conflict.id,
          conflict_kind: conflict.conflict_kind,
          source_chapter_id: conflict.source_chapter_id,
        }),
        status: "pending",
      })
      .run()
  })
  return { ok: true, conflict_id: conflictId, action: "update_entry", staged_change_id: stagedChangeId }
}

function markResolved(db: Db | Tx, conflictId: string, resolutionKind: string, note: string, resolvedAt: number) {
  db
    .update(WorldEntryConflictTable)
    .set({ resolved: 1, resolution_kind: resolutionKind, resolution_note: note, resolved_at: resolvedAt })
    .where(eq(WorldEntryConflictTable.id, conflictId))
    .run()
}
