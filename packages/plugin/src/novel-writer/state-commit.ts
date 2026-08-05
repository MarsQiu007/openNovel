/**
 * 状态提交工具 — commitState
 *
 * 将状态变更 delta 写入 append-only novel_state_log 表，
 * 同步更新物化视图表，并追加 Markdown 记录到 .novel/state-log.md。
 *
 * 导出：
 * - commitState(novelId, chapterId, delta) — 状态提交函数
 * - StateDelta / StateDeltaEntry — Zod schema 类型
 * - FACT_TYPES — 10 种事实类型常量
 */

import { z } from "zod"
import { eq, and, desc, sql, inArray, ne } from "drizzle-orm"
import {
  getDb,
  NovelStateLogTable,
  CharacterTable,
  CharacterStateTable,
  RelationshipTable,
  PlotThreadTable,
  ForeshadowingTable,
  WorldEntryTable,
  ChapterSummaryTable,
  StyleGuideTable,
  TensionLogTable,
  EntityRefTable,
  PendingUpdateTable,
  SagaSessionTable,
  VolumeTable,
  ChapterTable,
  DescriptionHistoryTable,
} from "./session-store.js"
import { join } from "path"
import { mkdirSync, appendFileSync } from "fs"

// ─── 10 种事实类型 ───

/** 事实类型枚举 */
export const FACT_TYPES = [
  "character",
  "relationship",
  "plot_thread",
  "foreshadow",
  "world_entry",
  "chapter_summary",
  "style",
  "timeline",
  "location",
  "tension",
] as const

export type FactType = (typeof FACT_TYPES)[number]

// ─── Zod schema 定义 ───

/** 事实类型 */
const FactTypeSchema = z.enum(FACT_TYPES)

/** 操作类型：创建 / 更新 / 删除 */
const ActionSchema = z.enum(["create", "update", "delete"])

/** 单条状态变更条目 */
const StateDeltaEntrySchema = z.object({
  fact_type: FactTypeSchema,
  action: ActionSchema,
  entity_id: z.string().describe("实体 ID"),
  data: z.record(z.string(), z.unknown()).describe("变更数据"),
})

/** 状态变更 delta 数组 */
export const StateDeltaSchema = z.array(StateDeltaEntrySchema)

/** 单条状态变更条目类型 */
export type StateDeltaEntry = z.infer<typeof StateDeltaEntrySchema>

/** 状态变更 delta 类型 */
export type StateDelta = z.infer<typeof StateDeltaSchema>

// ─── Markdown 同步辅助函数 ───

/** 获取 .novel 目录路径（相对于当前工作目录） */
function getNovelDir(): string {
  return join(process.cwd(), ".novel")
}

/** 确保 .novel 目录存在 */
function ensureNovelDir(): void {
  mkdirSync(getNovelDir(), { recursive: true })
}

/** 追加 Markdown 记录到 .novel/state-log.md */
function appendToMarkdown(novelId: string, chapterId: string, entries: StateDelta): void {
  ensureNovelDir()
  const now = new Date().toISOString()
  const lines: string[] = []

  lines.push("")
  lines.push(`## ${now} — ${novelId}`)
  if (chapterId) {
    lines.push(`> 章节：${chapterId}`)
  }
  lines.push("")

  for (const entry of entries) {
    const actionLabel = entry.action === "create" ? "创建" : entry.action === "update" ? "更新" : "删除"
    lines.push(`- **${entry.fact_type}** \`${actionLabel}\` \`${entry.entity_id}\``)
    const dataStr = JSON.stringify(entry.data, null, 2)
    lines.push(`  \`\`\`json`)
    lines.push(`  ${dataStr}`)
    lines.push(`  \`\`\``)
  }

  lines.push("")

  const content = lines.join("\n")
  const logPath = join(getNovelDir(), "state-log.md")
  appendFileSync(logPath, content, "utf-8")
}

// ─── 物化视图更新逻辑 ───

/**
 * 解析角色真实 ID。
 *
 * observer 输出的角色 entity_id 可能是本地引用（如 char_linmo），
 * 若该 ID 在角色表中不存在，则按姓名匹配已存在的角色，
 * 避免重复创建角色、以及产生 character_id 对不上的孤儿状态记录。
 */
async function resolveCharacterId(
  db: ReturnType<typeof getDb>,
  novelId: string,
  entityId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const [byId] = await db
    .select({ id: CharacterTable.id })
    .from(CharacterTable)
    .where(eq(CharacterTable.id, entityId))
    .limit(1)
    .all()
  if (byId) return entityId
  const name = typeof data.name === "string" && data.name.length > 0 ? data.name : null
  if (name) {
    const [byName] = await db
      .select({ id: CharacterTable.id })
      .from(CharacterTable)
      .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.name, name)))
      .limit(1)
      .all()
    if (byName) return byName.id
  }
  return entityId
}

/**
 * 通用实体去重：把 observer 生成的本地/随机 entity_id 解析为库中已有实体的真实 ID。
 *
 * 命中已有实体时返回其 ID（create 会退化为 update），未命中返回原 entityId（执行新建）。
 * character 按姓名去重；relationship 按双方角色+关系类型去重；plot_thread 按标题；
 * foreshadow 按内容；world_entry 按分类+标题；style 每本小说单例。
 */
