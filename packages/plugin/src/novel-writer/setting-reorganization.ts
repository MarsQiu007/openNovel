import { eq } from "drizzle-orm"
import {
  deleteWorldEntry,
  EntityRefTable,
  getDb,
  updateWorldEntry,
  WorldEntryTable,
} from "./session-store.js"
import {
  archiveDescription,
  cascadeCreateTasks,
  scanReferences,
} from "./state-commit.js"
import {
  normalizeSettingText,
  plainTextFormatError,
  settingTextFormatError,
} from "./setting-text.js"
import { validateWorldCategory } from "./world-category.js"

export type SettingIssueType =
  | "nonstandard_category"
  | "duplicate_title"
  | "similar_title"
  | "empty_field"
  | "long_single_paragraph"
  | "markdown_syntax"

export type SettingIssue = {
  issue_id: string
  type: SettingIssueType
  entry_ids: string[]
  evidence: string
  suggestion: string
}

export type WorldEntryRecord = typeof WorldEntryTable.$inferSelect

export type OrganizePlanFields = {
  category?: string
  title?: string
  content?: string
}

export type OrganizeUpdateOperation = {
  action: "update"
  id: string
  fields: OrganizePlanFields
  reason: string
}

export type OrganizeMergeOperation = {
  action: "merge"
  target_id: string
  source_ids: string[]
  fields: OrganizePlanFields
  reason: string
}

export type OrganizeDeleteOperation = {
  action: "delete"
  id: string
  reason: string
}

export type OrganizeOperation = OrganizeUpdateOperation | OrganizeMergeOperation | OrganizeDeleteOperation

export type OrganizePlan = {
  version: 1
  operations: OrganizeOperation[]
}

export type OrganizeParseResult = {
  plan?: OrganizePlan
  errors: string[]
}

export type OrganizeOperationPreview = {
  index: number
  action: OrganizeOperation["action"]
  entry_ids: string[]
  summary: string
  fields?: string[]
}

export type OrganizeValidationResult = {
  ok: boolean
  errors: string[]
  previews: OrganizeOperationPreview[]
}

export type OrganizeExecutionResult = {
  ok: boolean
  results: Array<
    | {
        index: number
        action: "update"
        status: "success"
        entry_id: string
        changed_fields: string[]
        history_count: number
        cascade_tasks: number
      }
    | {
        index: number
        action: "merge"
        status: "success"
        target_id: string
        source_ids: string[]
        changed_fields: string[]
        history_count: number
        cascade_tasks: number
      }
    | { index: number; action: "delete"; status: "success"; entry_id: string }
    | { index: number; action: OrganizeOperation["action"]; status: "failed"; entry_ids: string[]; error: string }
  >
  remaining: Array<{ index: number; action: OrganizeOperation["action"]; entry_ids: string[] }>
}

const PLAN_FIELD_NAMES = ["category", "title", "content"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function issueId(type: SettingIssueType, entryIds: string[]): string {
  return `${type}:${entryIds.join(",")}`
}

function head(value: string, length = 80): string {
  const text = value.trim()
  return text.length > length ? `${text.slice(0, length)}...` : text
}

export function normalizeTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left)
  const b = normalizeTitle(right)
  if (a.length < 2 || b.length < 2) return 0
  if (a === b) return 1

  const distances = Array.from({ length: a.length + 1 }, (_, index) => [index, ...Array<number>(b.length).fill(0)])
  for (let columnIndex = 0; columnIndex <= b.length; columnIndex += 1) distances[0]![columnIndex] = columnIndex

  for (let rowIndex = 1; rowIndex <= a.length; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= b.length; columnIndex += 1) {
      const substitution = a[rowIndex - 1] === b[columnIndex - 1] ? 0 : 1
      distances[rowIndex]![columnIndex] = Math.min(
        distances[rowIndex - 1]![columnIndex]! + 1,
        distances[rowIndex]![columnIndex - 1]! + 1,
        distances[rowIndex - 1]![columnIndex - 1]! + substitution,
      )
    }
  }

  return 1 - distances[a.length]![b.length]! / Math.max(a.length, b.length)
}

