/**
 * 弧光进度同步 — 章节提交后确定性更新弧光节点状态
 *
 * 在 observer delta 提交成功后调用：
 * - 把锚定到本章（chapter_order 匹配）的 planned 节点标记为 drafted，并回填 chapter_id
 * - 首次有节点落地的弧光：actual_start_chapter 设为本章，status 从 planned 提升为 active
 * - 含有 resolution 节点落地的弧光：actual_end_chapter 设为该节点章节，status 设为 completed
 *
 * 幂等：重复调用同一章不会重复推进（已 drafted 的节点跳过）。
 */

import { eq, and, or } from "drizzle-orm"
import { getDb, ArcBeatTable, StoryArcTable, ChapterTable } from "./session-store.js"

export type ArcProgressReport = {
  beatsDrafted: number
  arcsStarted: string[]
  arcsCompleted: string[]
}

export async function syncArcProgress(
  dbOrDirectory: ReturnType<typeof getDb> | string | null,
  novelId: string,
  chapterId: string,
): Promise<ArcProgressReport> {
  const db =
    typeof dbOrDirectory === "string" || dbOrDirectory == null
      ? getDb(dbOrDirectory as never)
      : dbOrDirectory

  const [chapter] = await db
    .select({ order: ChapterTable.order })
    .from(ChapterTable)
    .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.id, chapterId)))
    .limit(1)
    .all()
  if (!chapter) return { beatsDrafted: 0, arcsStarted: [], arcsCompleted: [] }

  const now = Date.now()

  // 回填：observer 可能用 chapter_id 锚定了节点但没填 chapter_order
  await db
    .update(ArcBeatTable)
    .set({ chapter_order: chapter.order, updated_at: now })
    .where(
      and(
        eq(ArcBeatTable.novel_id, novelId),
        eq(ArcBeatTable.chapter_id, chapterId),
        eq(ArcBeatTable.status, "planned"),
      ),
    )
    .run()

  // 找到锚定到本章（按 chapter_order 或 chapter_id）且尚未落地的节点
  const pendingBeats = await db
    .select()
    .from(ArcBeatTable)
    .where(
      and(
        eq(ArcBeatTable.novel_id, novelId),
        eq(ArcBeatTable.status, "planned"),
        or(eq(ArcBeatTable.chapter_order, chapter.order), eq(ArcBeatTable.chapter_id, chapterId)),
      ),
    )
    .all()

  if (pendingBeats.length === 0) return { beatsDrafted: 0, arcsStarted: [], arcsCompleted: [] }

  await db
    .update(ArcBeatTable)
    .set({ status: "drafted", chapter_id: chapterId, chapter_order: chapter.order, updated_at: now })
    .where(
      and(
        eq(ArcBeatTable.novel_id, novelId),
        eq(ArcBeatTable.status, "planned"),
        or(eq(ArcBeatTable.chapter_order, chapter.order), eq(ArcBeatTable.chapter_id, chapterId)),
      ),
    )
    .run()

  const affectedArcIds = [...new Set(pendingBeats.map((b) => b.arc_id))]
  const arcsStarted: string[] = []
  const arcsCompleted: string[] = []

  for (const arcId of affectedArcIds) {
    const [arc] = await db
      .select()
      .from(StoryArcTable)
      .where(eq(StoryArcTable.id, arcId))
      .limit(1)
      .all()
    if (!arc) continue

    const draftedBeats = await db
      .select()
      .from(ArcBeatTable)
      .where(and(eq(ArcBeatTable.arc_id, arcId), eq(ArcBeatTable.status, "drafted")))
      .all()

    const resolutionBeat = draftedBeats.find((b) => b.kind === "resolution")
    const firstBeatOrder = Math.min(...draftedBeats.map((b) => b.chapter_order ?? chapter.order))

    const patch: Record<string, unknown> = { updated_at: now }
    if (arc.actual_start_chapter == null) {
      patch.actual_start_chapter = firstBeatOrder
      arcsStarted.push(arc.title)
    }
    if (arc.status === "planned") patch.status = "active"

    if (resolutionBeat) {
      patch.actual_end_chapter = resolutionBeat.chapter_order ?? chapter.order
      patch.status = "completed"
      arcsCompleted.push(arc.title)
    }

    await db.update(StoryArcTable).set(patch as never).where(eq(StoryArcTable.id, arcId)).run()
  }

  return { beatsDrafted: pendingBeats.length, arcsStarted, arcsCompleted }
}
