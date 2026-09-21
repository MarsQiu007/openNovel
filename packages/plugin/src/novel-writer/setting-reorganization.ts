import { and, eq, inArray, or } from "drizzle-orm"
import {
  CharacterStateTable,
  CharacterTable,
  deleteCharacter,
  deleteForeshadowing,
  deletePlotThread,
  deleteRelationship,
  deleteWorldEntry,
  EntityRefTable,
  ForeshadowingTable,
  getDb,
  PendingUpdateTable,
  PlotThreadTable,
  RelationshipTable,
  updateCharacter,
  updateForeshadowing,
  updatePlotThread,
  updateRelationship,
  updateWorldEntry,
  WorldEntryTable,
} from "./session-store.js"
import { archiveDescription, scanReferences } from "./state-commit.js"
import { applyImpact } from "./setting-impact.js"
import { normalizeSettingText, plainTextFormatError, settingTextFormatError } from "./setting-text.js"
import { validateWorldCategory } from "./world-category.js"

export type OrganizeEntityType = "world_entry" | "character" | "relationship" | "plot_thread" | "foreshadowing"
export type SettingIssueType =
  | "nonstandard_category"
  | "duplicate_title"
  | "similar_title"
  | "duplicate_identity"
  | "empty_field"
  | "long_single_paragraph"
  | "markdown_syntax"

export type SettingIssue = {
  issue_id: string
  type: SettingIssueType
  entity_type: OrganizeEntityType
  entry_ids: string[]
  evidence: string
  suggestion: string
}

export type WorldEntryRecord = typeof WorldEntryTable.$inferSelect
export type CharacterRecord = typeof CharacterTable.$inferSelect
export type RelationshipRecord = typeof RelationshipTable.$inferSelect
export type PlotThreadRecord = typeof PlotThreadTable.$inferSelect
export type ForeshadowingRecord = typeof ForeshadowingTable.$inferSelect

export type OrganizeEntity = {
  entity_type: OrganizeEntityType
  id: string
  category: string
  title: string
  content: string
  description: string
  name: string
  role: string
  status: string
  state: string
  char_a_id: string
  char_b_id: string
  relationship_type: string
}

export type OrganizePlanFields = {
  category?: string
  title?: string
  content?: string
  name?: string
  description?: string
}

export type OrganizeUpdateOperation = {
  action: "update"
  entity_type: OrganizeEntityType
  id: string
  fields: OrganizePlanFields
  reason: string
}

export type OrganizeMergeOperation = {
  action: "merge"
  entity_type: OrganizeEntityType
  target_id: string
  source_ids: string[]
  fields: OrganizePlanFields
  reason: string
}

export type OrganizeDeleteOperation = {
  action: "delete"
  entity_type: OrganizeEntityType
  id: string
  reason: string
}

export type OrganizeOperation = OrganizeUpdateOperation | OrganizeMergeOperation | OrganizeDeleteOperation
export type OrganizePlan = { version: 1 | 2; operations: OrganizeOperation[] }
export type OrganizeParseResult = { plan?: OrganizePlan; errors: string[] }
export type OrganizeOperationPreview = {
  index: number
  action: OrganizeOperation["action"]
  entity_type: OrganizeEntityType
  entry_ids: string[]
  summary: string
  fields?: string[]
}
export type OrganizeValidationResult = { ok: boolean; errors: string[]; previews: OrganizeOperationPreview[] }
export type OrganizeOperationResult = {
  index: number
  action: OrganizeOperation["action"]
  entity_type: OrganizeEntityType
  status: "success" | "failed"
  entry_ids: string[]
  changed_fields?: string[]
  history_count?: number
  cascade_tasks?: number
  error?: string
}
export type OrganizeExecutionResult = {
  ok: boolean
  results: OrganizeOperationResult[]
  remaining: Array<{
    index: number
    action: OrganizeOperation["action"]
    entity_type: OrganizeEntityType
    entry_ids: string[]
  }>
}
export type OrganizeContext = {
  entities: OrganizeEntity[]
  referencedKeys: Set<string>
  relatedCharacterIds: Set<string>
}

const ENTITY_TYPES: readonly OrganizeEntityType[] = [
  "world_entry",
  "character",
  "relationship",
  "plot_thread",
  "foreshadowing",
]
const PLAN_FIELD_NAMES = ["category", "title", "content", "name", "description"] as const
const UPDATE_FIELDS: Record<OrganizeEntityType, readonly string[]> = {
  world_entry: ["category", "title", "content"],
  character: ["name", "description"],
  relationship: ["description"],
  plot_thread: ["title", "description"],
  foreshadowing: ["content"],
}
const MERGE_REQUIRED_FIELD: Partial<Record<OrganizeEntityType, string>> = { world_entry: "content" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function issueId(entityType: string, type: SettingIssueType, entryIds: string[]): string {
  return `${entityType}:${type}:${entryIds.join(",")}`
}
function head(value: string, length = 80): string {
  const text = value.trim()
  return text.length > length ? `${text.slice(0, length)}...` : text
}
function paragraphs(value: string): string[] {
  return normalizeSettingText(value).split("\n\n").filter(Boolean)
}

export function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
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

export function toOrganizeEntity(entityType: OrganizeEntityType, record: Record<string, unknown>): OrganizeEntity {
  const value = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "")
  return {
    entity_type: entityType,
    id: String(record.id ?? ""),
    category: value("category"),
    title: entityType === "character" ? value("name") : value("title"),
    content: value("content"),
    description: value("description"),
    name: value("name"),
    role: value("role"),
    status: value("status"),
    state: value("state"),
    char_a_id: value("char_a_id"),
    char_b_id: value("char_b_id"),
    relationship_type: value("type"),
  }
}