async function resolveEntityId(
  db: ReturnType<typeof getDb>,
  novelId: string,
  factType: string,
  entityId: string,
  data: Record<string, unknown>,
): Promise<string> {
  if (factType === "character") return resolveCharacterId(db, novelId, entityId, data)

  if (await findEntityById(db, factType, entityId)) return entityId

  if (factType === "relationship") {
    const [byKey] = await db
      .select({ id: RelationshipTable.id })
      .from(RelationshipTable)
      .where(
        and(
          eq(RelationshipTable.char_a_id, String(data.char_a_id ?? "")),
          eq(RelationshipTable.char_b_id, String(data.char_b_id ?? "")),
          eq(RelationshipTable.type, String(data.type ?? "")),
        ),
      )
      .limit(1)
      .all()
    if (byKey) return byKey.id
  }

  if (factType === "plot_thread" && typeof data.title === "string" && data.title.length > 0) {
    const [byTitle] = await db
      .select({ id: PlotThreadTable.id })
      .from(PlotThreadTable)
      .where(and(eq(PlotThreadTable.novel_id, novelId), eq(PlotThreadTable.title, data.title)))
      .limit(1)
      .all()
    if (byTitle) return byTitle.id
  }

  if (factType === "foreshadow" && typeof data.content === "string" && data.content.length > 0) {
    const [byContent] = await db
      .select({ id: ForeshadowingTable.id })
      .from(ForeshadowingTable)
      .where(and(eq(ForeshadowingTable.novel_id, novelId), eq(ForeshadowingTable.content, data.content)))
      .limit(1)
      .all()
    if (byContent) return byContent.id
  }

  if (factType === "world_entry" && typeof data.title === "string" && data.title.length > 0) {
    const [byTitle] = await db
      .select({ id: WorldEntryTable.id })
      .from(WorldEntryTable)
      .where(
        and(
          eq(WorldEntryTable.novel_id, novelId),
          eq(WorldEntryTable.category, String(data.category ?? "")),
          eq(WorldEntryTable.title, data.title),
        ),
      )
      .limit(1)
      .all()
    if (byTitle) return byTitle.id
  }

  if (factType === "style") {
    const [existing] = await db
      .select({ id: StyleGuideTable.id })
      .from(StyleGuideTable)
      .where(eq(StyleGuideTable.novel_id, novelId))
      .limit(1)
      .all()
    if (existing) return existing.id
  }

  return entityId
}

/** 按实体表主键查找，供 resolveEntityId 的"已存在"短路使用。 */
async function findEntityById(db: ReturnType<typeof getDb>, factType: string, entityId: string): Promise<boolean> {
  const table = {
    relationship: RelationshipTable,
    plot_thread: PlotThreadTable,
    foreshadow: ForeshadowingTable,
    world_entry: WorldEntryTable,
    style: StyleGuideTable,
  }[factType]
  if (!table) return false
  const [row] = await db
    .select({ id: (table as any).id })
    .from(table as any)
    .where(eq((table as any).id, entityId))
    .limit(1)
    .all()
  return !!row
}

/** 插入一条角色状态记录；未传的状态字段回退到最近一条（prev） */
async function insertCharacterStateRow(
  db: ReturnType<typeof getDb>,
  characterId: string,
  chapterId: string,
  data: Record<string, unknown>,
  prev?: typeof CharacterStateTable.$inferSelect | null,
): Promise<void> {
  await db.insert(CharacterStateTable).values({
    id: crypto.randomUUID(),
    character_id: characterId,
    chapter_id: (data.chapter_id as string) ?? chapterId ?? prev?.chapter_id ?? null,
    active: data.active !== undefined ? Number(data.active) : (prev?.active ?? 1),
    location: String(data.location ?? prev?.location ?? ""),
    mood: String(data.mood ?? prev?.mood ?? ""),
    summary: String(data.summary ?? prev?.summary ?? ""),
  } as any)
}

/** 查询章节序号（order），供 tension 记录按章号写入 */
async function getChapterOrder(db: ReturnType<typeof getDb>, chapterId: string): Promise<number | null> {
  if (!chapterId) return null
  const [ch] = await db
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.id, chapterId))
    .limit(1)
    .all()
  return ch ? ch.order : null
}

/**
 * 清理某章归属的快照数据，供重跑章节时幂等替换。
 *
 * 删除范围：character_states（本章所有角色状态）、chapter_summaries（本章摘要）、
 * tension_logs（本章张力记录，按 chapter_number 定位）。entity_refs 在 scanReferences
 * 写入时自行先删后插，不在此处理。
 */
async function resetChapterScopedState(
  db: ReturnType<typeof getDb>,
  novelId: string,
  chapterId: string,
): Promise<void> {
  if (!chapterId) return
  await db.delete(CharacterStateTable).where(eq(CharacterStateTable.chapter_id, chapterId)).run()
  await db.delete(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapterId)).run()
  const order = await getChapterOrder(db, chapterId)
  if (order != null) {
    await db
      .delete(TensionLogTable)
      .where(and(eq(TensionLogTable.novel_id, novelId), eq(TensionLogTable.chapter_number, order)))
      .run()
  }
}

/**
 * 根据 delta 条目更新物化视图表
 *
 * 将 fact_type 映射到对应的物化视图表，根据 action 执行 INSERT / UPDATE / DELETE。
 * character 类型会同时更新 characters 和 character_states 两张表。
 * tension 类型按章节号覆盖写入 tension_log。
 * timeline 和 location 类型仅记录日志，不更新物化视图。
 */
