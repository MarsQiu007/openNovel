/**
 * 张力曲线图 — 记录和分析章节张力变化
 *
 * 功能：
 *  - recordTension：记录单章张力值（0-10）
 *  - getTensionGraph：获取最近 20 章的张力数据
 *  - analyzeTensionRatio：分析动作-平静比是否达到 3:1 目标
 *
 * 张力等级分类：
 *  - 0-3：平静（calm）
 *  - 4-6：中等（moderate）
 *  - 7-10：高张力（action）
 */
import { eq, desc, and, lte, gte } from "drizzle-orm"
import { getDb, TensionLogTable } from "./session-store.js"

// ─── 导出类型 ───

/** 单章张力记录 */
export interface TensionEntry {
  chapterNumber: number
  level: number
}

/** 张力图数据 */
export interface TensionGraph {
  /** 张力值列表（按章节号升序） */
  levels: number[]
  /** 动作-平静比（action:calm） */
  ratio: number
  /** 警告信息，null 表示比例正常 */
  warning: string | null
}

// ─── 导出函数 ───

/**
 * 记录单章张力值
 *
 * 同一章节多次记录会覆盖（先删后插）
 *
 * @param novelId 小说 ID
 * @param chapterNumber 章节序号
 * @param level 张力值（0-10）
 */
export async function recordTension(
  novelId: string,
  chapterNumber: number,
  level: number,
  directory?: string | null,
): Promise<void> {
  const db = getDb(directory)

  // 验证张力值范围
  const clampedLevel = Math.max(0, Math.min(10, level))

  // 先删除该章节已有记录，再插入新记录（幂等覆盖）
  await db
    .delete(TensionLogTable)
    .where(and(eq(TensionLogTable.novel_id, novelId), eq(TensionLogTable.chapter_number, chapterNumber)))
    .run()

  const id = crypto.randomUUID()
  await db
    .insert(TensionLogTable)
    .values({
      id,
      novel_id: novelId,
      chapter_number: chapterNumber,
      level: clampedLevel,
    })
    .run()
}

/**
 * 获取张力曲线图
 *
 * 返回当前章节往前 20 章的张力数据（滑动窗口）
 *
 * @param novelId 小说 ID
 * @param currentChapter 当前章节序号
 * @returns 张力图数据，包含 levels、ratio、warning
 */
export async function getTensionGraph(
  novelId: string,
  currentChapter: number,
  directory?: string | null,
): Promise<TensionGraph> {
  const db = getDb(directory)

  // 滑动窗口：[currentChapter - 19, currentChapter]
  const windowStart = Math.max(1, currentChapter - 19)

  const rows = await db
    .select()
    .from(TensionLogTable)
    .where(
      and(
        eq(TensionLogTable.novel_id, novelId),
        gte(TensionLogTable.chapter_number, windowStart),
        lte(TensionLogTable.chapter_number, currentChapter),
      ),
    )
    .orderBy(TensionLogTable.chapter_number)
    .all()

  const levels = rows.map((r) => r.level)

  return analyzeTensionRatio(levels)
}

/**
 * 分析张力比例
 *
 * 检查动作（7-10）与平静（0-3）章节的比例是否达到 3:1 目标。
 * 偏离超过 50% 时触发警告。
 *
 * @param levels 张力值列表
 * @returns 包含 levels、ratio、warning 的张力图数据
 */
export function analyzeTensionRatio(levels: number[]): TensionGraph {
  // 分类统计
  let actionCount = 0 // 7-10：高张力
  let calmCount = 0 // 0-3：平静

  for (const level of levels) {
    if (level >= 7) {
      actionCount++
    } else if (level <= 3) {
      calmCount++
    }
    // 4-6 中等不计入比例计算
  }

  // 计算比例
  let ratio = 0
  if (calmCount > 0) {
    ratio = actionCount / calmCount
  } else if (actionCount > 0) {
    // 全是动作章节，无平静章节
    ratio = Infinity
  }

  // 目标比例：3:1（action:calm）
  const targetRatio = 3

  // 判断是否偏离超过 50%
  let warning: string | null = null

  if (levels.length === 0) {
    warning = "暂无张力数据，无法判断比例"
  } else if (calmCount === 0 && actionCount > 0) {
    warning = `动作章节过多（${actionCount} 动作 / 0 平静），建议增加平静章节以平衡节奏`
  } else if (actionCount === 0 && calmCount > 0) {
    warning = `平静章节过多（0 动作 / ${calmCount} 平静），建议增加高张力章节以提升节奏`
  } else if (calmCount > 0) {
    const deviation = Math.abs(ratio - targetRatio) / targetRatio
    if (deviation > 0.5) {
      const direction = ratio > targetRatio ? "动作偏多" : "平静偏多"
      warning =
        `${direction}：当前比例 ${ratio.toFixed(1)}:1（动作:平静），` +
        `目标 ${targetRatio}:1，偏差 ${(deviation * 100).toFixed(0)}%`
    }
  }

  return { levels, ratio, warning }
}