export function analyzeWorldEntries(rows: WorldEntryRecord[]): SettingIssue[] {
  const issues: SettingIssue[] = []

  for (const row of rows) {
    const content = row.content ?? ""
    const categoryError = validateWorldCategory(row.category)
    if (categoryError) {
      issues.push({
        issue_id: issueId("nonstandard_category", [row.id]),
        type: "nonstandard_category",
        entry_ids: [row.id],
        evidence: `${row.title}：${head(categoryError, 120)}`,
        suggestion: "改为标准主分类，必要时保留“主分类/子分类”形式",
      })
    }

    if (!row.title.trim() || !content.trim()) {
      const emptyFields = [!row.title.trim() ? "title" : "", !content.trim() ? "content" : ""].filter(Boolean)
      issues.push({
        issue_id: issueId("empty_field", [row.id]),
        type: "empty_field",
        entry_ids: [row.id],
        evidence: `${row.title || "(无标题)"}：${emptyFields.join("、")}为空`,
        suggestion: "补齐字段，或把该条目合并到已有条目",
      })
    }

    const markdownError = plainTextFormatError(content)
    if (markdownError) {
      issues.push({
        issue_id: issueId("markdown_syntax", [row.id]),
        type: "markdown_syntax",
        entry_ids: [row.id],
        evidence: `${row.title}：${head(markdownError, 120)}`,
        suggestion: "改写为自然句段落，去除 Markdown 语法",
      })
    }

    if (content.trim().length > 200 && !/\n/.test(content)) {
      issues.push({
        issue_id: issueId("long_single_paragraph", [row.id]),
        type: "long_single_paragraph",
        entry_ids: [row.id],
        evidence: `${row.title}：内容 ${content.trim().length} 字且没有换行`,
        suggestion: "按主题拆分为 \\n\\n 分段的纯文本段落",
      })
    }
  }

  const titleGroups = new Map<string, WorldEntryRecord[]>()
  for (const row of rows) {
    const key = row.title.trim()
    if (!key) continue
    titleGroups.set(key, [...(titleGroups.get(key) ?? []), row])
  }
  for (const [title, group] of titleGroups) {
    if (group.length < 2) continue
    issues.push({
      issue_id: issueId("duplicate_title", group.map((row) => row.id)),
      type: "duplicate_title",
      entry_ids: group.map((row) => row.id),
      evidence: `${group.length} 条条目使用标题「${title}」`,
      suggestion: "保留一条，改写或合并其余条目内容",
    })
  }

  const uniqueRows = rows.filter((row) => row.title.trim() && normalizeTitle(row.title).length >= 2)
  const similarPairs = new Set<string>()
  for (let left = 0; left < uniqueRows.length; left += 1) {
    for (let right = left + 1; right < uniqueRows.length; right += 1) {
      const first = uniqueRows[left]!
      const second = uniqueRows[right]!
      if (first.title.trim() === second.title.trim()) continue
      if (titleSimilarity(first.title, second.title) < 0.85) continue
      const ids = [first.id, second.id].sort()
      if (similarPairs.has(ids.join(","))) continue
      similarPairs.add(ids.join(","))
      issues.push({
        issue_id: issueId("similar_title", ids),
        type: "similar_title",
        entry_ids: ids,
        evidence: `「${first.title}」与「${second.title}」标题相似`,
        suggestion: "人工确认是否为同一设定；不要自动删除",
      })
    }
  }

  return issues
}

function parseFields(value: unknown, index: number, errors: string[]): OrganizePlanFields {
  if (!isRecord(value)) {
    errors.push(`operations[${index}].fields 必须是对象`)
    return {}
  }
  const unknownKeys = Object.keys(value).filter((key) => !(PLAN_FIELD_NAMES as readonly string[]).includes(key))
  if (unknownKeys.length > 0) {
    errors.push(`operations[${index}].fields 包含不支持的字段：${unknownKeys.join("、")}`)
  }
  const fields: OrganizePlanFields = {}
  if (typeof value.category === "string") fields.category = value.category.trim()
  if (typeof value.title === "string") fields.title = value.title.trim()
  if (typeof value.content === "string") fields.content = normalizeSettingText(value.content)
  for (const key of PLAN_FIELD_NAMES) {
    if (key in value && typeof value[key] !== "string") {
      errors.push(`operations[${index}].fields.${key} 必须是字符串`)
    }
  }
  return fields
}