async function applyToMaterializedView(
  db: ReturnType<typeof getDb>,
  novelId: string,
  chapterId: string,
  entry: StateDeltaEntry,
): Promise<void> {
  const { fact_type, action, entity_id, data } = entry

  switch (fact_type) {
    case "character": {
      // observer 可能输出 char_<拼音> 本地引用，先解析到真实角色 ID（按 ID 或姓名匹配），
      // 避免重复创建角色、以及产生 character_id 对不上的孤儿状态记录
      const resolvedId = await resolveCharacterId(db, novelId, entity_id, data)

      if (action === "create") {
        if (resolvedId === entity_id) {
          // 角色不存在，插入基本信息
          await db.insert(CharacterTable).values({
            id: entity_id,
            novel_id: novelId,
            name: String(data.name ?? ""),
            role: String(data.role ?? ""),
            description: String(data.description ?? ""),
          } as any)
          // 插入初始角色状态
          await insertCharacterStateRow(db, entity_id, chapterId, data, null)
        } else {
          // 同名角色已存在（按姓名解析到真实 ID），仅记录状态，不重复创建
          const [prev] = await db
            .select()
            .from(CharacterStateTable)
            .where(eq(CharacterStateTable.character_id, resolvedId))
            .orderBy(desc(sql`rowid`))
            .limit(1)
            .all()
          await insertCharacterStateRow(db, resolvedId, chapterId, data, prev)
        }
      } else if (action === "update") {
        // 更新角色基本信息
        const charFields: Record<string, unknown> = {}
        if (data.name !== undefined) charFields.name = data.name
        if (data.role !== undefined) charFields.role = data.role
        if (data.description !== undefined) charFields.description = data.description
        if (Object.keys(charFields).length > 0) {
          await db
            .update(CharacterTable)
            .set(charFields as any)
            .where(eq(CharacterTable.id, resolvedId))
        }
        // 如果包含状态字段，插入新的角色状态记录
        const hasStateFields =
          data.active !== undefined ||
          data.location !== undefined ||
          data.mood !== undefined ||
          data.summary !== undefined
        if (hasStateFields) {
          // 先读最近一条角色状态，未传字段回退到旧值，避免部分更新丢失数据
          const [prev] = await db
            .select()
            .from(CharacterStateTable)
            .where(eq(CharacterStateTable.character_id, resolvedId))
            .orderBy(desc(sql`rowid`))
            .limit(1)
            .all()
          await insertCharacterStateRow(db, resolvedId, chapterId, data, prev)
        }
      } else if (action === "delete") {
        await db.delete(CharacterTable).where(eq(CharacterTable.id, resolvedId))
      }
      break
    }

    case "relationship": {
      if (action === "create") {
        const resolvedId = await resolveEntityId(db, novelId, "relationship", entity_id, data)
        if (resolvedId === entity_id) {
          await db.insert(RelationshipTable).values({
            id: entity_id,
            novel_id: novelId,
            char_a_id: String(data.char_a_id ?? ""),
            char_b_id: String(data.char_b_id ?? ""),
            type: String(data.type ?? ""),
            description: String(data.description ?? ""),
          } as any)
        } else {
          // 同双方+类型的关系已存在，把新描述合并更新，不重复建
          const fields: Record<string, unknown> = {}
          if (data.char_a_id !== undefined) fields.char_a_id = data.char_a_id
          if (data.char_b_id !== undefined) fields.char_b_id = data.char_b_id
          if (data.type !== undefined) fields.type = data.type
          if (data.description !== undefined) fields.description = data.description
          if (Object.keys(fields).length > 0) {
            await db
              .update(RelationshipTable)
              .set(fields as any)
              .where(eq(RelationshipTable.id, resolvedId))
          }
        }
      } else if (action === "update") {
        const fields: Record<string, unknown> = {}
        if (data.char_a_id !== undefined) fields.char_a_id = data.char_a_id
        if (data.char_b_id !== undefined) fields.char_b_id = data.char_b_id
        if (data.type !== undefined) fields.type = data.type
        if (data.description !== undefined) fields.description = data.description
        if (Object.keys(fields).length > 0) {
          await db
            .update(RelationshipTable)
            .set(fields as any)
            .where(eq(RelationshipTable.id, entity_id))
        }
      } else if (action === "delete") {
        await db.delete(RelationshipTable).where(eq(RelationshipTable.id, entity_id))
      }
      break
    }

    case "plot_thread": {
      if (action === "create") {
        const resolvedId = await resolveEntityId(db, novelId, "plot_thread", entity_id, data)
        if (resolvedId === entity_id) {
          await db.insert(PlotThreadTable).values({
            id: entity_id,
            novel_id: novelId,
            title: String(data.title ?? ""),
            status: String(data.status ?? "open"),
            priority: String(data.priority ?? "medium"),
            description: String(data.description ?? ""),
            closed_at: data.closed_at ? Number(data.closed_at) : null,
          } as any)
        } else {
          const fields: Record<string, unknown> = {}
          if (data.title !== undefined) fields.title = data.title
          if (data.status !== undefined) fields.status = data.status
          if (data.priority !== undefined) fields.priority = data.priority
          if (data.description !== undefined) fields.description = data.description
          if (data.closed_at !== undefined) fields.closed_at = data.closed_at ? Number(data.closed_at) : null
          if (Object.keys(fields).length > 0) {
            await db
              .update(PlotThreadTable)
              .set(fields as any)
              .where(eq(PlotThreadTable.id, resolvedId))
          }
        }
      } else if (action === "update") {
        const fields: Record<string, unknown> = {}
        if (data.title !== undefined) fields.title = data.title
        if (data.status !== undefined) fields.status = data.status
        if (data.priority !== undefined) fields.priority = data.priority
        if (data.description !== undefined) fields.description = data.description
        if (data.closed_at !== undefined) fields.closed_at = data.closed_at ? Number(data.closed_at) : null
        if (Object.keys(fields).length > 0) {
          await db
            .update(PlotThreadTable)
            .set(fields as any)
            .where(eq(PlotThreadTable.id, entity_id))
        }
      } else if (action === "delete") {
        await db.delete(PlotThreadTable).where(eq(PlotThreadTable.id, entity_id))
      }
      break
    }

    case "foreshadow": {
      if (action === "create") {
        const resolvedId = await resolveEntityId(db, novelId, "foreshadow", entity_id, data)
        if (resolvedId === entity_id) {
          await db.insert(ForeshadowingTable).values({
            id: entity_id,
            novel_id: novelId,
            planted_chapter_id: (data.planted_chapter_id as string) ?? null,
            resolved_chapter_id: (data.resolved_chapter_id as string) ?? null,
            content: String(data.content ?? ""),
            state: String(data.state ?? "planted"),
          } as any)
        } else {
          const fields: Record<string, unknown> = {}
          if (data.planted_chapter_id !== undefined) fields.planted_chapter_id = data.planted_chapter_id
          if (data.resolved_chapter_id !== undefined) fields.resolved_chapter_id = data.resolved_chapter_id
          if (data.content !== undefined) fields.content = data.content
          if (data.state !== undefined) fields.state = data.state
          if (Object.keys(fields).length > 0) {
            await db
              .update(ForeshadowingTable)
              .set(fields as any)
              .where(eq(ForeshadowingTable.id, resolvedId))
          }
        }
      } else if (action === "update") {
        const fields: Record<string, unknown> = {}
        if (data.planted_chapter_id !== undefined) fields.planted_chapter_id = data.planted_chapter_id
        if (data.resolved_chapter_id !== undefined) fields.resolved_chapter_id = data.resolved_chapter_id
        if (data.content !== undefined) fields.content = data.content
        if (data.state !== undefined) fields.state = data.state
        if (Object.keys(fields).length > 0) {
          await db
            .update(ForeshadowingTable)
            .set(fields as any)
            .where(eq(ForeshadowingTable.id, entity_id))
        }
      } else if (action === "delete") {
        await db.delete(ForeshadowingTable).where(eq(ForeshadowingTable.id, entity_id))
      }
      break
    }

    case "world_entry": {
      if (action === "create") {
        const resolvedId = await resolveEntityId(db, novelId, "world_entry", entity_id, data)
        if (resolvedId === entity_id) {
          await db.insert(WorldEntryTable).values({
            id: entity_id,
            novel_id: novelId,
            category: String(data.category ?? ""),
            title: String(data.title ?? ""),
            content: String(data.content ?? ""),
          } as any)
        } else {
          const fields: Record<string, unknown> = {}
          if (data.category !== undefined) fields.category = data.category
          if (data.title !== undefined) fields.title = data.title
          if (data.content !== undefined) fields.content = data.content
          if (Object.keys(fields).length > 0) {
            await db
              .update(WorldEntryTable)
              .set(fields as any)
              .where(eq(WorldEntryTable.id, resolvedId))
          }
        }
      } else if (action === "update") {
        const fields: Record<string, unknown> = {}
        if (data.category !== undefined) fields.category = data.category
        if (data.title !== undefined) fields.title = data.title
        if (data.content !== undefined) fields.content = data.content
        if (Object.keys(fields).length > 0) {
          await db
            .update(WorldEntryTable)
            .set(fields as any)
            .where(eq(WorldEntryTable.id, entity_id))
        }
      } else if (action === "delete") {
        await db.delete(WorldEntryTable).where(eq(WorldEntryTable.id, entity_id))
      }
      break
    }

    case "chapter_summary": {
      if (action === "create") {
        await db.insert(ChapterSummaryTable).values({
          id: entity_id,
          chapter_id: String(data.chapter_id ?? ""),
          summary: String(data.summary ?? ""),
          key_events: data.key_events ?? [],
          char_changes: data.char_changes ?? [],
        } as any)
      } else if (action === "update") {
        const fields: Record<string, unknown> = {}
        if (data.chapter_id !== undefined) fields.chapter_id = data.chapter_id
        if (data.summary !== undefined) fields.summary = data.summary
        if (data.key_events !== undefined) fields.key_events = data.key_events
        if (data.char_changes !== undefined) fields.char_changes = data.char_changes
        if (Object.keys(fields).length > 0) {
          await db
            .update(ChapterSummaryTable)
            .set(fields as any)
            .where(eq(ChapterSummaryTable.id, entity_id))
        }
      } else if (action === "delete") {
        await db.delete(ChapterSummaryTable).where(eq(ChapterSummaryTable.id, entity_id))
      }
      break
    }

    case "style": {
      if (action === "create") {
        const resolvedId = await resolveEntityId(db, novelId, "style", entity_id, data)
        if (resolvedId === entity_id) {
          await db.insert(StyleGuideTable).values({
            id: entity_id,
            novel_id: novelId,
            rules: stringifyRules(data.rules),
            tone: String(data.tone ?? ""),
            pov: String(data.pov ?? ""),
            tense: String(data.tense ?? ""),
          } as any)
        } else {
          // 每本小说只有一条风格指南，已存在则更新
          const fields: Record<string, unknown> = {}
          if (data.rules !== undefined) fields.rules = stringifyRules(data.rules)
          if (data.tone !== undefined) fields.tone = data.tone
          if (data.pov !== undefined) fields.pov = data.pov
          if (data.tense !== undefined) fields.tense = data.tense
          if (Object.keys(fields).length > 0) {
            await db
              .update(StyleGuideTable)
              .set(fields as any)
              .where(eq(StyleGuideTable.id, resolvedId))
          }
        }
      } else if (action === "update") {
        const fields: Record<string, unknown> = {}
        if (data.rules !== undefined) fields.rules = stringifyRules(data.rules)
        if (data.tone !== undefined) fields.tone = data.tone
        if (data.pov !== undefined) fields.pov = data.pov
        if (data.tense !== undefined) fields.tense = data.tense
        if (Object.keys(fields).length > 0) {
          await db
            .update(StyleGuideTable)
            .set(fields as any)
            .where(eq(StyleGuideTable.id, entity_id))
        }
      } else if (action === "delete") {
        await db.delete(StyleGuideTable).where(eq(StyleGuideTable.id, entity_id))
      }
      break
    }

    case "tension": {
      // 每章一条张力记录，按章节号覆盖写（幂等）
      const chapterNumber = await getChapterOrder(db, chapterId)
      if (chapterNumber == null) break
      const level = Number(data.level)
      if (Number.isNaN(level)) break
      const clampedLevel = Math.max(0, Math.min(10, level))
      await db
        .delete(TensionLogTable)
        .where(and(eq(TensionLogTable.novel_id, novelId), eq(TensionLogTable.chapter_number, chapterNumber)))
        .run()
      await db
        .insert(TensionLogTable)
        .values({
          id: crypto.randomUUID(),
          novel_id: novelId,
          chapter_number: chapterNumber,
          level: clampedLevel,
        })
        .run()
      break
    }

    case "timeline":
    case "location":
      // timeline 和 location 仅记录日志，不更新物化视图
      break

    default:
      break
  }
}

