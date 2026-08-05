/**
 * 钩子轮换追踪 — hook-rotation
 *
 * 追踪 4 种钩子类型的使用记录，当连续 4 次以上使用同一类型时发出警告。
 * 帮助 Agent 避免过度使用单一种类的钩子，保持故事节奏变化。
 *
 * 导出：
 * - HOOK_TYPES — 4 种钩子类型常量
 * - trackHook(novelId, hookType) — 记录钩子使用
 * - getHookStats(novelId, recentCount) — 获取最近钩子统计 + 警告
 */

import { eq, desc } from "drizzle-orm"
import { getDb, HookRotationTable } from "./session-store.js"

// ─── 钩子类型常量 ───

/** 4 种钩子类型 */
export const HOOK_TYPES = [
  "foreshadow_plant", // 埋设伏笔
  "face_slap", // 打脸反转
  "power_up", // 能力升级
  "emotional_peak", // 情感高潮
] as const

/** 钩子类型 */
export type HookType = (typeof HOOK_TYPES)[number]

// ─── 类型定义 ───

/** 钩子记录 */
export interface HookRecord {
  hookType: HookType
  chapterId: string | null
  createdAt: number
}

/** 钩子统计结果 */
export interface HookStats {
  /** 最近的钩子记录列表（按时间倒序） */
  hooks: HookRecord[]
  /** 警告消息：连续 4 次以上同一类型时返回警告，否则为 null */
  warning: string | null
}

// ─── 核心函数 ───

/** 钩子类型中文名映射 */
const HOOK_TYPE_NAMES: Record<HookType, string> = {
  foreshadow_plant: "埋设伏笔",
  face_slap: "打脸反转",
  power_up: "能力升级",
  emotional_peak: "情感高潮",
}

/**
 * 记录钩子使用
 * @param novelId 小说 ID
 * @param hookType 钩子类型
 * @param chapterId 可选：关联章节 ID
 */
export async function trackHook(
  novelId: string,
  hookType: HookType,
  chapterId?: string,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)
  const id = crypto.randomUUID()
  await db
    .insert(HookRotationTable)
    .values({
      id,
      novel_id: novelId,
      hook_type: hookType,
      chapter_id: chapterId ?? null,
      created_at: Date.now(),
    })
    .run()
}

/**
 * 获取最近钩子统计
 *
 * 查询最近 recentCount 条钩子记录，检测是否连续 4 次以上使用同一类型。
 * 如果连续同类超过 3 次，返回警告消息。
 *
 * @param novelId 小说 ID
 * @param recentCount 查询最近多少条记录（默认 10）
 * @returns 钩子统计结果，包含记录列表和警告
 */
export async function getHookStats(
  novelId: string,
  recentCount: number = 10,
  directory?: string | null,
): Promise<HookStats> {
  const db = getDb(directory)
  const rows = await db
    .select()
    .from(HookRotationTable)
    .where(eq(HookRotationTable.novel_id, novelId))
    .orderBy(desc(HookRotationTable.created_at))
    .limit(recentCount)
    .all()

  const hooks: HookRecord[] = rows.map((row) => ({
    hookType: row.hook_type as HookType,
    chapterId: row.chapter_id ?? null,
    createdAt: row.created_at,
  }))

  // 检测连续同类：从最近一条开始，统计连续相同类型的次数
  let consecutiveCount = 0
  let consecutiveType: HookType | null = null

  for (const hook of hooks) {
    if (consecutiveType === null) {
      consecutiveType = hook.hookType
      consecutiveCount = 1
    } else if (hook.hookType === consecutiveType) {
      consecutiveCount++
    } else {
      break // 遇到不同类型，停止计数
    }
  }

  // 连续 4 次以上同一类型时发出警告
  const warning =
    consecutiveCount > 3 && consecutiveType
      ? `钩子类型过于单一：已连续使用 ${consecutiveCount} 次"${HOOK_TYPE_NAMES[consecutiveType]}"（${consecutiveType}），建议轮换其他类型以保持节奏变化`
      : null

  return { hooks, warning }
}
