/**
 * 章节段摘要模块 — 工程层的记忆压缩（与叙事分卷解耦）
 *
 * 每 SEGMENT_WINDOW 章确定性拼接为一段段摘要，触发条件是摘要积压量（章节数），
 * 不依赖"是否分卷"的叙事决策。段摘要承载"中景记忆"：最近章节摘要只覆盖近 3 章，
 * 更早的内容由段摘要常驻承载，细节仍可通过 recall_history 按需深挖。
 *
 * 与卷摘要（rollup.ts）的关系：卷摘要是叙事产物（卷末复盘/历史卷查询），由剧情驱动；
 * 段摘要是上下文预算产物，纯确定性拼接（无 LLM 调用），两者独立并行。
 *
 * 遵循 novel-writer.ts 的数据库访问模式（drizzle-orm/bun-sqlite + novel-store 表定义）。
 */

import { eq, and, gte, lte, asc, inArray } from "drizzle-orm"
import { getDb, ChapterTable, ChapterSummaryTable, SegmentSummaryTable } from "./session-store.js"

/** 段摘要窗口：每 20 章压缩为一段 */
export const SEGMENT_WINDOW = 20

export interface SegmentSummaryItem {
  startChapter: number
  endChapter: number
  summary: string
}

type Db = ReturnType<typeof getDb>

/**
 * 确保 uptoChapter 之前所有已关闭的段都有段摘要记录（惰性、幂等）。
 *
 * 段 [k*W+1, (k+1)*W] 在 uptoChapter > 段末章时视为已关闭——进行中的段不压缩，
 * 因为近期章节由"最近3章摘要"直接承载。
 *
 * @returns 新生成的段摘要数量
 */
export async function ensureSegmentSummaries(db: Db, novelId: string, uptoChapter: number): Promise<number> {
  const closedSegmentEnd = Math.floor((uptoChapter - 1) / SEGMENT_WINDOW) * SEGMENT_WINDOW
  if (closedSegmentEnd < SEGMENT_WINDOW) return 0

  const existingRows = await db
    .select({ id: SegmentSummaryTable.id, start_chapter: SegmentSummaryTable.start_chapter, summary: SegmentSummaryTable.summary })
    .from(SegmentSummaryTable)
    .where(eq(SegmentSummaryTable.novel_id, novelId))
    .all()
  const existingById = new Map(existingRows.map((r) => [r.start_chapter, r]))

  // 新生成或刷新的段数
  let created = 0
  for (let start = 1; start + SEGMENT_WINDOW - 1 <= closedSegmentEnd; start += SEGMENT_WINDOW) {
    const end = start + SEGMENT_WINDOW - 1
    const chapters = await db
      .select()
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, novelId), gte(ChapterTable.order, start), lte(ChapterTable.order, end)))
      .orderBy(asc(ChapterTable.order))
      .all()
    if (chapters.length === 0) continue

    const summaries = await db
      .select()
      .from(ChapterSummaryTable)
      .where(inArray(ChapterSummaryTable.chapter_id, chapters.map((c) => c.id)))
      .all()
    const summaryMap = new Map(summaries.map((s) => [s.chapter_id, s]))
    const summary = buildSegmentSummary(start, end, chapters, summaryMap)

    const prev = existingById.get(start)
    if (prev) {
      // 已有段：仅当之前含“暂无摘要”占位、而当前缺失数减少时刷新，避免摘要落库晚于段关闭导致永久占位
      const prevMissing = (prev.summary.match(PLACEHOLDER_RE) || []).length
      if (prevMissing === 0) continue
      const nowMissing = (summary.match(PLACEHOLDER_RE) || []).length
      if (nowMissing >= prevMissing) continue
      await db.update(SegmentSummaryTable).set({ summary }).where(eq(SegmentSummaryTable.id, prev.id)).run()
      created++
      continue
    }

    await db
      .insert(SegmentSummaryTable)
      .values({
        id: crypto.randomUUID(),
        novel_id: novelId,
        start_chapter: start,
        end_chapter: end,
        summary,
        created_at: Date.now(),
      })
      .run()
    created++
  }
  return created
}

/** 读取小说的全部段摘要（按段起始章升序） */
export async function listSegmentSummaries(db: Db, novelId: string): Promise<SegmentSummaryItem[]> {
  const rows = await db
    .select()
    .from(SegmentSummaryTable)
    .where(eq(SegmentSummaryTable.novel_id, novelId))
    .orderBy(asc(SegmentSummaryTable.start_chapter))
    .all()
  return rows.map((r) => ({ startChapter: r.start_chapter, endChapter: r.end_chapter, summary: r.summary }))
}

// ─── 内部辅助函数 ───

/** 确定性拼接段摘要文本（与 buildVolumeSummary 的"主要事件"口径一致，无 LLM 调用） */
function buildSegmentSummary(
  start: number,
  end: number,
  chapters: { id: string; order: number; title: string }[],
  summaryMap: Map<string, { summary: string; key_events: unknown }>,
): string {
  const lines: string[] = [`第${start}-${end}章 段摘要`]
  for (const ch of chapters) {
    const cs = summaryMap.get(ch.id)
    lines.push(`- 第${ch.order}章《${ch.title}》：${cs?.summary || "（暂无摘要）"}`)
    const keyEvents = cs && Array.isArray(cs.key_events) ? (cs.key_events as string[]) : []
    for (const event of keyEvents) {
      lines.push(`  - ${event}`)
    }
  }
  return lines.join("\n")
}

/** 段摘要中“本章暂无摘要”占位的匹配正则，用于检测可刷新的占位段 */
const PLACEHOLDER_RE = /（暂无摘要）/g