// ─── 核心函数 ───

/**
 * 提交状态变更
 *
 * 将 delta 中的每条变更写入 novel_state_log（append-only），
 * 同步更新对应的物化视图表，并追加 Markdown 记录到 .novel/state-log.md。
 *
 * @param novelId - 小说 ID
 * @param chapterId - 章节 ID（可为 null）
 * @param delta - 状态变更数组
 * @returns 提交的日志条目数量
 */
// 流水线产生的 rules 可能含数字/布尔值（如 chapter_length: 2500），统一转成字符串
export function stringifyRules(rules: unknown): Record<string, string> {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return {}
  const record: Record<string, string> = {}
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value === "string") record[key] = value
    else if (typeof value === "number" || typeof value === "boolean") record[key] = String(value)
  }
  return record
}

export async function commitState(
  novelId: string,
  chapterId: string,
  delta: StateDelta,
  directory?: string | null,
): Promise<number> {
  // 验证 delta 格式
  const validated = StateDeltaSchema.parse(delta)
  const db = getDb(directory)

  // 1. 写入 append-only 日志
  for (const entry of validated) {
    const logId = crypto.randomUUID()
    await db.insert(NovelStateLogTable).values({
      id: logId,
      novel_id: novelId,
      chapter_id: chapterId ?? null,
      fact_type: entry.fact_type,
      fact_data: entry.data,
      created_at: Date.now(),
    } as any)
  }

  // 2. 重跑章节时先清理本章归属的快照数据，保证"一章一份"语义幂等。
  //    character_states / chapter_summaries / tension_logs 都是本章快照，
  //    用本轮 delta 完整替换；小说级实体（character/foreshadow 等）的去重在
  //    applyToMaterializedView 内按业务键 find-or-create。
  //    novel_state_log 是审计日志、hook_rotation 是历史，不在此清理。
  await resetChapterScopedState(db, novelId, chapterId)

  // 3. 更新物化视图
  for (const entry of validated) {
    await applyToMaterializedView(db, novelId, chapterId, entry)
  }

  // 4. 同步 Markdown
  appendToMarkdown(novelId, chapterId, validated)

  // 5. 触发级联统改任务（仅 update 操作）
  for (const entry of validated) {
    if (entry.action !== "update") continue
    const changedFields = Object.keys(entry.data).join(", ")
    await cascadeCreateTasks(
      db,
      novelId,
      entry.fact_type,
      entry.entity_id,
      changedFields,
      "",
      JSON.stringify(entry.data),
      `${entry.fact_type} 更新（${changedFields}）`,
    )
  }

  return validated.length
}

