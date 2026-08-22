/**
 * 弧光补建/重建 — 确定性批量落库
 *
 * LLM（architect）负责读已有章节/摘要/设定反推弧光结构，
 * 本模块负责幂等检查、状态推导、章节 ID 回填、批量原子写入。
 *
 * 三种模式：
 * - create_only：增量补建，同标题+类型已存在则跳过该条（旧项目首次补建）
 * - replace_all：删除项目全部弧光与节点后重建（全局重建）
 * - replace_matching：删除匹配条件的弧光与节点后重建（重建主线/某角色弧/某支线）
 *
 * 删除+新建在同一原生 SQL 事务内，任一失败整体回滚。
 */

import { eq, and, sql } from "drizzle-orm"
import {
  getDb,
  StoryArcTable,
  ArcBeatTable,
  CharacterTable,
  ChapterTable,
} from "./session-store.js"

export type BackfillBeatInput = {
  label: string
  kind: string
  summary?: string
  chapter_id?: string | null
  chapter_order?: number | null
  drafted?: boolean
}

export type BackfillArcInput = {
  arc_type: string
  title: string
  summary?: string
  target_character_name?: string | null
  beats: BackfillBeatInput[]
}

export type ReplaceMatch = {
  arc_type?: string
  target_character_name?: string
}

export type BackfillMode = "create_only" | "replace_all" | "replace_matching"

export type BackfillArcReport = {
  id: string
  title: string
  arc_type: string
  status: string
  drafted_beats: number
  planned_beats: number
  actual_start_chapter: number | null
  actual_end_chapter: number | null
  replaced: boolean
}

export type BackfillResult = {
  mode: BackfillMode
  skipped: boolean
  reason?: string
  arcs_created: number
  arcs_skipped: number
  arcs_deleted: number
  beats_created: number
  arcs: BackfillArcReport[]
}

const VALID_ARC_TYPES = new Set(["narrative", "character", "subplot"])
const VALID_BEAT_KINDS = new Set([
  "setup",
  "rising",
  "turn",
  "midpoint",
  "crisis",
  "climax",
  "resolution",
  "note",
])