export async function loadOrganizeEntities(
  directory: string,
  novelId: string,
  scope: OrganizeEntityType | "all" = "all",
): Promise<OrganizeEntity[]> {
  const db = getDb(directory)
  const entities: OrganizeEntity[] = []
  const include = (entityType: OrganizeEntityType) => scope === "all" || scope === entityType

  if (include("world_entry")) {
    const rows = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.novel_id, novelId)).all()
    entities.push(...rows.map((row) => toOrganizeEntity("world_entry", row)))
  }
  if (include("character")) {
    const rows = await db.select().from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
    entities.push(...rows.map((row) => toOrganizeEntity("character", row)))
  }
  if (include("relationship")) {
    const rows = await db.select().from(RelationshipTable).where(eq(RelationshipTable.novel_id, novelId)).all()
    entities.push(...rows.map((row) => toOrganizeEntity("relationship", row)))
  }
  if (include("plot_thread")) {
    const rows = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.novel_id, novelId)).all()
    entities.push(...rows.map((row) => toOrganizeEntity("plot_thread", row)))
  }
  if (include("foreshadowing")) {
    const rows = await db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.novel_id, novelId)).all()
    entities.push(...rows.map((row) => toOrganizeEntity("foreshadowing", row)))
  }
  return entities
}

function textIssue(entity: OrganizeEntity, field: string, value: string): SettingIssue[] {
  const issues: SettingIssue[] = []
  const markdownError = plainTextFormatError(value)
  if (markdownError) {
    issues.push({
      issue_id: issueId(entity.entity_type, "markdown_syntax", [entity.id]),
      type: "markdown_syntax",
      entity_type: entity.entity_type,
      entry_ids: [entity.id],
      evidence: `${field}：${head(markdownError, 120)}`,
      suggestion: "改写为自然句段落，去除 Markdown 语法",
    })
  }
  const longParagraph = paragraphs(value)
    .map((paragraph, index) => ({ index, length: paragraph.length }))
    .find((paragraph) => paragraph.length > 600)
  if (longParagraph) {
    issues.push({
      issue_id: issueId(entity.entity_type, "long_single_paragraph", [entity.id]),
      type: "long_single_paragraph",
      entity_type: entity.entity_type,
      entry_ids: [entity.id],
      evidence: `${field}：第 ${longParagraph.index + 1} 段（${longParagraph.length} 字）`,
      suggestion: "按主题拆分为 \\n\\n 分段的纯文本段落，单个段落约 80–220 字",
    })
  }
  return issues
}

function duplicateGroups(
  entityType: OrganizeEntityType,
  rows: OrganizeEntity[],
  keyOf: (row: OrganizeEntity) => string,
): SettingIssue[] {
  const groups = new Map<string, OrganizeEntity[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const issues: SettingIssue[] = []
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    issues.push({
      issue_id: issueId(entityType, "duplicate_identity", group.map((row) => row.id)),
      type: "duplicate_identity",
      entity_type: entityType,
      entry_ids: group.map((row) => row.id),
      evidence: `${group.length} 条条目使用身份「${key}」`,
      suggestion: "人工确认后显式指定保留条目；不要自动删除候选",
    })
  }
  return issues
}