// ─── 级联一致性：依赖追踪 + 统查统改 ───

export async function scanReferences(
  db: ReturnType<typeof getDb>,
  novelId: string,
  sourceType: string,
  sourceId: string,
  field: string,
  content: string,
): Promise<number> {
  await db
    .delete(EntityRefTable)
    .where(
      and(
        eq(EntityRefTable.source_type, sourceType),
        eq(EntityRefTable.source_id, sourceId),
        eq(EntityRefTable.ref_field, field),
      ),
    )
    .run()

  if (!content) return 0

  const characters = await db
    .select({ id: CharacterTable.id, name: CharacterTable.name })
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .all()
  const worldEntries = await db
    .select({ id: WorldEntryTable.id, title: WorldEntryTable.title })
    .from(WorldEntryTable)
    .where(eq(WorldEntryTable.novel_id, novelId))
    .all()
  const plotThreads = await db
    .select({ id: PlotThreadTable.id, title: PlotThreadTable.title })
    .from(PlotThreadTable)
    .where(eq(PlotThreadTable.novel_id, novelId))
    .all()

  const entities = [
    ...characters.map((c) => ({ type: "character", id: c.id, name: c.name })),
    ...worldEntries.map((w) => ({ type: "world_entry", id: w.id, name: w.title })),
    ...plotThreads.map((p) => ({ type: "plot_thread", id: p.id, name: p.title })),
  ]

  let count = 0
  for (const ent of entities) {
    if (ent.name.length < 2) continue
    const idx = content.indexOf(ent.name)
    if (idx < 0) continue
    const start = Math.max(0, idx - 25)
    const end = Math.min(content.length, idx + ent.name.length + 25)
    await db
      .insert(EntityRefTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        source_type: sourceType,
        source_id: sourceId,
        target_type: ent.type,
        target_id: ent.id,
        ref_field: field,
        ref_text: content.slice(start, end),
      } as any)
      .run()
    count++
  }
  return count
}

export async function cascadeCheck(
  db: ReturnType<typeof getDb>,
  novelId: string,
  targetType: string,
  targetId: string,
) {
  return db
    .select({
      source_type: EntityRefTable.source_type,
      source_id: EntityRefTable.source_id,
      ref_field: EntityRefTable.ref_field,
      ref_text: EntityRefTable.ref_text,
    })
    .from(EntityRefTable)
    .where(
      and(
        eq(EntityRefTable.novel_id, novelId),
        eq(EntityRefTable.target_type, targetType),
        eq(EntityRefTable.target_id, targetId),
      ),
    )
    .all()
}

export async function cascadeCreateTasks(
  db: ReturnType<typeof getDb>,
  novelId: string,
  triggerType: string,
  triggerId: string,
  triggerField: string,
  oldValue: string,
  newValue: string,
  reason: string,
): Promise<number> {
  // 无正文章节时跳过级联——初始建设定阶段不应产生统改任务
  const writtenChapters = await db
    .select({ id: ChapterTable.id })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), ne(ChapterTable.status, "outline")))
    .limit(1)
    .all()
  if (writtenChapters.length === 0) return 0

  const affected = await cascadeCheck(db, novelId, triggerType, triggerId)
  let count = 0
  for (const ref of affected) {
    const existing = await db
      .select({ id: PendingUpdateTable.id })
      .from(PendingUpdateTable)
      .where(
        and(
          eq(PendingUpdateTable.novel_id, novelId),
          eq(PendingUpdateTable.source_type, ref.source_type),
          eq(PendingUpdateTable.source_id, ref.source_id),
          eq(PendingUpdateTable.trigger_type, triggerType),
          eq(PendingUpdateTable.trigger_id, triggerId),
          eq(PendingUpdateTable.status, "pending"),
        ),
      )
      .limit(1)
      .all()
    if (existing.length > 0) continue

    const priority = computeCascadePriority(triggerType, ref.source_type)
    await db
      .insert(PendingUpdateTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        source_type: ref.source_type,
        source_id: ref.source_id,
        trigger_type: triggerType,
        trigger_id: triggerId,
        trigger_field: triggerField,
        old_value: oldValue,
        new_value: newValue,
        reason,
        status: "pending",
        priority,
      } as any)
      .run()
    count++
  }
  return count
}

function computeCascadePriority(triggerType: string, sourceType: string): string {
  if (triggerType === "character" && sourceType === "relationship") return "high"
  if (triggerType === "world_entry" && sourceType === "chapter") return "high"
  if (triggerType === "style") return "high"
  if (triggerType === "character" && sourceType === "chapter") return "medium"
  if (triggerType === "plot_thread" && sourceType === "chapter") return "medium"
  if (triggerType === "foreshadow" && sourceType === "chapter") return "medium"
  return "low"
}

export async function cascadeListPending(db: ReturnType<typeof getDb>, novelId: string, status = "pending") {
  return db
    .select()
    .from(PendingUpdateTable)
    .where(and(eq(PendingUpdateTable.novel_id, novelId), eq(PendingUpdateTable.status, status)))
    .all()
}

export async function cascadeResolve(
  db: ReturnType<typeof getDb>,
  taskId: string,
  status: "done" | "skipped",
): Promise<boolean> {
  const result = await db
    .update(PendingUpdateTable)
    .set({ status, resolved_at: Date.now() })
    .where(eq(PendingUpdateTable.id, taskId))
    .returning({ id: PendingUpdateTable.id })
    .all()
  return result.length > 0
}