export function parseOrganizePlan(raw: string): OrganizeParseResult {
  const errors: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { errors: [`plan_json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`] }
  }

  if (!isRecord(parsed)) return { errors: ["plan_json 必须是对象"] }
  if ("entity_type" in parsed && parsed.entity_type !== "world_entry") {
    errors.push(`当前版本仅支持 world_entry，收到：${String(parsed.entity_type)}`)
  }
  if (parsed.version !== 1) {
    errors.push(`plan_json.version 必须是 1，收到：${String(parsed.version)}`)
  }
  if (!Array.isArray(parsed.operations)) {
    errors.push("plan_json.operations 必须是数组")
    return { errors }
  }

  const operations: OrganizeOperation[] = []
  parsed.operations.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`operations[${index}] 必须是对象`)
      return
    }
    const reason = typeof item.reason === "string" ? item.reason.trim() : ""
    if (!reason) {
      errors.push(`operations[${index}].reason 不能为空`)
    }

    if (item.action === "update") {
      if (typeof item.id !== "string" || !item.id.trim()) {
        errors.push(`operations[${index}].id 必须是非空字符串`)
        return
      }
      const fields = parseFields(item.fields, index, errors)
      if (!Object.keys(fields).length) {
        errors.push(`operations[${index}].fields 至少包含 category / title / content 之一`)
      }
      operations.push({ action: "update", id: item.id, fields, reason })
      return
    }

    if (item.action === "merge") {
      if (typeof item.target_id !== "string" || !item.target_id.trim()) {
        errors.push(`operations[${index}].target_id 必须是非空字符串`)
        return
      }
      if (!Array.isArray(item.source_ids) || item.source_ids.length === 0) {
        errors.push(`operations[${index}].source_ids 必须是非空数组`)
        return
      }
      const sourceIds = item.source_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      if (sourceIds.length !== item.source_ids.length) {
        errors.push(`operations[${index}].source_ids 必须全部是非空字符串`)
      }
      const fields = parseFields(item.fields, index, errors)
      if (!fields.content) {
        errors.push(`operations[${index}].fields.content 必须提供合并后的分段纯文本`)
      }
      operations.push({ action: "merge", target_id: item.target_id, source_ids: sourceIds, fields, reason })
      return
    }

    if (item.action === "delete") {
      if (typeof item.id !== "string" || !item.id.trim()) {
        errors.push(`operations[${index}].id 必须是非空字符串`)
        return
      }
      if ("fields" in item) {
        errors.push(`operations[${index}] 的 delete 操作不支持 fields`)
      }
      operations.push({ action: "delete", id: item.id, reason })
      return
    }

    errors.push(`operations[${index}].action 不支持：${String(item.action)}`)
  })

  return { plan: { version: 1, operations }, errors }
}