export function analyzeWorldEntries(rows: WorldEntryRecord[]): SettingIssue[] {
  const entities = rows.map((row) => toOrganizeEntity("world_entry", row))
  return analyzeEntities(entities).filter((issue) => issue.entity_type === "world_entry")
}
export function analyzeEntities(entities: OrganizeEntity[]): SettingIssue[] {
  const issues: SettingIssue[] = []
  const worldRows = entities.filter((entity) => entity.entity_type === "world_entry")

  for (const entity of worldRows) {
    const categoryError = validateWorldCategory(entity.category)
    if (categoryError) {
      issues.push({
        issue_id: issueId("world_entry", "nonstandard_category", [entity.id]),
        type: "nonstandard_category",
        entity_type: "world_entry",
        entry_ids: [entity.id],
        evidence: `${entity.title}：${head(categoryError, 120)}`,
        suggestion: "改为标准主分类，必要时保留主分类/子分类形式",
      })
    }
    if (!entity.title.trim() || !entity.content.trim()) {
      const emptyFields = [!entity.title.trim() ? "title" : "", !entity.content.trim() ? "content" : ""].filter(Boolean)
      issues.push({
        issue_id: issueId("world_entry", "empty_field", [entity.id]),
        type: "empty_field",
        entity_type: "world_entry",
        entry_ids: [entity.id],
        evidence: `${entity.title || "(无标题)"}：${emptyFields.join("、")}为空`,
        suggestion: "补齐字段，或把该条目合并到已有条目",
      })
    }
    issues.push(...textIssue(entity, "content", entity.content))
  }

  const titleGroups = new Map<string, OrganizeEntity[]>()
  for (const entity of worldRows) {
    const key = entity.title.trim()
    if (!key) continue
    titleGroups.set(key, [...(titleGroups.get(key) ?? []), entity])
  }
  for (const [title, group] of titleGroups) {
    if (group.length < 2) continue
    issues.push({
      issue_id: issueId("world_entry", "duplicate_title", group.map((row) => row.id)),
      type: "duplicate_title",
      entity_type: "world_entry",
      entry_ids: group.map((row) => row.id),
      evidence: `${group.length} 条条目使用标题「${title}」`,
      suggestion: "保留一条，改写或合并其余条目内容",
    })
  }

  const uniqueWorld = worldRows.filter((row) => row.title.trim() && normalizeTitle(row.title).length >= 2)
  const similarPairs = new Set<string>()
  for (let left = 0; left < uniqueWorld.length; left += 1) {
    for (let right = left + 1; right < uniqueWorld.length; right += 1) {
      const first = uniqueWorld[left]!
      const second = uniqueWorld[right]!
      if (first.title.trim() === second.title.trim()) continue
      if (titleSimilarity(first.title, second.title) < 0.85) continue
      const ids = [first.id, second.id].sort()
      if (similarPairs.has(ids.join(","))) continue
      similarPairs.add(ids.join(","))
      issues.push({
        issue_id: issueId("world_entry", "similar_title", ids),
        type: "similar_title",
        entity_type: "world_entry",
        entry_ids: ids,
        evidence: `「${first.title}」与「${second.title}」标题相似`,
        suggestion: "人工确认是否为同一设定；不要自动删除",
      })
    }
  }

  for (const entity of entities.filter((row) => row.entity_type === "character")) {
    if (!entity.name.trim() || !entity.description.trim()) {
      const emptyFields = [!entity.name.trim() ? "name" : "", !entity.description.trim() ? "description" : ""].filter(Boolean)
      issues.push({
        issue_id: issueId("character", "empty_field", [entity.id]),
        type: "empty_field",
        entity_type: "character",
        entry_ids: [entity.id],
        evidence: `${entity.name || "(无名)"}：${emptyFields.join("、")}为空`,
        suggestion: "补齐字段，或合并到同名已有角色",
      })
    }
    issues.push(...textIssue(entity, "description", entity.description))
  }
  issues.push(...duplicateGroups("character", entities.filter((row) => row.entity_type === "character"), (row) => row.name.trim()))

  for (const entity of entities.filter((row) => row.entity_type === "relationship")) {
    if (!entity.description.trim()) {
      issues.push({
        issue_id: issueId("relationship", "empty_field", [entity.id]),
        type: "empty_field",
        entity_type: "relationship",
        entry_ids: [entity.id],
        evidence: "relationship.description 为空",
        suggestion: "补齐关系描述，或删除无引用重复项",
      })
    }
    issues.push(...textIssue(entity, "description", entity.description))
  }
  issues.push(
    ...duplicateGroups(
      "relationship",
      entities.filter((row) => row.entity_type === "relationship"),
      (row) => `${row.char_a_id}|${row.char_b_id}|${row.relationship_type}`,
    ),
  )

  for (const entity of entities.filter((row) => row.entity_type === "plot_thread")) {
    if (!entity.title.trim() || !entity.description.trim()) {
      const emptyFields = [!entity.title.trim() ? "title" : "", !entity.description.trim() ? "description" : ""].filter(Boolean)
      issues.push({
        issue_id: issueId("plot_thread", "empty_field", [entity.id]),
        type: "empty_field",
        entity_type: "plot_thread",
        entry_ids: [entity.id],
        evidence: `${entity.title || "(无标题)"}：${emptyFields.join("、")}为空`,
        suggestion: "补齐字段，或删除无引用空剧情线",
      })
    }
    issues.push(...textIssue(entity, "description", entity.description))
  }
  issues.push(...duplicateGroups("plot_thread", entities.filter((row) => row.entity_type === "plot_thread"), (row) => row.title.trim()))

  for (const entity of entities.filter((row) => row.entity_type === "foreshadowing")) {
    if (!entity.content.trim()) {
      issues.push({
        issue_id: issueId("foreshadowing", "empty_field", [entity.id]),
        type: "empty_field",
        entity_type: "foreshadowing",
        entry_ids: [entity.id],
        evidence: "foreshadowing.content 为空",
        suggestion: "补齐伏笔内容，或删除无引用空项",
      })
    }
    issues.push(...textIssue(entity, "content", entity.content))
  }
  issues.push(
    ...duplicateGroups("foreshadowing", entities.filter((row) => row.entity_type === "foreshadowing"), (row) => row.content.trim()),
  )
  return issues
}
function normalizeFields(value: unknown, index: number, errors: string[], allowedFields: readonly string[]): OrganizePlanFields {
  if (!isRecord(value)) {
    errors.push(`operations[${index}].fields 必须是对象`)
    return {}
  }
  const unknownKeys = Object.keys(value).filter((key) => !allowedFields.includes(key))
  if (unknownKeys.length > 0) errors.push(`operations[${index}].fields 包含不支持的字段：${unknownKeys.join("、")}`)
  const fields: OrganizePlanFields = {}
  if (typeof value.category === "string") fields.category = value.category.trim()
  if (typeof value.title === "string") fields.title = value.title.trim()
  if (typeof value.name === "string") fields.name = value.name.trim()
  if (typeof value.content === "string") fields.content = normalizeSettingText(value.content)
  if (typeof value.description === "string") fields.description = normalizeSettingText(value.description)
  for (const key of PLAN_FIELD_NAMES) {
    if (key in value && typeof value[key] !== "string") errors.push(`operations[${index}].fields.${key} 必须是字符串`)
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
  if (parsed.version !== 1 && parsed.version !== 2) errors.push(`plan_json.version 必须是 1 或 2，收到：${String(parsed.version)}`)
  const version = parsed.version === 2 ? 2 : 1
  if (version === 1 && "entity_type" in parsed && parsed.entity_type !== "world_entry") {
    errors.push(`版本 1 仅支持 world_entry，收到：${String(parsed.entity_type)}`)
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
    if (!reason) errors.push(`operations[${index}].reason 不能为空`)

    let entityType: OrganizeEntityType | undefined
    if (version === 2) {
      const rawType = item.entity_type
      if (typeof rawType === "string" && (ENTITY_TYPES as readonly string[]).includes(rawType)) entityType = rawType as OrganizeEntityType
      else {
        errors.push(`operations[${index}].entity_type 不支持：${String(rawType)}`)
        return
      }
    } else if ("entity_type" in item) {
      if (item.entity_type === "world_entry") entityType = "world_entry"
      else {
        errors.push(`operations[${index}].entity_type 在版本 1 中仅支持 world_entry：${String(item.entity_type)}`)
        return
      }
    } else {
      entityType = "world_entry"
    }

    const allowedFields = UPDATE_FIELDS[entityType]
    if (item.action === "update") {
      if (typeof item.id !== "string" || !item.id.trim()) {
        errors.push(`operations[${index}].id 必须是非空字符串`)
        return
      }
      const fields = normalizeFields(item.fields, index, errors, allowedFields)
      if (!Object.keys(fields).length) errors.push(`operations[${index}].fields 至少包含一个白名单字段`)
      operations.push({ action: "update", entity_type: entityType, id: item.id, fields, reason })
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
      if (sourceIds.length !== item.source_ids.length) errors.push(`operations[${index}].source_ids 必须全部是非空字符串`)
      const fields = normalizeFields(item.fields, index, errors, allowedFields)
      const requiredField = MERGE_REQUIRED_FIELD[entityType]
      if (requiredField && !fields[requiredField as keyof OrganizePlanFields]) errors.push(`operations[${index}].fields.${requiredField} 必须提供合并后的分段纯文本`)
      operations.push({ action: "merge", entity_type: entityType, target_id: item.target_id, source_ids: sourceIds, fields, reason })
      return
    }
    if (item.action === "delete") {
      if (typeof item.id !== "string" || !item.id.trim()) {
        errors.push(`operations[${index}].id 必须是非空字符串`)
        return
      }
      if ("fields" in item) errors.push(`operations[${index}] 的 delete 操作不支持 fields`)
      operations.push({ action: "delete", entity_type: entityType, id: item.id, reason })
      return
    }
    errors.push(`operations[${index}].action 不支持：${String(item.action)}`)
  })

  return { plan: { version, operations }, errors }
}