export async function cascadeRebuildRefs(
  db: ReturnType<typeof getDb>,
  novelId: string,
): Promise<{ chapters: number; characters: number; volumes: number }> {
  const chapters = await db
    .select({ id: ChapterTable.id, content: ChapterTable.content })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .all()
  let chapterCount = 0
  for (const ch of chapters) {
    if (ch.content) {
      await scanReferences(db, novelId, "chapter", ch.id, "content", ch.content)
      chapterCount++
    }
  }

  const characters = await db
    .select({ id: CharacterTable.id, description: CharacterTable.description })
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .all()
  let characterCount = 0
  for (const c of characters) {
    if (c.description) {
      await scanReferences(db, novelId, "character", c.id, "description", c.description)
      characterCount++
    }
  }

  const volumes = await db
    .select({ id: VolumeTable.id, summary: VolumeTable.summary })
    .from(VolumeTable)
    .where(eq(VolumeTable.novel_id, novelId))
    .all()
  let volumeCount = 0
  for (const v of volumes) {
    if (v.summary) {
      await scanReferences(db, novelId, "volume", v.id, "summary", v.summary)
      volumeCount++
    }
  }

  return { chapters: chapterCount, characters: characterCount, volumes: volumeCount }
}

// ─── Saga 统改执行器 ───

export interface SagaStepResult {
  task_id: string
  source_type: string
  source_id: string
  action: "updated" | "skipped" | "failed"
  detail: string
}

export interface SagaExecuteResult {
  saga_id: string
  status: "completed" | "partial" | "no_tasks"
  total: number
  completed: number
  failed: number
  skipped: number
  steps: SagaStepResult[]
}

/**
 * Saga 统改执行器 -- 批量处理所有 pending 统改任务。
 *
 * 流程：
 * 1. 创建 saga_session 记录（持久化状态）
 * 2. 查询所有 pending 任务，按优先级排序
 * 3. 逐个处理：chapter -> 标记为待人工处理，character -> 直接更新描述
 * 4. 每步持久化进度
 * 5. 全部完成后验证无残留 pending
 *
 * 注：chapter 类型的任务需要 LLM 辅助改写，此函数只标记为 "needs_revision"，
 * 由 director 后续 dispatch @reviser 处理。character 类型可直接更新描述。
 */
export async function cascadeExecute(
  db: ReturnType<typeof getDb>,
  novelId: string,
  triggerType?: string,
  triggerId?: string,
): Promise<SagaExecuteResult> {
  const conditions = [eq(PendingUpdateTable.novel_id, novelId), eq(PendingUpdateTable.status, "pending")]
  if (triggerType && triggerId) {
    conditions.push(eq(PendingUpdateTable.trigger_type, triggerType))
    conditions.push(eq(PendingUpdateTable.trigger_id, triggerId))
  }

  const tasks = db
    .select()
    .from(PendingUpdateTable)
    .where(and(...conditions))
    .all()

  if (tasks.length === 0) {
    return {
      saga_id: "",
      status: "no_tasks",
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      steps: [],
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  tasks.sort(
    (a, b) =>
      (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3) -
      (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3),
  )

  const sagaId = crypto.randomUUID()
  const now = Date.now()
  await db
    .insert(SagaSessionTable)
    .values({
      id: sagaId,
      novel_id: novelId,
      trigger_type: triggerType ?? tasks[0].trigger_type,
      trigger_id: triggerId ?? tasks[0].trigger_id,
      trigger_field: tasks[0].trigger_field,
      old_value: tasks[0].old_value,
      new_value: tasks[0].new_value,
      reason: tasks[0].reason,
      status: "in_progress",
      total_tasks: tasks.length,
      completed_tasks: 0,
      failed_tasks: 0,
      current_task_id: tasks[0].id,
      created_at: now,
      updated_at: now,
    } as any)
    .run()

  const steps: SagaStepResult[] = []
  let completed = 0
  let failed = 0
  let skipped = 0

  for (const task of tasks) {
    await db
      .update(SagaSessionTable)
      .set({ current_task_id: task.id, updated_at: Date.now() })
      .where(eq(SagaSessionTable.id, sagaId))
      .run()

    const stepResult = await executeSagaTask(db, novelId, task)

    if (stepResult.action === "updated" || stepResult.action === "skipped") {
      await db
        .update(PendingUpdateTable)
        .set({
          status: stepResult.action === "updated" ? "done" : "skipped",
          resolved_at: Date.now(),
        })
        .where(eq(PendingUpdateTable.id, task.id))
        .run()
      if (stepResult.action === "updated") completed++
      else skipped++
    } else {
      await db.update(PendingUpdateTable).set({ status: "failed" }).where(eq(PendingUpdateTable.id, task.id)).run()
      failed++
    }

    steps.push(stepResult)

    await db
      .update(SagaSessionTable)
      .set({
        completed_tasks: completed + skipped,
        failed_tasks: failed,
        updated_at: Date.now(),
      })
      .where(eq(SagaSessionTable.id, sagaId))
      .run()
  }

  const finalStatus = failed === 0 ? "completed" : "partial"
  await db
    .update(SagaSessionTable)
    .set({
      status: finalStatus,
      completed_at: Date.now(),
      updated_at: Date.now(),
    })
    .where(eq(SagaSessionTable.id, sagaId))
    .run()

  return {
    saga_id: sagaId,
    status: finalStatus,
    total: tasks.length,
    completed,
    failed,
    skipped,
    steps,
  }
}

async function executeSagaTask(
  db: ReturnType<typeof getDb>,
  novelId: string,
  task: typeof PendingUpdateTable.$inferSelect,
): Promise<SagaStepResult> {
  if (task.source_type === "character") {
    return updateCharacterFromTask(db, novelId, task)
  }

  if (task.source_type === "chapter") {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "章节内容需要 LLM 辅助改写，请 director dispatch @reviser 处理",
    }
  }

  if (task.source_type === "volume") {
    return updateVolumeFromTask(db, novelId, task)
  }

  return {
    task_id: task.id,
    source_type: task.source_type,
    source_id: task.source_id,
    action: "skipped",
    detail: `不支持自动处理的 source_type: ${task.source_type}`,
  }
}

async function updateCharacterFromTask(
  db: ReturnType<typeof getDb>,
  novelId: string,
  task: typeof PendingUpdateTable.$inferSelect,
): Promise<SagaStepResult> {
  const [character] = await db.select().from(CharacterTable).where(eq(CharacterTable.id, task.source_id)).all()

  if (!character) {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "角色不存在，可能已删除",
    }
  }

  const oldValue = task.old_value
  const newValue = task.new_value
  if (!oldValue || !newValue) {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "缺少 old_value 或 new_value，无法自动替换",
    }
  }

  const updatedDescription = character.description.split(oldValue).join(newValue)
  if (updatedDescription === character.description) {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "描述中未找到旧值，可能已被更新",
    }
  }

  await db
    .update(CharacterTable)
    .set({ description: updatedDescription })
    .where(eq(CharacterTable.id, task.source_id))
    .run()

  await scanReferences(db, novelId, "character", task.source_id, "description", updatedDescription)

  return {
    task_id: task.id,
    source_type: task.source_type,
    source_id: task.source_id,
    action: "updated",
    detail: `角色描述已更新："${oldValue}" -> "${newValue}"`,
  }
}