export function validateOrganizePlan(input: {
  plan: OrganizePlan
  entries: WorldEntryRecord[]
  referencedIds: Set<string>
}): OrganizeValidationResult {
  const errors: string[] = []
  const entriesById = new Map(input.entries.map((entry) => [entry.id, entry]))
  const ownership = new Map<string, number[]>()

  const claim = (id: string, index: number, label: string) => {
    ownership.set(id, [...(ownership.get(id) ?? []), index])
    if (!entriesById.has(id)) {
      errors.push(`operations[${index}] ${label} 引用的条目不存在：${id}`)
    }
  }

  input.plan.operations.forEach((operation, index) => {
    if (operation.action === "update") {
      claim(operation.id, index, "update")
    } else if (operation.action === "delete") {
      claim(operation.id, index, "delete")
    } else {
      claim(operation.target_id, index, "merge target")
      const uniqueSources = new Set(operation.source_ids)
      if (uniqueSources.size !== operation.source_ids.length) {
        errors.push(`operations[${index}].source_ids 存在重复`)
      }
      if (uniqueSources.has(operation.target_id)) {
        errors.push(`operations[${index}] 的 merge target 不能同时作为 source`)
      }
      operation.source_ids.forEach((id) => claim(id, index, "merge source"))
      if (operation.fields.content !== undefined && !operation.fields.content.trim()) {
        errors.push(`operations[${index}] 合并后的 content 不能为空`)
      }
    }

    const fields = operation.action === "delete" ? {} : operation.fields
    const category = fields.category
    if (category !== undefined && validateWorldCategory(category)) {
      errors.push(`operations[${index}] category 非标准：${validateWorldCategory(category)}`)
    }
    const title = fields.title
    if (title !== undefined && !title) {
      errors.push(`operations[${index}] title 不能为空`)
    }
    if (title !== undefined && plainTextFormatError(title)) {
      errors.push(`operations[${index}] title ${plainTextFormatError(title)}`)
    }
    const content = fields.content
    if (content !== undefined) {
      if (!content) errors.push(`operations[${index}] content 不能为空`)
      const textError = settingTextFormatError(content, "world_entry", "content")
      if (textError) errors.push(`operations[${index}] ${textError}`)
    }
  })

  for (const [id, indexes] of ownership) {
    if (indexes.length > 1) {
      errors.push(`条目 ${id} 被多个操作使用：${indexes.join("、")}`)
    }
  }

  input.plan.operations.forEach((operation, index) => {
    const referencedSourceIds =
      operation.action === "delete"
        ? [operation.id]
        : operation.action === "merge"
          ? operation.source_ids
          : []
    for (const id of referencedSourceIds) {
      if (input.referencedIds.has(id)) {
        errors.push(`operations[${index}] 条目 ${id} 仍被活跃引用，不能删除`)
      }
    }
  })

  const previews = input.plan.operations.map((operation, index) => {
    if (operation.action === "update") {
      return {
        index,
        action: operation.action,
        entry_ids: [operation.id],
        fields: Object.keys(operation.fields),
        summary: `更新 ${operation.id}：${Object.keys(operation.fields).join("、")}`,
      }
    }
    if (operation.action === "merge") {
      return {
        index,
        action: operation.action,
        entry_ids: [operation.target_id, ...operation.source_ids],
        fields: Object.keys(operation.fields),
        summary: `合并 ${operation.source_ids.length} 条到 ${operation.target_id}`,
      }
    }
    return {
      index,
      action: operation.action,
      entry_ids: [operation.id],
      summary: `删除 ${operation.id}`,
    }
  })

  return { ok: errors.length === 0, errors, previews }
}

async function referencedEntryIds(directory: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const db = getDb(directory)
  const rows = await db
    .select({ target_id: EntityRefTable.target_id })
    .from(EntityRefTable)
    .where(eq(EntityRefTable.target_type, "world_entry"))
    .all()
  const idSet = new Set(ids)
  return new Set(rows.map((row) => row.target_id).filter((id) => idSet.has(id)))
}

export async function referencedWorldEntryIds(directory: string, ids: string[]): Promise<Set<string>> {
  return referencedEntryIds(directory, ids)
}

type OperationContext = {
  directory: string
  novelId: string
}

function operationEntryIds(operation: OrganizeOperation): string[] {
  if (operation.action === "update" || operation.action === "delete") return [operation.id]
  return [operation.target_id, ...operation.source_ids]
}

