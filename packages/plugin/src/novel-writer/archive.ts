/**
 * 归档查询工具 — 查询休眠角色、已关闭线索和历史卷摘要
 *
 * 提供三个查询函数：
 * - lookupDormantCharacters — 查询休眠角色
 * - lookupClosedThreads — 查询已关闭线索
 * - lookupPastVolumes — 查询历史卷摘要
 *
 * 所有查询只返回摘要信息（不返回完整内容），每个查询最多返回3条记录。
 * 遵循 novel-writer.ts 的数据库访问模式（drizzle-orm/bun-sqlite + 本地表定义）。
 */

import { eq, and, like, desc, lt, inArray } from "drizzle-orm"
import {
  getDb,
  CharacterTable,
  CharacterStateTable,
  PlotThreadTable,
  VolumeTable,
  VolumeSummaryTable,
} from "./session-store.js"

// ─── 导出类型 ───

/** 角色摘要 */
export interface CharacterSummary {
  id: string
  /** 角色名 */
  name: string
  /** 状态摘要 */
  summary: string
}

/** 线索摘要 */
export interface ThreadSummary {
  id: string
  /** 线索标题 */
  title: string
  /** 线索描述 */
  summary: string
}

/** 卷摘要 */
export interface VolumeSummary {
  id: string
  /** 卷标题 */
  title: string
  /** 卷摘要 */
  summary: string
}

// ─── 导出函数 ───

/**
 * 查询休眠角色
 *
 * 查找小说中处于休眠状态（active = false）的角色，
 * 最多返回3条记录。只返回摘要信息（id, name, summary）。
 *
 * @param novelId 小说 ID
 * @param query 搜索关键词（匹配角色名）
 * @returns 休眠角色摘要列表
 */
export async function lookupDormantCharacters(
  novelId: string,
  query: string,
  directory?: string | null,
): Promise<CharacterSummary[]> {
  const db = getDb(directory)

  // 查询该小说中所有有休眠状态记录的角色 ID
  const dormantRows = await db
    .select({ character_id: CharacterStateTable.character_id })
    .from(CharacterStateTable)
    .innerJoin(CharacterTable, eq(CharacterStateTable.character_id, CharacterTable.id))
    .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterStateTable.active, 0)))
    .all()

  if (dormantRows.length === 0) return []

  // 去重后的角色 ID 列表
  const uniqueIds = [...new Set(dormantRows.map((r) => r.character_id))]

  // 按角色名模糊匹配
  const characters = await db
    .select()
    .from(CharacterTable)
    .where(
      and(
        eq(CharacterTable.novel_id, novelId),
        inArray(CharacterTable.id, uniqueIds),
        like(CharacterTable.name, `%${query}%`),
      ),
    )
    .limit(3)
    .all()

  if (characters.length === 0) return []

  // 获取每个角色的最新休眠状态摘要
  const results: CharacterSummary[] = []
  for (const char of characters) {
    const [latestState] = await db
      .select()
      .from(CharacterStateTable)
      .where(and(eq(CharacterStateTable.character_id, char.id), eq(CharacterStateTable.active, 0)))
      .orderBy(desc(CharacterStateTable.id))
      .limit(1)
      .all()

    results.push({
      id: char.id,
      name: char.name,
      summary: latestState?.summary ?? char.description,
    })
  }

  return results
}

/**
 * 查询已关闭线索
 *
 * 查找小说中已关闭的剧情线索，最多返回3条记录。
 * 只返回摘要信息（id, title, summary）。
 *
 * @param novelId 小说 ID
 * @param query 搜索关键词（匹配线索标题）
 * @returns 已关闭线索摘要列表
 */
export async function lookupClosedThreads(
  novelId: string,
  query: string,
  directory?: string | null,
): Promise<ThreadSummary[]> {
  const db = getDb(directory)

  const threads = await db
    .select()
    .from(PlotThreadTable)
    .where(
      and(
        eq(PlotThreadTable.novel_id, novelId),
        eq(PlotThreadTable.status, "closed"),
        like(PlotThreadTable.title, `%${query}%`),
      ),
    )
    .limit(3)
    .all()

  return threads.map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.description,
  }))
}

/**
 * 查询历史卷摘要
 *
 * 查找指定卷号之前的历史卷摘要，最多返回3条记录（按卷号降序，最近优先）。
 * 只返回摘要信息（id, title, summary）。
 *
 * @param novelId 小说 ID
 * @param volumeNumber 当前卷号（返回比此卷号小的历史卷）
 * @returns 历史卷摘要列表
 */
export async function lookupPastVolumes(
  novelId: string,
  volumeNumber: number,
  directory?: string | null,
): Promise<VolumeSummary[]> {
  const db = getDb(directory)

  const volumes = await db
    .select()
    .from(VolumeTable)
    .where(and(eq(VolumeTable.novel_id, novelId), lt(VolumeTable.order, volumeNumber)))
    .orderBy(desc(VolumeTable.order))
    .limit(3)
    .all()

  if (volumes.length === 0) return []

  // 获取卷摘要
  const volumeIds = volumes.map((v) => v.id)
  const summaries = await db
    .select()
    .from(VolumeSummaryTable)
    .where(inArray(VolumeSummaryTable.volume_id, volumeIds))
    .all()

  const summaryMap = new Map(summaries.map((s) => [s.volume_id, s.summary]))

  return volumes.map((v) => ({
    id: v.id,
    title: v.title,
    summary: summaryMap.get(v.id) ?? v.summary,
  }))
}