async function updateVolumeFromTask(
  db: ReturnType<typeof getDb>,
  novelId: string,
  task: typeof PendingUpdateTable.$inferSelect,
): Promise<SagaStepResult> {
  const [volume] = await db.select().from(VolumeTable).where(eq(VolumeTable.id, task.source_id)).all()

  if (!volume) {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "卷不存在",
    }
  }

  const oldValue = task.old_value
  const newValue = task.new_value
  if (!oldValue || !newValue || !volume.summary) {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "缺少 old_value/new_value 或卷摘要为空",
    }
  }

  const updatedSummary = volume.summary.split(oldValue).join(newValue)
  if (updatedSummary === volume.summary) {
    return {
      task_id: task.id,
      source_type: task.source_type,
      source_id: task.source_id,
      action: "skipped",
      detail: "摘要中未找到旧值",
    }
  }

  await db.update(VolumeTable).set({ summary: updatedSummary }).where(eq(VolumeTable.id, task.source_id)).run()

  await scanReferences(db, novelId, "volume", task.source_id, "summary", updatedSummary)

  return {
    task_id: task.id,
    source_type: task.source_type,
    source_id: task.source_id,
    action: "updated",
    detail: `卷摘要已更新："${oldValue}" -> "${newValue}"`,
  }
}

export async function cascadeGetStatus(db: ReturnType<typeof getDb>, novelId: string) {
  const pending = await db
    .select()
    .from(PendingUpdateTable)
    .where(and(eq(PendingUpdateTable.novel_id, novelId), eq(PendingUpdateTable.status, "pending")))
    .all()

  const activeSaga = await db
    .select()
    .from(SagaSessionTable)
    .where(and(eq(SagaSessionTable.novel_id, novelId), eq(SagaSessionTable.status, "in_progress")))
    .all()

  const recentSagas = await db
    .select()
    .from(SagaSessionTable)
    .where(eq(SagaSessionTable.novel_id, novelId))
    .orderBy(desc(sql`rowid`))
    .limit(5)
    .all()

  return {
    pending_count: pending.length,
    has_active_saga: activeSaga.length > 0,
    active_saga: activeSaga[0] ?? null,
    recent_sagas: recentSagas,
  }
}

// ─── 去重：角色与关系 ───

export interface DuplicateRecord {
  id: string
  role: string
  description: string
  created_at: number
}

export interface DuplicateGroup {
  name: string
  count: number
  kept_id: string
  removed_ids: string[]
  merged_description: boolean
  records: DuplicateRecord[]
}

export async function deduplicateCharacters(
  directory: string,
  novelId: string,
  dryRun = false,
  force = false,
): Promise<{
  duplicates: DuplicateGroup[]
  total_removed: number
  dry_run: boolean
  warnings: string[]
}> {
  const db = getDb(directory)
  const chars = await db
    .select()
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .orderBy(CharacterTable.created_at)
    .all()

  const byName = new Map<string, typeof chars>()
  for (const c of chars) {
    const arr = byName.get(c.name) ?? []
    arr.push(c)
    byName.set(c.name, arr)
  }

  const duplicates: DuplicateGroup[] = []
  const warnings: string[] = []
  let totalRemoved = 0

  for (const [name, group] of byName) {
    if (group.length < 2) continue

    const kept = group.reduce((best, cur) => (cur.description.length > best.description.length ? cur : best))
    const keptId = kept.id
    const removedIds = group.filter((c) => c.id !== keptId).map((c) => c.id)

    const otherDescs = group
      .filter((c) => c.id !== keptId && c.description.trim().length > 0)
      .map((c) => c.description.trim())
    const mergedDescription = otherDescs.length > 0 && otherDescs.some((d) => !kept.description.includes(d))

    if (!dryRun) {
      const maxOriginalLen = Math.max(...group.map((c) => c.description.length))
      if (!force && kept.description.length < maxOriginalLen) {
        warnings.push(
          `「${name}」保留描述 ${kept.description.length} 字 < 最长原始描述 ${maxOriginalLen} 字，疑似信息丢失，已跳过。请检查合并描述是否保留了所有信息，或设 force=true 强制执行。`,
        )
        duplicates.push({
          name,
          count: group.length,
          kept_id: keptId,
          removed_ids: removedIds,
          merged_description: false,
          records: group.map((c) => ({ id: c.id, role: c.role, description: c.description, created_at: c.created_at })),
        })
        continue
      }

      if (mergedDescription) {
        const combined = [kept.description.trim(), ...otherDescs]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join("\n\n---\n\n")
        await db.update(CharacterTable).set({ description: combined }).where(eq(CharacterTable.id, keptId)).run()
      }

      await db
        .update(RelationshipTable)
        .set({ char_a_id: keptId })
        .where(inArray(RelationshipTable.char_a_id, removedIds))
        .run()
      await db
        .update(RelationshipTable)
        .set({ char_b_id: keptId })
        .where(inArray(RelationshipTable.char_b_id, removedIds))
        .run()

      // entity_refs 的 source 和 target 都可能引用角色
      await db
        .update(EntityRefTable)
        .set({ source_id: keptId })
        .where(and(eq(EntityRefTable.source_type, "character"), inArray(EntityRefTable.source_id, removedIds)))
        .run()
      await db
        .update(EntityRefTable)
        .set({ target_id: keptId })
        .where(and(eq(EntityRefTable.target_type, "character"), inArray(EntityRefTable.target_id, removedIds)))
        .run()

      await db
        .update(PendingUpdateTable)
        .set({ source_id: keptId })
        .where(and(eq(PendingUpdateTable.source_type, "character"), inArray(PendingUpdateTable.source_id, removedIds)))
        .run()
      await db
        .update(PendingUpdateTable)
        .set({ trigger_id: keptId })
        .where(
          and(eq(PendingUpdateTable.trigger_type, "character"), inArray(PendingUpdateTable.trigger_id, removedIds)),
        )
        .run()

      await db.delete(CharacterTable).where(inArray(CharacterTable.id, removedIds)).run()
    }

    duplicates.push({
      name,
      count: group.length,
      kept_id: keptId,
      removed_ids: removedIds,
      merged_description: mergedDescription,
      records: group.map((c) => ({
        id: c.id,
        role: c.role,
        description: c.description,
        created_at: c.created_at,
      })),
    })
    totalRemoved += removedIds.length
  }

  return { duplicates, total_removed: totalRemoved, dry_run: dryRun, warnings }
}