export async function loadOrganizeContext(
  directory: string,
  novelId: string,
  scope: OrganizeEntityType | "all" = "all",
): Promise<OrganizeContext> {
  const entities = await loadOrganizeEntities(directory, novelId, scope)
  const entityIds = entities.map((entity) => entity.id)
  const referencedKeys = new Set<string>()
  const relatedCharacterIds = new Set<string>()
  if (entityIds.length === 0) return { entities, referencedKeys, relatedCharacterIds }

  const db = getDb(directory)
  const refs = await db
    .select({ target_type: EntityRefTable.target_type, target_id: EntityRefTable.target_id })
    .from(EntityRefTable)
    .all()
  const entityIdSet = new Set(entityIds)
  for (const ref of refs) {
    if (entityIdSet.has(ref.target_id)) referencedKeys.add(`${ref.target_type}:${ref.target_id}`)
  }

  const characterIds = entities.filter((entity) => entity.entity_type === "character").map((entity) => entity.id)
  if (characterIds.length === 0) return { entities, referencedKeys, relatedCharacterIds }
  const states = await db
    .select({ character_id: CharacterStateTable.character_id })
    .from(CharacterStateTable)
    .where(inArray(CharacterStateTable.character_id, characterIds))
    .all()
  for (const state of states) referencedKeys.add(`character:${state.character_id}`)
  const related = await db
    .select({ char_a_id: RelationshipTable.char_a_id, char_b_id: RelationshipTable.char_b_id })
    .from(RelationshipTable)
    .where(or(inArray(RelationshipTable.char_a_id, characterIds), inArray(RelationshipTable.char_b_id, characterIds)))
    .all()
  for (const row of related) {
    relatedCharacterIds.add(row.char_a_id)
    relatedCharacterIds.add(row.char_b_id)
  }
  return { entities, referencedKeys, relatedCharacterIds }
}

