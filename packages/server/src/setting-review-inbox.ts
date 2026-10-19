import { Context } from "effect"
import type {
  ReviewInboxBatchInput,
  ReviewInboxBatchResult,
  ReviewInboxCandidateAcceptInput,
  ReviewInboxCandidateMergeInput,
  ReviewInboxCandidateOperationResult,
  ReviewInboxConflictResolveInput,
  ReviewInboxConflictResolveResult,
  ReviewInboxCounts,
  ReviewInboxListResult,
  ReviewInboxStagedAcceptInput,
  ReviewInboxStagedResolveResult,
} from "@opennovel-ai/schema/novel"

export type ReviewInboxListQuery = {
  source?: "candidate" | "conflict" | "staged"
  limit?: number
  offset?: number
}

/**
 * 收件箱审阅服务（setting-review-hub）：候选 / 冲突 / 暂存变更的统一读取层聚合
 * 与审阅操作；操作语义复用 plugin 共享服务，UI 与 agent 工具同源。
 */
export interface SettingReviewInboxService {
  list(novelID: string, directory: string, query: ReviewInboxListQuery): Promise<ReviewInboxListResult>
  counts(novelID: string, directory: string): Promise<ReviewInboxCounts>
  acceptCandidate(novelID: string, directory: string, candidateID: string, input: ReviewInboxCandidateAcceptInput): Promise<ReviewInboxCandidateOperationResult>
  rejectCandidate(novelID: string, directory: string, candidateID: string): Promise<ReviewInboxCandidateOperationResult>
  mergeCandidates(novelID: string, directory: string, input: ReviewInboxCandidateMergeInput): Promise<ReviewInboxCandidateOperationResult>
  resolveConflict(novelID: string, directory: string, conflictID: string, input: ReviewInboxConflictResolveInput): Promise<ReviewInboxConflictResolveResult>
  acceptStaged(novelID: string, directory: string, stagedID: string, input: ReviewInboxStagedAcceptInput): Promise<ReviewInboxStagedResolveResult>
  rejectStaged(novelID: string, directory: string, stagedID: string): Promise<ReviewInboxStagedResolveResult>
  batch(novelID: string, directory: string, input: ReviewInboxBatchInput): Promise<ReviewInboxBatchResult>
}

export class SettingReviewInbox extends Context.Service<SettingReviewInbox, SettingReviewInboxService>()(
  "@opennovel/server/SettingReviewInbox",
) {}
