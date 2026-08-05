import { useSync } from "@/context/sync"
import { createMemo } from "solid-js"

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
 * Check if any session in the current directory is currently running.
 *
 * Uses the `useSync` context to check if any session in the directory
 * is active (session_working returns true). Directory-scoped, not
 * novel-scoped — there is no reverse novel→session lookup endpoint yet.
 */
export function useNovelActivity() {
  const sync = useSync()

  return createMemo(() => {
    const ctx = sync()
    const sessions = ctx.data.session
    if (!sessions || sessions.length === 0) return false
    return sessions.some((s) => ctx.data.session_working(s.id))
  })
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