async function applyWorldEntryFields(
  operation: OrganizeUpdateOperation | OrganizeMergeOperation,
  entryId: string,
  context: OperationContext,
) {
  const db = getDb(context.directory)
  const oldRow = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, entryId)).get()
  if (!oldRow) throw new Error(`world_entry 不存在：${entryId}`)

  const fields: OrganizePlanFields = {}
  if (operation.fields.category !== undefined) fields.category = operation.fields.category
  if (operation.fields.title !== undefined) fields.title = operation.fields.title
  if (operation.fields.content !== undefined) fields.content = operation.fields.content
  await updateWorldEntry(entryId, fields, context.directory)

  let historyCount = 0
  const changedFields: string[] = []
  if (fields.category !== undefined && fields.category !== oldRow.category) {
    await archiveDescription(context.directory, oldRow.novel_id, "world_entry", entryId, oldRow.category, fields.category, "category")
    changedFields.push("category")
    historyCount += 1
  }
  if (fields.title !== undefined && fields.title !== oldRow.title) {
    await archiveDescription(context.directory, oldRow.novel_id, "world_entry", entryId, oldRow.title, fields.title, "title")
    changedFields.push("title")
    historyCount += 1
  }
  if (fields.content !== undefined && fields.content !== (oldRow.content ?? "")) {
    await archiveDescription(
      context.directory,
      oldRow.novel_id,
      "world_entry",
      entryId,
      oldRow.content ?? "",
      fields.content,
      "content",
    )
    changedFields.push("content")
    historyCount += 1
  }

  let cascadeTasks = 0
  const titleChanged = fields.title !== undefined && fields.title !== oldRow.title
  const contentChanged = fields.content !== undefined && fields.content !== (oldRow.content ?? "")
  if (titleChanged || contentChanged) {
    const newContent = fields.content ?? oldRow.content ?? ""
    await scanReferences(db, oldRow.novel_id, "world_entry", entryId, "content", newContent)
    const titleChangedFlag = titleChanged
    const oldVal = titleChangedFlag ? oldRow.title : (oldRow.content ?? "").slice(0, 80)
    const newVal = titleChangedFlag ? fields.title! : (fields.content ?? "").slice(0, 80)
    const reason = titleChangedFlag
      ? `world_entry 标题由「${oldRow.title}」改为「${fields.title}」`
      : `world_entry「${oldRow.title}」内容在设定整理中修改`
    cascadeTasks = await cascadeCreateTasks(
      db,
      oldRow.novel_id,
      "world_entry",
      entryId,
      titleChangedFlag ? "title" : "content",
      oldVal,
      newVal,
      reason,
    )
  }

  return { changed_fields: changedFields, history_count: historyCount, cascade_tasks: cascadeTasks }
}

async function hasActiveReference(directory: string, entryId: string): Promise<boolean> {
  const db = getDb(directory)
  const rows = await db
    .select({ id: EntityRefTable.id })
    .from(EntityRefTable)
    .where(eq(EntityRefTable.target_id, entryId))
    .limit(1)
    .all()
  return rows.length > 0
}

export async function executeOrganizePlan(
  plan: OrganizePlan,
  context: OperationContext,
): Promise<OrganizeExecutionResult> {
  const results: OrganizeExecutionResult["results"] = []
  const remaining: OrganizeExecutionResult["remaining"] = []

  for (const [index, operation] of plan.operations.entries()) {
    try {
      if (operation.action === "update") {
        const effect = await applyWorldEntryFields(operation, operation.id, context)
        results.push({ index, action: "update", status: "success", entry_id: operation.id, ...effect })
      } else if (operation.action === "merge") {
        const referencedSources: string[] = []
        for (const id of operation.source_ids) {
          if (await hasActiveReference(context.directory, id)) referencedSources.push(id)
        }
        if (referencedSources.length > 0) {
          throw new Error(`merge 源仍被活跃引用：${referencedSources.join("、")}`)
        }
        const effect = await applyWorldEntryFields(operation, operation.target_id, context)
        for (const id of operation.source_ids) {
          await deleteWorldEntry(id, context.directory)
        }
        results.push({
          index,
          action: "merge",
          status: "success",
          target_id: operation.target_id,
          source_ids: operation.source_ids,
          ...effect,
        })
      } else {
        if (await hasActiveReference(context.directory, operation.id)) {
          throw new Error(`delete 目标仍被活跃引用：${operation.id}`)
        }
        await deleteWorldEntry(operation.id, context.directory)
        results.push({ index, action: "delete", status: "success", entry_id: operation.id })
      }
    } catch (error) {
      results.push({
        index,
        action: operation.action,
        status: "failed",
        entry_ids: operationEntryIds(operation),
        error: error instanceof Error ? error.message : String(error),
      })
      for (const laterOperation of plan.operations.slice(index + 1)) {
        remaining.push({
          index: plan.operations.indexOf(laterOperation),
          action: laterOperation.action,
          entry_ids: operationEntryIds(laterOperation),
        })
      }
      break
    }
  }

  return { ok: results.every((result) => result.status === "success"), results, remaining }
}