export async function backfillStoryArcs(
  dbOrDirectory: ReturnType<typeof getDb> | string | null,
  novelId: string,
  arcs: BackfillArcInput[],
  mode: BackfillMode = "create_only",
  replaceMatch?: ReplaceMatch,
): Promise<BackfillResult> {
  const db =
    typeof dbOrDirectory === "string" || dbOrDirectory == null
      ? getDb(dbOrDirectory as never)
      : dbOrDirectory

  // 输入校验
  for (const arc of arcs) {
    if (!VALID_ARC_TYPES.has(arc.arc_type)) {
      throw new Error(`无效的 arc_type: ${arc.arc_type}（应为 narrative/character/subplot）`)
    }
    if (!arc.title?.trim()) throw new Error("弧光标题不能为空")
    if (!arc.beats?.length) throw new Error(`弧光「${arc.title}」至少需要一个节点`)
    for (const beat of arc.beats) {
      if (!beat.label?.trim()) throw new Error("节点标题不能为空")
      if (!VALID_BEAT_KINDS.has(beat.kind)) {
        throw new Error(`无效的节点 kind: ${beat.kind}（节点「${beat.label}」）`)
      }
    }
  }

  if (mode === "replace_matching" && !replaceMatch?.arc_type && !replaceMatch?.target_character_name) {
    throw new Error("replace_matching 模式需要提供 replace_match（arc_type 和/或 target_character_name）")
  }

  // 角色名 -> ID 映射
  const characters = await db
    .select({ id: CharacterTable.id, name: CharacterTable.name })
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .all()
  const nameToId = new Map(characters.map((c) => [c.name, c.id]))

  // 章节序号 -> ID 映射
  const chapters = await db
    .select({ id: ChapterTable.id, order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, novelId))
    .all()
  const orderToChapterId = new Map(chapters.map((c) => [c.order, c.id]))

  // 查现有弧光
  const existingArcs = await db
    .select()
    .from(StoryArcTable)
    .where(eq(StoryArcTable.novel_id, novelId))
    .all()

  const result: BackfillResult = {
    mode,
    skipped: false,
    arcs_created: 0,
    arcs_skipped: 0,
    arcs_deleted: 0,
    beats_created: 0,
    arcs: [],
  }

  // create_only 模式下做去重：同标题+同类型已存在则跳过该条
  const existingKey = new Set(
    existingArcs.map((a) => `${a.arc_type}::${a.title}`),
  )

  // 确定要删除的弧光
  let arcsToDelete: typeof existingArcs = []
  if (mode === "replace_all") {
    arcsToDelete = existingArcs
  } else if (mode === "replace_matching" && replaceMatch) {
    const targetCharId = replaceMatch.target_character_name
      ? (nameToId.get(replaceMatch.target_character_name) ?? null)
      : null
    if (replaceMatch.target_character_name && !targetCharId) {
      throw new Error(`角色「${replaceMatch.target_character_name}」不存在`)
    }
    arcsToDelete = existingArcs.filter((a) => {
      if (replaceMatch.arc_type && a.arc_type !== replaceMatch.arc_type) return false
      if (replaceMatch.target_character_name) {
        if (a.arc_type !== "character") return false
        if (a.target_character_id !== targetCharId) return false
      }
      return true
    })
  }

  const deleteIds = new Set(arcsToDelete.map((a) => a.id))
  result.arcs_deleted = arcsToDelete.length

  // create_only + 已有弧光：如果全部传入弧光都已存在，整体跳过
  if (mode === "create_only" && existingArcs.length > 0) {
    const allDuplicates = arcs.every((a) => existingKey.has(`${a.arc_type}::${a.title}`))
    if (allDuplicates) {
      return {
        ...result,
        skipped: true,
        reason: "所有弧光均已存在，无需补建",
        arcs_skipped: arcs.length,
      }
    }
  }

  // drizzle 的 async transaction 在 bun:sqlite 下不回滚，用原生 SQL BEGIN/COMMIT/ROLLBACK
  await db.run(sql`BEGIN`)
  try {
    // 删除旧弧光及其节点
    if (deleteIds.size > 0) {
      for (const arc of arcsToDelete) {
        await db.delete(ArcBeatTable).where(eq(ArcBeatTable.arc_id, arc.id)).run()
        await db.delete(StoryArcTable).where(eq(StoryArcTable.id, arc.id)).run()
      }
    }

    // 创建新弧光
    for (const arcInput of arcs) {
      // create_only 模式下去重
      if (mode === "create_only" && existingKey.has(`${arcInput.arc_type}::${arcInput.title}`)) {
        result.arcs_skipped++
        continue
      }

      const targetCharacterId = arcInput.target_character_name
        ? (nameToId.get(arcInput.target_character_name) ?? null)
        : null
      if (arcInput.arc_type === "character" && arcInput.target_character_name && !targetCharacterId) {
        throw new Error(
          `角色弧「${arcInput.title}」引用的角色「${arcInput.target_character_name}」不存在`,
        )
      }

      const draftedBeats = arcInput.beats.filter((b) => b.drafted)
      const plannedBeats = arcInput.beats.filter((b) => !b.drafted)
      const draftedOrders = draftedBeats
        .map((b) => b.chapter_order)
        .filter((o): o is number => o != null)
      const allOrders = arcInput.beats
        .map((b) => b.chapter_order)
        .filter((o): o is number => o != null)

      const actualStart = draftedOrders.length > 0 ? Math.min(...draftedOrders) : null
      const resolutionDrafted = draftedBeats.find((b) => b.kind === "resolution")
      const actualEnd = resolutionDrafted?.chapter_order ?? null

      const status =
        resolutionDrafted != null
          ? "completed"
          : draftedBeats.length > 0
            ? "active"
            : "planned"

      const now = Date.now()
      const arcId = crypto.randomUUID()
      await db
        .insert(StoryArcTable)
        .values({
          id: arcId,
          novel_id: novelId,
          arc_type: arcInput.arc_type,
          title: arcInput.title,
          summary: arcInput.summary ?? "",
          status,
          target_character_id: targetCharacterId,
          planned_start_chapter: allOrders.length > 0 ? Math.min(...allOrders) : null,
          planned_end_chapter: allOrders.length > 0 ? Math.max(...allOrders) : null,
          actual_start_chapter: actualStart,
          actual_end_chapter: actualEnd,
          created_at: now,
          updated_at: now,
        })
        .run()
      result.arcs_created++

      for (const beat of arcInput.beats) {
        const chapterId =
          beat.chapter_id ??
          (beat.drafted && beat.chapter_order != null
            ? (orderToChapterId.get(beat.chapter_order) ?? null)
            : null)
        await db
          .insert(ArcBeatTable)
          .values({
            id: crypto.randomUUID(),
            novel_id: novelId,
            arc_id: arcId,
            chapter_id: chapterId,
            chapter_order: beat.chapter_order ?? null,
            label: beat.label,
            kind: beat.kind,
            summary: beat.summary ?? "",
            status: beat.drafted ? "drafted" : "planned",
            created_at: now,
            updated_at: now,
          })
          .run()
        result.beats_created++
      }

      result.arcs.push({
        id: arcId,
        title: arcInput.title,
        arc_type: arcInput.arc_type,
        status,
        drafted_beats: draftedBeats.length,
        planned_beats: plannedBeats.length,
        actual_start_chapter: actualStart,
        actual_end_chapter: actualEnd,
        replaced: deleteIds.size > 0,
      })
    }
    await db.run(sql`COMMIT`)
  } catch (err) {
    await db.run(sql`ROLLBACK`)
    throw err
  }

  return result
}