export interface DuplicateRelGroup {
  char_a_id: string
  char_b_id: string
  type: string
  count: number
  kept_id: string
  removed_ids: string[]
  records: { id: string; description: string }[]
}

export async function deduplicateRelationships(
  directory: string,
  novelId: string,
  dryRun = false,
  force = false,
): Promise<{
  duplicates: DuplicateRelGroup[]
  total_removed: number
  dry_run: boolean
  warnings: string[]
}> {
  const db = getDb(directory)
  const rels = await db.select().from(RelationshipTable).where(eq(RelationshipTable.novel_id, novelId)).all()

  const keyOf = (r: (typeof rels)[number]) => `${r.char_a_id}|${r.char_b_id}|${r.type}`
  const byKey = new Map<string, typeof rels>()
  for (const r of rels) {
    const arr = byKey.get(keyOf(r)) ?? []
    arr.push(r)
    byKey.set(keyOf(r), arr)
  }

  const duplicates: DuplicateRelGroup[] = []
  const warnings: string[] = []
  let totalRemoved = 0

  for (const [, group] of byKey) {
    if (group.length < 2) continue

    const kept = group.reduce((best, cur) => (cur.description.length > best.description.length ? cur : best))
    const keptId = kept.id
    const removedIds = group.filter((r) => r.id !== keptId).map((r) => r.id)

    if (!dryRun) {
      const maxOriginalLen = Math.max(...group.map((r) => r.description.length))
      if (!force && kept.description.length < maxOriginalLen) {
        warnings.push(
          `关系 ${kept.char_a_id.slice(0, 8)} ↔ ${kept.char_b_id.slice(0, 8)} [${kept.type}] 保留描述 ${kept.description.length} 字 < 最长原始描述 ${maxOriginalLen} 字，疑似信息丢失，已跳过。请检查合并描述或设 force=true 强制执行。`,
        )
        duplicates.push({
          char_a_id: kept.char_a_id,
          char_b_id: kept.char_b_id,
          type: kept.type,
          count: group.length,
          kept_id: keptId,
          removed_ids: removedIds,
          records: group.map((r) => ({ id: r.id, description: r.description })),
        })
        continue
      }

      const otherDescs = group
        .filter((r) => r.id !== keptId && r.description.trim().length > 0)
        .map((r) => r.description.trim())
      if (otherDescs.length > 0 && otherDescs.some((d) => !kept.description.includes(d))) {
        const combined = [kept.description.trim(), ...otherDescs]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join("\n\n---\n\n")
        await db.update(RelationshipTable).set({ description: combined }).where(eq(RelationshipTable.id, keptId)).run()
      }

      await db.delete(RelationshipTable).where(inArray(RelationshipTable.id, removedIds)).run()
    }

    duplicates.push({
      char_a_id: kept.char_a_id,
      char_b_id: kept.char_b_id,
      type: kept.type,
      count: group.length,
      kept_id: keptId,
      removed_ids: removedIds,
      records: group.map((r) => ({ id: r.id, description: r.description })),
    })
    totalRemoved += removedIds.length
  }

  return { duplicates, total_removed: totalRemoved, dry_run: dryRun, warnings }
}

export async function archiveDescription(
  directory: string,
  novelId: string,
  entityType: string,
  entityId: string,
  oldValue: string,
  newValue: string,
  field = "description",
): Promise<void> {
  if (oldValue === newValue) return
  const db = getDb(directory)
  await db
    .insert(DescriptionHistoryTable)
    .values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      entity_type: entityType,
      entity_id: entityId,
      field,
      old_value: oldValue,
      new_value: newValue,
    })
    .run()
}

export async function listDescriptionHistory(
  directory: string,
  entityType: string,
  entityId: string,
): Promise<
  Array<{
    id: string
    field: string
    old_value: string
    new_value: string
    old_len: number
    new_len: number
    created_at: number
  }>
> {
  const db = getDb(directory)
  const rows = await db
    .select()
    .from(DescriptionHistoryTable)
    .where(and(eq(DescriptionHistoryTable.entity_type, entityType), eq(DescriptionHistoryTable.entity_id, entityId)))
    .orderBy(desc(sql`rowid`))
    .all()
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    old_value: r.old_value,
    new_value: r.new_value,
    old_len: r.old_value.length,
    new_len: r.new_value.length,
    created_at: r.created_at,
  }))
}

export async function restoreDescription(
  directory: string,
  historyId: string,
): Promise<{
  entity_type: string
  entity_id: string
  field: string
  restored_value: string
} | null> {
  const db = getDb(directory)
  const [entry] = await db.select().from(DescriptionHistoryTable).where(eq(DescriptionHistoryTable.id, historyId)).all()
  if (!entry) return null

  const oldValue = entry.old_value

  if (entry.entity_type === "character") {
    await db.update(CharacterTable).set({ description: oldValue }).where(eq(CharacterTable.id, entry.entity_id)).run()
  } else if (entry.entity_type === "relationship") {
    await db
      .update(RelationshipTable)
      .set({ description: oldValue })
      .where(eq(RelationshipTable.id, entry.entity_id))
      .run()
  }

  await archiveDescription(
    directory,
    entry.novel_id,
    entry.entity_type,
    entry.entity_id,
    entry.new_value,
    oldValue,
    entry.field,
  )

  return {
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    field: entry.field,
    restored_value: oldValue,
  }
}
