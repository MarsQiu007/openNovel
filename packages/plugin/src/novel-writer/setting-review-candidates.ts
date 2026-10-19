/**
 * 候选区（pending_settings）操作共享服务 — setting-review-hub 任务 2.1。
 *
 * accept / reject / merge / list 的核心逻辑从 novel-writer.ts 的 agent 工具抽出，
 * 供工具与收件箱 UI 端点共用（单一事实源）。业务失败用 { ok: false } 结果表达，
 * 错误文案与既有工具输出保持一致；插入与影响面链路的异常统一折算成「入库/合并失败」。
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import {
  CharacterTable,
  PendingSettingTable,
  RelationshipTable,
  WorldEntryTable,
  getDb,
} from "./session-store.js"
import { normalizeSettingText, settingTextFormatError } from "./setting-text.js"
import { validateWorldCategory } from "./world-category.js"
import { applyImpact, buildImpactReport, planImpact, type ImpactReport } from "./setting-impact.js"
import { scanReferences } from "./state-commit.js"

type Db = ReturnType<typeof getDb>

export type PendingSettingRow = typeof PendingSettingTable.$inferSelect

/** 各候选类型的纯文本字段（accept / merge / save_novel_settings / update_setting 共用的写入前校验范围） */
export const SETTING_TEXT_FIELDS: Record<string, string[]> = {
  character: ["description"],
  world_entry: ["title", "content"],
  plot_thread: ["title", "description"],
  foreshadowing: ["content"],
  volume: ["title", "summary"],
  relationship: ["description"],
  location: ["description"],
}

export type CandidateOpFailure = {
  ok: false
  error: string
  /** 设定文本格式校验失败明细；仅格式失败时携带 */
  format_errors?: string[]
  /** 失败时的候选上下文（供调用方拼 metadata） */
  pending_id?: string
  candidate_type?: string
}

export type ListPendingSettingsQuery = {
  novelId: string
  status?: string
  candidateType?: string
  sourceChapterId?: string
  limit?: number
  offset?: number
}

export async function listPendingSettingRows(
  db: Db,
  query: ListPendingSettingsQuery,
): Promise<{ total: number; rows: PendingSettingRow[] }> {
  const status = query.status ?? "pending"
  const conditions = [eq(PendingSettingTable.novel_id, query.novelId), eq(PendingSettingTable.status, status)]
  if (query.candidateType) conditions.push(eq(PendingSettingTable.candidate_type, query.candidateType))
  if (query.sourceChapterId) conditions.push(eq(PendingSettingTable.source_chapter_id, query.sourceChapterId))
  const where = and(...conditions)
  const total = await db
    .select({ c: sql<number>`count(*)` })
    .from(PendingSettingTable)
    .where(where)
    .get()
  const rows = await db
    .select()
    .from(PendingSettingTable)
    .where(where)
    .orderBy(desc(PendingSettingTable.created_at))
    .limit(query.limit ?? 20)
    .offset(query.offset ?? 0)
    .all()
  return { total: total?.c ?? 0, rows }
}

export type AcceptPendingSettingResult =
  | {
      ok: true
      pending_id: string
      created_id: string
      candidate_type: string
      display_title: string
      impact: ImpactReport
    }
  | CandidateOpFailure