export function validateOrganizePlan(input: {
  plan: OrganizePlan
  entries: OrganizeEntity[]
  referencedKeys: Set<string>
  relatedCharacterIds?: Set<string>
}): OrganizeValidationResult {
  const errors: string[] = []
  const entriesById = new Map(input.entries.map((entry) => [`${entry.entity_type}:${entry.id}`, entry]))
  const ownership = new Map<string, number[]>()

  const claim = (entityType: OrganizeEntityType, id: string, index: number, label: string) => {
    const key = `${entityType}:${id}`
    ownership.set(key, [...(ownership.get(key) ?? []), index])
    if (!entriesById.has(key)) errors.push(`operations[${index}] ${label} 引用的 ${entityType} 不存在：${id}`)
  }

  input.plan.operations.forEach((operation, index) => {
    if (operation.action === "update") claim(operation.entity_type, operation.id, index, "update")
    else if (operation.action === "delete") claim(operation.entity_type, operation.id, index, "delete")
    else {
      claim(operation.entity_type, operation.target_id, index, "merge target")
      const uniqueSources = new Set(operation.source_ids)
      if (uniqueSources.size !== operation.source_ids.length) errors.push(`operations[${index}].source_ids 存在重复`)
      if (uniqueSources.has(operation.target_id)) errors.push(`operations[${index}] 的 merge target 不能同时作为 source`)
      operation.source_ids.forEach((id) => claim(operation.entity_type, id, index, "merge source"))
    }

    const fields = operation.action === "delete" ? {} : operation.fields
    if (operation.entity_type === "world_entry" && fields.category !== undefined && validateWorldCategory(fields.category)) {
      errors.push(`operations[${index}] category 非标准：${validateWorldCategory(fields.category)}`)
    }
    for (const field of ["title", "name"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      if (!value) errors.push(`operations[${index}] ${field} 不能为空`)
      const textError = plainTextFormatError(value)
      if (textError) errors.push(`operations[${index}] ${field} ${textError}`)
    }
    for (const field of ["content", "description"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      if (!value) errors.push(`operations[${index}] ${field} 不能为空`)
      const textError = settingTextFormatError(value, operation.entity_type, field)
      if (textError) errors.push(`operations[${index}] ${textError}`)
    }
  })

  for (const [key, indexes] of ownership) {
    if (indexes.length > 1) errors.push(`条目 ${key} 被多个操作使用：${indexes.join("、")}`)
  }

  const relatedCharacterIds = input.relatedCharacterIds ?? new Set<string>()
  input.plan.operations.forEach((operation, index) => {
    const sourceIds = operation.action === "delete" ? [operation.id] : operation.action === "merge" ? operation.source_ids : []
    for (const id of sourceIds) {
      const key = `${operation.entity_type}:${id}`
      if (input.referencedKeys.has(key)) errors.push(`operations[${index}] ${operation.entity_type} ${id} 仍被活跃引用，不能删除`)
      if (operation.entity_type === "character" && operation.action === "delete" && relatedCharacterIds.has(id)) {
        errors.push(`operations[${index}] character ${id} 仍参与关系，不能直接删除`)
      }
    }
    if (operation.action === "merge") {
      const target = entriesById.get(`${operation.entity_type}:${operation.target_id}`)
      for (const sourceId of operation.source_ids) {
        const source = entriesById.get(`${operation.entity_type}:${sourceId}`)
        if (!target || !source) continue
        if (operation.entity_type === "character") {
          if (target.name.trim() !== source.name.trim()) errors.push(`operations[${index}] character 合并身份不一致：${target.name} != ${source.name}`)
          if (source.role === "protagonist" || input.referencedKeys.has(`character:${source.id}`)) {
            errors.push(`operations[${index}] character 源 ${source.id} 受主角或活跃引用保护`)
          }
        }
        if (operation.entity_type === "relationship") {
          const sameIdentity =
            target.char_a_id === source.char_a_id &&
            target.char_b_id === source.char_b_id &&
            target.relationship_type === source.relationship_type
          if (!sameIdentity) errors.push(`operations[${index}] relationship 合并身份不一致`)
        }
        if (input.referencedKeys.has(`${operation.entity_type}:${sourceId}`)) {
          errors.push(`operations[${index}] ${operation.entity_type} 源 ${sourceId} 仍被活跃引用`)
        }
      }
      const sourceIds = operation.source_ids
      const sourceEntries = sourceIds.map((id) => entriesById.get(`${operation.entity_type}:${id}`)).filter(Boolean)
      if ((operation.entity_type === "character" || operation.entity_type === "relationship") && operation.fields.description !== undefined) {
        const originalLengths = [target!.description.length, ...sourceEntries.map((source) => source!.description.length)]
        if (operation.fields.description.length < Math.max(...originalLengths)) {
          errors.push(`operations[${index}] 合并后的 description 比原始最长描述短，可能丢失信息`)
        }
      }
    }
    if (operation.action === "delete" && operation.entity_type === "character") {
      const target = entriesById.get(`character:${operation.id}`)
      if (target?.role === "protagonist") errors.push(`operations[${index}] 主角不能删除`)
    }
  })

  const previews = input.plan.operations.map((operation, index) => {
    const ids =
      operation.action === "update" || operation.action === "delete"
        ? [operation.id]
        : [operation.target_id, ...operation.source_ids]
    if (operation.action === "update") {
      return {
        index,
        action: operation.action,
        entity_type: operation.entity_type,
        entry_ids: [operation.id],
        fields: Object.keys(operation.fields),
        summary: `更新 ${operation.entity_type} ${operation.id}：${Object.keys(operation.fields).join("、")}`,
      }
    }
    if (operation.action === "merge") {
      return {
        index,
        action: operation.action,
        entity_type: operation.entity_type,
        entry_ids: ids,
        fields: Object.keys(operation.fields),
        summary: `合并 ${operation.source_ids.length} 条 ${operation.entity_type} 到 ${operation.target_id}`,
      }
    }
    return {
      index,
      action: operation.action,
      entity_type: operation.entity_type,
      entry_ids: ids,
      summary: `删除 ${operation.entity_type} ${operation.id}`,
    }
  })
  return { ok: errors.length === 0, errors, previews }
}
function operationEntryIds(operation: OrganizeOperation): string[] {
  if (operation.action === "update" || operation.action === "delete") return [operation.id]
  return [operation.target_id, ...operation.source_ids]
}

async function hasEntityReference(directory: string, entityType: OrganizeEntityType, id: string): Promise<boolean> {
  const db = getDb(directory)
  const rows = await db
    .select({ id: EntityRefTable.id })
    .from(EntityRefTable)
    .where(and(eq(EntityRefTable.target_type, entityType), eq(EntityRefTable.target_id, id)))
    .limit(1)
    .all()
  return rows.length > 0
}

async function hasCharacterState(directory: string, id: string): Promise<boolean> {
  const db = getDb(directory)
  const rows = await db
    .select({ id: CharacterStateTable.id })
    .from(CharacterStateTable)
    .where(eq(CharacterStateTable.character_id, id))
    .limit(1)
    .all()
  return rows.length > 0
}

async function hasCharacterRelationship(directory: string, id: string): Promise<boolean> {
  const db = getDb(directory)
  const rows = await db
    .select({ id: RelationshipTable.id })
    .from(RelationshipTable)
    .where(or(eq(RelationshipTable.char_a_id, id), eq(RelationshipTable.char_b_id, id)))
    .limit(1)
    .all()
  return rows.length > 0
}

type OperationContext = { directory: string; novelId: string }

async function updateWorld(operation: OrganizeUpdateOperation | OrganizeMergeOperation, id: string, context: OperationContext) {
  const db = getDb(context.directory)
  const oldRow = await db.select().from(WorldEntryTable).where(eq(WorldEntryTable.id, id)).get()
  if (!oldRow) throw new Error(`world_entry 不存在：${id}`)
  const fields = operation.fields
  await updateWorldEntry(id, fields, context.directory)

  let historyCount = 0
  const changedFields: string[] = []
  if (fields.category !== undefined && fields.category !== oldRow.category) {
    await archiveDescription(context.directory, oldRow.novel_id, "world_entry", id, oldRow.category, fields.category, "category")
    changedFields.push("category")
    historyCount += 1
  }
  if (fields.title !== undefined && fields.title !== oldRow.title) {
    await archiveDescription(context.directory, oldRow.novel_id, "world_entry", id, oldRow.title, fields.title, "title")
    changedFields.push("title")
    historyCount += 1
  }
  if (fields.content !== undefined && fields.content !== (oldRow.content ?? "")) {
    await archiveDescription(context.directory, oldRow.novel_id, "world_entry", id, oldRow.content ?? "", fields.content, "content")
    changedFields.push("content")
    historyCount += 1
  }

  let cascadeTasks = 0
  const titleChanged = fields.title !== undefined && fields.title !== oldRow.title
  const contentChanged = fields.content !== undefined && fields.content !== (oldRow.content ?? "")
  if (titleChanged || contentChanged) {
    const newContent = fields.content ?? oldRow.content ?? ""
    await scanReferences(db, oldRow.novel_id, "world_entry", id, "content", newContent)
    const oldVal = titleChanged ? oldRow.title : (oldRow.content ?? "").slice(0, 80)
    const newVal = titleChanged ? fields.title! : (fields.content ?? "").slice(0, 80)
    cascadeTasks = await applyImpact(db, {
      novelId: oldRow.novel_id,
      entityType: "world_entry",
      entityId: id,
      field: titleChanged ? "title" : "content",
      oldValue: oldVal,
      newValue: newVal,
      reason: titleChanged ? `world_entry 标题由「${oldRow.title}」改为「${fields.title}」` : `world_entry「${oldRow.title}」内容在设定整理中修改`,
    })
  }
  return { changed_fields: changedFields, history_count: historyCount, cascade_tasks: cascadeTasks }
}

async function updateCharacterFields(
  operation: OrganizeUpdateOperation | OrganizeMergeOperation,
  id: string,
  context: OperationContext,
  mergedDescription?: string,
) {
  const db = getDb(context.directory)
  const oldRow = await db.select().from(CharacterTable).where(eq(CharacterTable.id, id)).get()
  if (!oldRow) throw new Error(`character 不存在：${id}`)
  const description = mergedDescription ?? operation.fields.description
  const fields = { name: operation.fields.name, description }
  await updateCharacter(id, fields, context.directory)

  let historyCount = 0
  const changedFields: string[] = []
  if (fields.name !== undefined && fields.name !== oldRow.name) {
    await archiveDescription(context.directory, oldRow.novel_id, "character", id, oldRow.name, fields.name, "name")
    changedFields.push("name")
    historyCount += 1
  }
  if (description !== undefined && description !== (oldRow.description ?? "")) {
    await archiveDescription(context.directory, oldRow.novel_id, "character", id, oldRow.description ?? "", description, "description")
    changedFields.push("description")
    historyCount += 1
  }

  let cascadeTasks = 0
  if (changedFields.length > 0) {
    const newDescription = description ?? oldRow.description ?? ""
    await scanReferences(db, oldRow.novel_id, "character", id, "description", newDescription)
    cascadeTasks = await applyImpact(db, {
      novelId: oldRow.novel_id,
      entityType: "character",
      entityId: id,
      field: changedFields.join(", "),
      oldValue: JSON.stringify({ name: oldRow.name, description: oldRow.description }),
      newValue: JSON.stringify({ name: fields.name ?? oldRow.name, description: newDescription }),
      reason: `角色「${oldRow.name}」在设定整理中更新（${changedFields.join(", ")}）`,
    })
  }
  return { changed_fields: changedFields, history_count: historyCount, cascade_tasks: cascadeTasks }
}

async function updateSimpleFields(
  operation: OrganizeUpdateOperation | OrganizeMergeOperation,
  id: string,
  context: OperationContext,
  mergedDescription?: string,
) {
  const db = getDb(context.directory)
  if (operation.entity_type === "plot_thread") {
    const oldRow = await db.select().from(PlotThreadTable).where(eq(PlotThreadTable.id, id)).get()
    if (!oldRow) throw new Error(`plot_thread 不存在：${id}`)
    const description = mergedDescription ?? operation.fields.description
    const fields = { title: operation.fields.title, description }
    await updatePlotThread(id, fields, context.directory)
    let historyCount = 0
    const changedFields: string[] = []
    if (fields.title !== undefined && fields.title !== oldRow.title) {
      await archiveDescription(context.directory, oldRow.novel_id, "plot_thread", id, oldRow.title, fields.title, "title")
      changedFields.push("title")
      historyCount += 1
    }
    if (description !== undefined && description !== (oldRow.description ?? "")) {
      await archiveDescription(context.directory, oldRow.novel_id, "plot_thread", id, oldRow.description ?? "", description, "description")
      changedFields.push("description")
      historyCount += 1
    }
    return { changed_fields: changedFields, history_count: historyCount, cascade_tasks: 0 }
  }
  if (operation.entity_type === "foreshadowing") {
    const oldRow = await db.select().from(ForeshadowingTable).where(eq(ForeshadowingTable.id, id)).get()
    if (!oldRow) throw new Error(`foreshadowing 不存在：${id}`)
    const content = mergedDescription ?? operation.fields.content
    await updateForeshadowing(id, { content: content ?? oldRow.content }, context.directory)
    const changed = content !== undefined && content !== (oldRow.content ?? "")
    if (changed && content !== undefined) {
      await archiveDescription(context.directory, oldRow.novel_id, "foreshadowing", id, oldRow.content, content, "content")
    }
    return { changed_fields: changed ? ["content"] : [], history_count: changed ? 1 : 0, cascade_tasks: 0 }
  }
  if (operation.entity_type === "relationship") {
    const oldRow = await db.select().from(RelationshipTable).where(eq(RelationshipTable.id, id)).get()
    if (!oldRow) throw new Error(`relationship 不存在：${id}`)
    const description = mergedDescription ?? operation.fields.description
    await updateRelationship(id, { description }, context.directory)
    const changed = description !== undefined && description !== (oldRow.description ?? "")
    if (changed && description !== undefined) {
      await archiveDescription(context.directory, oldRow.novel_id, "relationship", id, oldRow.description, description, "description")
    }
    return { changed_fields: changed ? ["description"] : [], history_count: changed ? 1 : 0, cascade_tasks: 0 }
  }
  throw new Error(`不支持的更新实体类型：${operation.entity_type}`)
}

function mergedDescription(target: string, sources: string[], explicit?: string): string {
  if (explicit !== undefined) return explicit
  const unique = [target, ...sources]
    .flatMap((value) => paragraphs(value))
    .filter((value, index, array) => array.indexOf(value) === index)
  return unique.join("\n\n")
}

async function redirectCharacterReferences(directory: string, sourceIds: string[], targetId: string): Promise<void> {
  const db = getDb(directory)
  await db.update(RelationshipTable).set({ char_a_id: targetId }).where(inArray(RelationshipTable.char_a_id, sourceIds)).run()
  await db.update(RelationshipTable).set({ char_b_id: targetId }).where(inArray(RelationshipTable.char_b_id, sourceIds)).run()
  await db
    .update(EntityRefTable)
    .set({ source_id: targetId })
    .where(and(eq(EntityRefTable.source_type, "character"), inArray(EntityRefTable.source_id, sourceIds)))
    .run()
  await db
    .update(EntityRefTable)
    .set({ target_id: targetId })
    .where(and(eq(EntityRefTable.target_type, "character"), inArray(EntityRefTable.target_id, sourceIds)))
    .run()
  await db
    .update(PendingUpdateTable)
    .set({ source_id: targetId })
    .where(and(eq(PendingUpdateTable.source_type, "character"), inArray(PendingUpdateTable.source_id, sourceIds)))
    .run()
  await db
    .update(PendingUpdateTable)
    .set({ trigger_id: targetId })
    .where(and(eq(PendingUpdateTable.trigger_type, "character"), inArray(PendingUpdateTable.trigger_id, sourceIds)))
    .run()
}

async function ensureMergeSourceSafe(operation: OrganizeMergeOperation, id: string, context: OperationContext): Promise<void> {
  if (await hasEntityReference(context.directory, operation.entity_type, id)) {
    throw new Error(`${operation.entity_type} 源仍被活跃引用：${id}`)
  }
  if (operation.entity_type === "character") {
    const row = await getDb(context.directory).select().from(CharacterTable).where(eq(CharacterTable.id, id)).get()
    if (!row) throw new Error(`character 不存在：${id}`)
    if (row.role === "protagonist") throw new Error(`主角不能作为合并源：${id}`)
    if (await hasCharacterState(context.directory, id)) throw new Error(`已出场角色不能作为合并源：${id}`)
  }
}

async function deleteEntity(operation: OrganizeDeleteOperation, context: OperationContext): Promise<void> {
  if (await hasEntityReference(context.directory, operation.entity_type, operation.id)) {
    throw new Error(`${operation.entity_type} 仍被活跃引用：${operation.id}`)
  }
  if (operation.entity_type === "character") {
    const db = getDb(context.directory)
    const row = await db.select().from(CharacterTable).where(eq(CharacterTable.id, operation.id)).get()
    if (!row) throw new Error(`character 不存在：${operation.id}`)
    if (row.role === "protagonist") throw new Error("主角不能删除")
    if (await hasCharacterState(context.directory, operation.id)) throw new Error("已出场角色不能硬删除")
    if (await hasCharacterRelationship(context.directory, operation.id)) throw new Error("角色仍参与关系，不能直接删除")
    await deleteCharacter(operation.id, context.directory)
    return
  }
  if (operation.entity_type === "world_entry") await deleteWorldEntry(operation.id, context.directory)
  else if (operation.entity_type === "relationship") await deleteRelationship(operation.id, context.directory)
  else if (operation.entity_type === "plot_thread") await deletePlotThread(operation.id, context.directory)
  else if (operation.entity_type === "foreshadowing") await deleteForeshadowing(operation.id, context.directory)
  else throw new Error(`不支持的删除实体类型：${operation.entity_type}`)
}
export async function executeOrganizePlan(
  plan: OrganizePlan,
  context: OperationContext,
): Promise<OrganizeExecutionResult> {
  const results: OrganizeOperationResult[] = []
  const remaining: OrganizeExecutionResult["remaining"] = []

  for (const [index, operation] of plan.operations.entries()) {
    try {
      if (operation.action === "update") {
        const effect =
          operation.entity_type === "world_entry"
            ? await updateWorld(operation, operation.id, context)
            : operation.entity_type === "character"
              ? await updateCharacterFields(operation, operation.id, context)
              : await updateSimpleFields(operation, operation.id, context)
        results.push({
          index,
          action: "update",
          entity_type: operation.entity_type,
          status: "success",
          entry_ids: [operation.id],
          ...effect,
        })
      } else if (operation.action === "merge") {
        for (const id of operation.source_ids) await ensureMergeSourceSafe(operation, id, context)
        if (operation.entity_type === "world_entry") {
          const effect = await updateWorld(operation, operation.target_id, context)
          for (const id of operation.source_ids) await deleteWorldEntry(id, context.directory)
          results.push({
            index,
            action: "merge",
            entity_type: operation.entity_type,
            status: "success",
            entry_ids: [operation.target_id, ...operation.source_ids],
            ...effect,
          })
        } else if (operation.entity_type === "character") {
          const db = getDb(context.directory)
          const target = await db.select().from(CharacterTable).where(eq(CharacterTable.id, operation.target_id)).get()
          if (!target) throw new Error(`character 目标不存在：${operation.target_id}`)
          const sources = await db.select().from(CharacterTable).where(inArray(CharacterTable.id, operation.source_ids)).all()
          if (sources.length !== operation.source_ids.length) throw new Error("character 合并源不存在")
          for (const source of sources) {
            if (source.name.trim() !== target.name.trim()) throw new Error(`character 合并身份不一致：${source.id}`)
          }
          const description = mergedDescription(
            target.description,
            sources.map((source) => source.description),
            operation.fields.description,
          )
          const effect = await updateCharacterFields(operation, operation.target_id, context, description)
          await redirectCharacterReferences(context.directory, operation.source_ids, operation.target_id)
          for (const id of operation.source_ids) await deleteCharacter(id, context.directory)
          results.push({
            index,
            action: "merge",
            entity_type: operation.entity_type,
            status: "success",
            entry_ids: [operation.target_id, ...operation.source_ids],
            ...effect,
          })
        } else if (operation.entity_type === "relationship") {
          const db = getDb(context.directory)
          const target = await db.select().from(RelationshipTable).where(eq(RelationshipTable.id, operation.target_id)).get()
          if (!target) throw new Error(`relationship 目标不存在：${operation.target_id}`)
          const sources = await db.select().from(RelationshipTable).where(inArray(RelationshipTable.id, operation.source_ids)).all()
          if (sources.length !== operation.source_ids.length) throw new Error("relationship 合并源不存在")
          for (const source of sources) {
            const sameIdentity =
              target.char_a_id === source.char_a_id && target.char_b_id === source.char_b_id && target.type === source.type
            if (!sameIdentity) throw new Error(`relationship 合并身份不一致：${source.id}`)
          }
          const description = mergedDescription(
            target.description,
            sources.map((source) => source.description),
            operation.fields.description,
          )
          const effect = await updateSimpleFields(operation, operation.target_id, context, description)
          for (const id of operation.source_ids) await deleteRelationship(id, context.directory)
          results.push({
            index,
            action: "merge",
            entity_type: operation.entity_type,
            status: "success",
            entry_ids: [operation.target_id, ...operation.source_ids],
            ...effect,
          })
        } else {
          throw new Error(`不支持的合并实体类型：${operation.entity_type}`)
        }
      } else {
        await deleteEntity(operation, context)
        results.push({
          index,
          action: "delete",
          entity_type: operation.entity_type,
          status: "success",
          entry_ids: [operation.id],
        })
      }
    } catch (error) {
      results.push({
        index,
        action: operation.action,
        entity_type: operation.entity_type,
        status: "failed",
        entry_ids: operationEntryIds(operation),
        error: error instanceof Error ? error.message : String(error),
      })
      for (const laterOperation of plan.operations.slice(index + 1)) {
        remaining.push({
          index: plan.operations.indexOf(laterOperation),
          action: laterOperation.action,
          entity_type: laterOperation.entity_type,
          entry_ids: operationEntryIds(laterOperation),
        })
      }
      break
    }
  }

  return { ok: results.every((result) => result.status === "success"), results, remaining }
}

/** 从 analyze 结果自动生成安全可执行的整理计划（仅覆盖确定性修复） */
export function generatePlanFromIssues(entities: OrganizeEntity[], issues: SettingIssue[]): OrganizePlan {
  const operations: OrganizeOperation[] = []
  const consumed = new Set<string>()

  for (const issue of issues) {
    // 同标题重复 → 保留 content 最长的一条，其余合并
    if (issue.type === "duplicate_title" && issue.entry_ids.length >= 2 && issue.entity_type === "world_entry") {
      const group = entities.filter((e) => issue.entry_ids.includes(e.id) && !consumed.has(e.id))
      if (group.length < 2) continue
      const sorted = [...group].sort((a, b) => b.content.length - a.content.length)
      const target = sorted[0]!
      const sources = sorted.slice(1).map((e) => e.id)
      if (sources.length === 0) continue
      for (const id of sources) consumed.add(id)
      operations.push({
        action: "merge",
        entity_type: "world_entry",
        target_id: target.id,
        source_ids: sources,
        fields: {},
        reason: `同标题重复（${group.length} 条），保留内容最长的「${target.title}」`,
      })
    }

    // 长单段内容 → 只拆分超长段落，在句号/感叹号/问号后插入段落分隔
    if (issue.type === "long_single_paragraph" && issue.entry_ids.length === 1) {
      const entity = entities.find((e) => e.id === issue.entry_ids[0] && !consumed.has(e.id))
      if (!entity) continue
      const field = ["character", "relationship", "plot_thread"].includes(issue.entity_type) ? "description" : "content"
      const text = field === "content" ? entity.content : entity.description
      const sourceParagraphs = paragraphs(text)
      if (!sourceParagraphs.some((paragraph) => paragraph.length > 600)) continue
      const outputParagraphs: string[] = []
      let changed = false
      for (const paragraph of sourceParagraphs) {
        if (paragraph.length <= 600) {
          outputParagraphs.push(paragraph)
          continue
        }
        const split = splitIntoParagraphs(paragraph)
        if (split.length < 2 || split.some((item) => item.length > 600)) {
          outputParagraphs.push(paragraph)
          continue
        }
        changed = true
        outputParagraphs.push(...split)
      }
      if (!changed) continue
      const formatted = outputParagraphs.join("\n\n")
      if (formatted === text) continue
      operations.push({
        action: "update",
        entity_type: issue.entity_type,
        id: entity.id,
        fields: { [field]: formatted },
        reason: `长段落（${sourceParagraphs.find((paragraph) => paragraph.length > 600)!.length} 字，超过 600 字）自动按句末分段`,
      })
    }

    // 非标准分类 → 通过关键词匹配映射到标准分类
    if (issue.type === "nonstandard_category" && issue.entry_ids.length === 1 && issue.entity_type === "world_entry") {
      const entity = entities.find((e) => e.id === issue.entry_ids[0] && !consumed.has(e.id))
      if (!entity) continue
      const suggested = suggestStandardCategory(entity.category)
      if (!suggested) continue
      operations.push({
        action: "update",
        entity_type: "world_entry",
        id: entity.id,
        fields: { category: suggested },
        reason: `非标准分类「${entity.category}」→「${suggested}」`,
      })
    }
  }

  return { version: 2, operations }
}

function splitIntoParagraphs(text: string): string[] {
  const sentences = text.split(/(?<=[。！？])/)
  const paragraphs: string[] = []
  let current = ""
  for (const [index, sentence] of sentences.entries()) {
    current += sentence
    const next = sentences[index + 1]
    if (current.length >= 80 && (!next || current.length + next.length > 220)) {
      paragraphs.push(current.trim())
      current = ""
    }
  }
  if (current.trim()) paragraphs.push(current.trim())
  return paragraphs
}

function suggestStandardCategory(current: string): string | null {
  const lower = current.toLowerCase()
  const keywordMap: Array<[string[], string]> = [
    [["地点", "城市", "区域", "位置", "场所"], "地点"],
    [["势力", "组织", "门派", "公会", "帮派"], "势力"],
    [["人物", "角色", "角色设定"], "核心设定"],
    [["体系", "力量", "修炼", "等级", "境界"], "力量体系"],
    [["制度", "政治", "规则", "法律", "律法"], "社会制度"],
    [["历史", "编年", "纪元", "往事"], "历史"],
    [["文化", "习俗", "节日", "信仰", "宗教"], "文化"],
    [["生物", "种族", "怪物", "魔兽", "异兽"], "生物"],
    [["物品", "道具", "宝物", "神器", "装备"], "物品"],
    [["功法", "武学", "技能", "法术"], "功法"],
    [["科技", "机械", "发明", "技术"], "科技"],
    [["背景", "世界", "大陆", "星球", "宇宙"], "世界背景"],
    [["核心", "重要", "主线", "关键"], "核心设定"],
  ]
  for (const [keywords, category] of keywordMap) {
    if (keywords.some((k) => lower.includes(k))) return category
  }
  return null
}
