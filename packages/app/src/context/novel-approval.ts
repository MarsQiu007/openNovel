import { useSync } from "@/context/sync"
import { createMemo, type Accessor } from "solid-js"

// ─── Types ───

type ApprovalState = "none" | "pending" | "settled" | "unknown"

type ChapterLike = {
  readonly status: string
}

// ─── Status-to-approval mapping ───

/**
 * Map a chapter status to its approval state.
 *
 * - "planned" | "draft" | "outline" | "failed" -> "none"  (no content awaiting review)
 * - "drafting" | "audited" | "revised" | "pending_review" -> "pending"  (awaiting approval)
 * - "final" | "rejected" | "published" -> "settled"    (review concluded)
 * - any other status -> "unknown"        (defensive)
 *
 * Status values come from the plugin pipeline: requestApproval writes
 * "pending_review", new chapters default to "draft" — both must be covered.
 */
export function useChapterApprovalState(chapter: ChapterLike): ApprovalState {
  switch (chapter.status) {
    case "planned":
    case "draft":
    case "outline":
    case "failed":
      return "none"
    case "drafting":
    case "audited":
    case "revised":
    case "pending_review":
      return "pending"
    case "final":
    case "rejected":
    case "published":
      return "settled"
    default:
      return "unknown"
  }
}

// ─── Novel activity ───

/**
 * 判断任一绑定会话是否正在运行。
 *
 * 书籍活动必须是“绑定会话 × 运行状态”的交集；目录内其他书的会话不应污染当前书。
 */
export function isAnySessionWorking(
  sessionIDs: readonly string[],
  isWorking: (sessionID: string) => boolean,
) {
  return sessionIDs.some((sessionID) => isWorking(sessionID))
}

/**
 * Check whether any session bound to the current novel is running.
 *
 * Uses the `useSync` context for live status and expects the caller to pass
 * IDs from the novel-scoped session binding query.
 */
export function useNovelActivity(sessionIDs: Accessor<readonly string[]>) {
  const sync = useSync()

  return createMemo(() => isAnySessionWorking(sessionIDs(), (sessionID) => sync().data.session_working(sessionID)))
}

// ─── Pending approval count ───

/**
 * Count how many chapters in the given array have a pending approval state.
 *
 * Returns the count for use in badges/indicators.
 */
export function usePendingApprovalCount(chapters: ReadonlyArray<ChapterLike>): number {
  return chapters.filter((ch) => {
    const state = useChapterApprovalState(ch)
    return state === "pending"
  }).length
}
