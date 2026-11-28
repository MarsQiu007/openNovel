/**
 * 清理修订审阅面板纯逻辑（chapter-cleanup-review · tasks 4.4）。
 *
 * 展示层的低风险判定与服务端 accept-batch 过滤保持同一规则
 * （替换/清理类且置信度 ≥ 0.9）；真正放行由服务端权威执行。
 */
import type { CleanupProposal } from "@opennovel-ai/schema/novel"

export const CLEANUP_STATUS_FILTERS = ["all", "pending", "applied", "rejected", "failed", "reverted"] as const
export type CleanupStatusFilter = (typeof CLEANUP_STATUS_FILTERS)[number]

const LOW_RISK_KINDS = new Set(["typo_replace", "format_clean"])
export const LOW_RISK_CONFIDENCE_THRESHOLD = 0.9

export function isLowRiskProposal(kind: string, confidence: number): boolean {
  return LOW_RISK_KINDS.has(kind) && confidence >= LOW_RISK_CONFIDENCE_THRESHOLD
}

export function kindLabelKey(kind: string): string {
  switch (kind) {
    case "typo_replace":
      return "novel.settings.cleanup.kind.typoReplace"
    case "noise_remove":
      return "novel.settings.cleanup.kind.noiseRemove"
    case "duplicate_remove":
      return "novel.settings.cleanup.kind.duplicateRemove"
    case "format_clean":
      return "novel.settings.cleanup.kind.formatClean"
    default:
      return "novel.settings.cleanup.kind.unknown"
  }
}

export function statusLabelKey(status: string): string {
  switch (status) {
    case "pending":
      return "novel.settings.cleanup.status.pending"
    case "applied":
      return "novel.settings.cleanup.status.applied"
    case "rejected":
      return "novel.settings.cleanup.status.rejected"
    case "failed":
      return "novel.settings.cleanup.status.failed"
    case "reverted":
      return "novel.settings.cleanup.status.reverted"
    default:
      return "novel.settings.cleanup.status.unknown"
  }
}

export function statusTagVariant(status: string): "neutral" | "success" | "danger" | "warning" {
  switch (status) {
    case "pending":
      return "neutral"
    case "applied":
      return "success"
    case "rejected":
      return "danger"
    case "failed":
      return "warning"
    default:
      return "neutral"
  }
}

/** 待审列表的可批量勾选资格：仅低风险 pending 可进批量接受选择集。 */
export function isBatchSelectable(proposal: CleanupProposal): boolean {
  return proposal.status === "pending" && isLowRiskProposal(proposal.kind, proposal.confidence)
}

/** 按章节聚合展示（同章提案相邻，章内按锚点位置排序）。 */
export function groupByChapter(items: readonly CleanupProposal[]): Array<{ chapterId: string; items: CleanupProposal[] }> {
  const groups = new Map<string, CleanupProposal[]>()
  for (const item of items) {
    const list = groups.get(item.chapterId) ?? []
    list.push(item)
    groups.set(item.chapterId, list)
  }
  return [...groups.entries()].map(([chapterId, list]) => ({
    chapterId,
    items: [...list].sort((a, b) => a.paragraphIndex - b.paragraphIndex || a.startOffset - b.startOffset),
  }))
}