export async function acceptPendingSetting(
  db: Db,
  pendingId: string,
  options: { allowNewCategory?: boolean } = {},
): Promise<AcceptPendingSettingResult> {
  const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, pendingId)).all()
  if (!row) {
    return { ok: false, error: `候选不存在：${pendingId.slice(0, 8)}` }
  }
  if (row.status !== "pending") {
    return { ok: false, error: `候选状态为 ${row.status}，不是 pending，不可接受` }
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>
  } catch {
    return { ok: false, error: `payload_json 解析失败：${row.payload_json}` }
  }
  for (const field of SETTING_TEXT_FIELDS[row.candidate_type] ?? []) {
    if (typeof payload[field] === "string") payload[field] = normalizeSettingText(payload[field] as string)
  }
  const formatErrors = (SETTING_TEXT_FIELDS[row.candidate_type] ?? []).flatMap((field) => {
    const error = settingTextFormatError(payload[field], row.candidate_type, field)
    return error ? [`${row.candidate_type}.${field}：${error}`] : []
  })
  if (formatErrors.length > 0) {
    return {
      ok: false,
      error: `设定文本格式校验失败：\n${formatErrors.join("\n")}`,
      format_errors: formatErrors,
      pending_id: pendingId,
      candidate_type: row.candidate_type,
    }
  }
  const newId = row.suggested_entity_id || crypto.randomUUID()
  try {
    if (row.candidate_type === "character") {
      const charName = String(payload.name ?? row.display_title)
      const [existingChar] = await db
        .select({ id: CharacterTable.id })
        .from(CharacterTable)
        .where(and(eq(CharacterTable.novel_id, row.novel_id), eq(CharacterTable.name, charName)))
        .limit(1)
        .all()
      if (existingChar) {
        return {
          ok: false,
          error: "已存在同名角色「" + charName + "」，不重复创建。请用 merge_pending_settings 合并或更新已有条目。",
        }
      }
      await db.insert(CharacterTable).values({
        id: newId,
        novel_id: row.novel_id,
        name: charName,
        role: String(payload.role ?? ""),
        description: String(payload.description ?? ""),
        status: "active",
      } as any)
    } else if (row.candidate_type === "world_entry") {
      // 分类白名单校验：category 是导览/组装的结构字段，必须使用受控词汇
      const categoryError = validateWorldCategory(String(payload.category ?? ""))
      if (categoryError && !options.allowNewCategory) {
        return { ok: false, error: categoryError }
      }
      // 跨 category 同义检测
      const sameTitle = await db
        .select({ id: WorldEntryTable.id, category: WorldEntryTable.category })
        .from(WorldEntryTable)
        .where(
          and(eq(WorldEntryTable.novel_id, row.novel_id), eq(WorldEntryTable.title, String(payload.title ?? ""))),
        )
        .all()
      if (sameTitle.length > 0) {
        const cats = [...new Set(sameTitle.map((s) => s.category))].join(" / ")
        return {
          ok: false,
          error:
            "已存在同标题世界观条目" +
            String(payload.title ?? "") +
            "（" +
            sameTitle.length +
            " 条，category: " +
            cats +
            "）。拒绝重复创建以避免硬约束冲突。请用 merge_pending_settings 合并或更新已有条目。",
        }
      }
      await db.insert(WorldEntryTable).values({
        id: newId,
        novel_id: row.novel_id,
        category: String(payload.category ?? ""),
        title: String(payload.title ?? row.display_title),
        content: String(payload.content ?? ""),
      } as any)
    } else if (row.candidate_type === "location") {
      const locName = String(payload.name ?? row.display_title)
      const [existingLoc] = await db
        .select({ id: WorldEntryTable.id })
        .from(WorldEntryTable)
        .where(and(eq(WorldEntryTable.novel_id, row.novel_id), eq(WorldEntryTable.title, locName)))
        .limit(1)
        .all()
      if (existingLoc) {
        return {
          ok: false,
          error: "已存在同名地点「" + locName + "」，不重复创建。请用 merge_pending_settings 合并或更新已有条目。",
        }
      }
      await db.insert(WorldEntryTable).values({
        id: newId,
        novel_id: row.novel_id,
        category: "地点",
        title: locName,
        content: String(payload.description ?? ""),
      } as any)
    } else if (row.candidate_type === "relationship") {
      await db.insert(RelationshipTable).values({
        id: newId,
        novel_id: row.novel_id,
        char_a_id: String(payload.char_a_id ?? ""),
        char_b_id: String(payload.char_b_id ?? ""),
        type: String(payload.type ?? ""),
        description: String(payload.description ?? ""),
      } as any)
    } else {
      return { ok: false, error: `不支持的 candidate_type：${row.candidate_type}` }
    }
    // 标记 accepted
    await db
      .update(PendingSettingTable)
      .set({ status: "accepted", resolved_at: Date.now() })
      .where(eq(PendingSettingTable.id, pendingId))
      .run()
    // 统一影响面：候选入库属正式设定变更——重建描述引用并生成任务
    const entityType = row.candidate_type === "location" ? "world_entry" : row.candidate_type
    await scanReferences(db, row.novel_id, entityType, newId, "description", String(payload.description ?? payload.content ?? ""))
    const intent = {
      novelId: row.novel_id,
      entityType,
      entityId: newId,
      field: "create",
      oldValue: "",
      newValue: row.display_title,
      reason: `候选「${row.display_title}」接受入库`,
    }
    const created = await applyImpact(db, intent)
    const impact = await buildImpactReport(db, intent, await planImpact(db, intent), created)
    return {
      ok: true,
      pending_id: pendingId,
      created_id: newId,
      candidate_type: row.candidate_type,
      display_title: row.display_title,
      impact,
    }
  } catch (err) {
    return { ok: false, error: `入库失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

export type RejectPendingSettingResult =
  | { ok: true; pending_id: string; candidate_type: string; display_title: string }
  | CandidateOpFailure

export async function rejectPendingSetting(db: Db, pendingId: string): Promise<RejectPendingSettingResult> {
  const [row] = await db.select().from(PendingSettingTable).where(eq(PendingSettingTable.id, pendingId)).all()
  if (!row) {
    return { ok: false, error: `候选不存在：${pendingId.slice(0, 8)}` }
  }
  if (row.status !== "pending") {
    return { ok: false, error: `候选状态为 ${row.status}，不是 pending，不可拒绝` }
  }
  await db
    .update(PendingSettingTable)
    .set({ status: "rejected", resolved_at: Date.now() })
    .where(eq(PendingSettingTable.id, pendingId))
    .run()
  return { ok: true, pending_id: pendingId, candidate_type: row.candidate_type, display_title: row.display_title }
}

export type MergePendingSettingsResult =
  | {
      ok: true
      merged_count: number
      created_id: string
      candidate_type: string
      display_title: string
      source_pending_ids: string[]
      merged_payload: Record<string, unknown>
      impact: ImpactReport
    }
  | CandidateOpFailure

export async function mergePendingSettings(
  db: Db,
  pendingIds: string[],
  options: { newId?: string; allowNewCategory?: boolean } = {},
): Promise<MergePendingSettingsResult> {
  const rows = await db
    .select()
    .from(PendingSettingTable)
    .where(inArray(PendingSettingTable.id, pendingIds))
    .all()
  if (rows.length !== pendingIds.length) {
    return { ok: false, error: `部分候选不存在（找到 ${rows.length}/${pendingIds.length} 条）` }
  }
  const ct = rows[0]!.candidate_type
  if (!rows.every((r) => r.candidate_type === ct)) {
    return {
      ok: false,
      error: `候选必须同 candidate_type，检测到多种类型混用：${[...new Set(rows.map((r) => r.candidate_type))].join(", ")}`,
    }
  }
  if (rows.some((r) => r.status !== "pending")) {
    return { ok: false, error: `存在非 pending 状态的候选，不可合并` }
  }
  const novelIds = new Set(rows.map((r) => r.novel_id))
  if (novelIds.size > 1) {
    return { ok: false, error: `候选分属不同小说，不可跨书合并` }
  }
  // 解析所有 payload，合并字段（字符串取最长优先）
  const payloads = rows.map((r) => {
    try {
      return { row: r, data: JSON.parse(r.payload_json) as Record<string, unknown> }
    } catch {
      return { row: r, data: {} as Record<string, unknown> }
    }
  })
  const merged: Record<string, unknown> = {}
  for (const p of payloads) {
    for (const [k, v] of Object.entries(p.data)) {
      if (typeof v === "string") {
        if (!merged[k] || (merged[k] as string).length < v.length) merged[k] = v
      } else if (merged[k] === undefined) {
        merged[k] = v
      }
    }
  }
  for (const field of SETTING_TEXT_FIELDS[ct] ?? []) {
    if (typeof merged[field] === "string") merged[field] = normalizeSettingText(merged[field] as string)
  }
  const formatErrors = (SETTING_TEXT_FIELDS[ct] ?? []).flatMap((field) => {
    const error = settingTextFormatError(merged[field], ct, field)
    return error ? [`${ct}.${field}：${error}`] : []
  })
  if (formatErrors.length > 0) {
    return {
      ok: false,
      error: `设定文本格式校验失败：\n${formatErrors.join("\n")}`,
      format_errors: formatErrors,
      candidate_type: ct,
    }
  }
  const createdId = options.newId || crypto.randomUUID()
  const novelId = rows[0]!.novel_id
  try {
    if (ct === "character") {
      await db.insert(CharacterTable).values({
        id: createdId,
        novel_id: novelId,
        name: String(merged.name ?? rows[0]!.display_title),
        role: String(merged.role ?? ""),
        description: String(merged.description ?? ""),
        status: "active",
      } as any)
    } else if (ct === "world_entry" || ct === "location") {
      const mergedCategory = ct === "location" ? "地点" : String(merged.category ?? "")
      const categoryError = validateWorldCategory(mergedCategory)
      if (categoryError && !options.allowNewCategory) {
        return { ok: false, error: categoryError }
      }
      await db.insert(WorldEntryTable).values({
        id: createdId,
        novel_id: novelId,
        category: mergedCategory,
        title: String(merged.title ?? merged.name ?? rows[0]!.display_title),
        content: String(merged.content ?? merged.description ?? ""),
      } as any)
    } else if (ct === "relationship") {
      await db.insert(RelationshipTable).values({
        id: createdId,
        novel_id: novelId,
        char_a_id: String(merged.char_a_id ?? ""),
        char_b_id: String(merged.char_b_id ?? ""),
        type: String(merged.type ?? ""),
        description: String(merged.description ?? ""),
      } as any)
    }
    // 标记源候选为 merged
    for (const id of pendingIds) {
      await db
        .update(PendingSettingTable)
        .set({ status: "merged", resolved_at: Date.now(), merged_into: createdId })
        .where(eq(PendingSettingTable.id, id))
        .run()
    }
    // 统一影响面：合并入库属正式设定变更
    const entityType = ct === "location" ? "world_entry" : ct
    await scanReferences(db, novelId, entityType, createdId, "description", String(merged.description ?? merged.content ?? ""))
    const intent = {
      novelId,
      entityType,
      entityId: createdId,
      field: "create",
      oldValue: "",
      newValue: rows[0]!.display_title,
      reason: `候选「${rows[0]!.display_title}」合并入库`,
    }
    const created = await applyImpact(db, intent)
    const impact = await buildImpactReport(db, intent, await planImpact(db, intent), created)
    return {
      ok: true,
      merged_count: rows.length,
      created_id: createdId,
      candidate_type: ct,
      display_title: rows[0]!.display_title,
      source_pending_ids: pendingIds,
      merged_payload: merged,
      impact,
    }
  } catch (err) {
    return { ok: false, error: `合并失败：${err instanceof Error ? err.message : String(err)}` }
  }
}
