/**
 * 章节清理修订提案（chapter-cleanup-review）。
 *
 * 导入整理纠错阶段的结构化建议落库为可审批实体：逐条接受确定性事务应用、
 * 低风险批量接受、拒绝留痕、已应用撤销。锚点口径为「段落索引 + 段内偏移」，
 * 段落数组按换行切分——与 diff_chapter_version 的现场切分一致，应用时以
 * quote 全等校验守门，漂移即标 failed，不做模糊匹配。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { countWords } from "@opennovel-ai/schema/schema"
import {
  ChapterCleanupProposalTable,
  ChapterTable,
  ChapterVersionTable,
  getDb,
  type ChapterCleanupProposal,
} from "./index.js"
import { withTransaction, type Tx } from "./tx.js"

export const CLEANUP_KINDS = ["typo_replace", "noise_remove", "duplicate_remove", "format_clean"] as const
export type CleanupKind = (typeof CLEANUP_KINDS)[number]

const REMOVAL_KINDS = new Set<string>(["noise_remove", "duplicate_remove"])
const LOW_RISK_KINDS = new Set<string>(["typo_replace", "format_clean"])

/** 低风险阈值：批量接受仅放行达到该置信度的替换/清理类提案，删除类一律逐条人工审。 */
export const LOW_RISK_CONFIDENCE_THRESHOLD = 0.9

export function isLowRiskCleanup(kind: string, confidence: number): boolean {
  return LOW_RISK_KINDS.has(kind) && confidence >= LOW_RISK_CONFIDENCE_THRESHOLD
}

export type CleanupProposalInput = {
  kind: string
  paragraph_index: number
  start_offset: number
  end_offset: number
  quote: string
  replacement?: string
  reason?: string
  confidence?: number
}

export type CleanupProposalValidationIssue = { index: number; field: string; message: string }

/**
 * 校验一批修订提案输入，返回问题清单（空数组 = 全部合法）。
 * 整批原子：任一条非法即整批拒绝，由提交方修正后重新提交。
 */
export function validateCleanupProposalInputs(proposals: CleanupProposalInput[]): CleanupProposalValidationIssue[] {
  const issues: CleanupProposalValidationIssue[] = []
  proposals.forEach((p, index) => {
    if (!CLEANUP_KINDS.includes(p.kind as CleanupKind)) {
      issues.push({ index, field: "kind", message: `未知修订类型 ${p.kind}` })
      return
    }
    if (!p.quote) {
      issues.push({ index, field: "quote", message: "原文引用为空" })
    }
    if (!Number.isInteger(p.paragraph_index) || p.paragraph_index < 0) {
      issues.push({ index, field: "paragraph_index", message: "段落索引须为非负整数" })
    }
    if (!Number.isInteger(p.start_offset) || !Number.isInteger(p.end_offset) || p.start_offset < 0 || p.end_offset <= p.start_offset) {
      issues.push({ index, field: "offsets", message: "偏移区间须满足 0 <= start < end" })
    }
    const removal = REMOVAL_KINDS.has(p.kind)
    const replacement = p.replacement ?? ""
    if (removal && replacement !== "") {
      issues.push({ index, field: "replacement", message: "删除类提案的建议文本必须为空" })
    }
    if (!removal && replacement === "") {
      issues.push({ index, field: "replacement", message: "替换类提案的建议文本不能为空" })
    }
    const confidence = p.confidence ?? 1
    if (confidence < 0 || confidence > 1) {
      issues.push({ index, field: "confidence", message: "置信度须在 0..1 区间" })
    }
  })
  return issues
}

/**
 * 批量落库待审提案（整批原子）。校验不通过抛错并列出全部问题，不落任何条目。
 */
export function createCleanupProposalsTx(
  tx: Tx,
  input: { novelId: string; chapterId: string; proposals: CleanupProposalInput[]; sourceRunId?: string },
): string[] {
  const issues = validateCleanupProposalInputs(input.proposals)
  if (issues.length > 0) {
    const detail = issues.map((i) => `#${i.index} ${i.field}: ${i.message}`).join("; ")
    throw new Error(`修订提案校验失败（未落库任何条目）：${detail}`)
  }
  const now = Date.now()
  return input.proposals.map((p) => {
    const id = crypto.randomUUID()
    tx.insert(ChapterCleanupProposalTable)
      .values({
        id,
        novel_id: input.novelId,
        chapter_id: input.chapterId,
        kind: p.kind,
        paragraph_index: p.paragraph_index,
        start_offset: p.start_offset,
        end_offset: p.end_offset,
        quote: p.quote,
        replacement: p.replacement ?? "",
        reason: p.reason ?? "",
        confidence: p.confidence ?? 1,
        status: "pending",
        source_run_id: input.sourceRunId ?? null,
        created_at: now,
        updated_at: now,
      })
      .run()
    return id
  })
}

export function createCleanupProposals(
  input: { novelId: string; chapterId: string; proposals: CleanupProposalInput[]; sourceRunId?: string },
  directory?: string | null,
): string[] {
  return withTransaction(getDb(directory), (tx) => createCleanupProposalsTx(tx, input))
}

export function listCleanupProposals(
  novelId: string,
  opts: { status?: string; chapterId?: string } = {},
  directory?: string | null,
): ChapterCleanupProposal[] {
  const conditions = [eq(ChapterCleanupProposalTable.novel_id, novelId)]
  if (opts.status) conditions.push(eq(ChapterCleanupProposalTable.status, opts.status))
  if (opts.chapterId) conditions.push(eq(ChapterCleanupProposalTable.chapter_id, opts.chapterId))
  return getDb(directory)
    .select()
    .from(ChapterCleanupProposalTable)
    .where(and(...conditions))
    .orderBy(desc(ChapterCleanupProposalTable.created_at))
    .all()
}

export function countCleanupProposals(novelId: string, directory?: string | null): Record<string, number> {
  const rows = getDb(directory)
    .select({ status: ChapterCleanupProposalTable.status, n: sql<number>`count(*)` })
    .from(ChapterCleanupProposalTable)
    .where(eq(ChapterCleanupProposalTable.novel_id, novelId))
    .groupBy(ChapterCleanupProposalTable.status)
    .all()
  return Object.fromEntries(rows.map((r) => [r.status, r.n]))
}

/** 应用结果：applied 成功集、failed 锚点校验失败集。 */
export type CleanupApplyResult = { applied: string[]; failed: Array<{ id: string; reason: string }> }

function nextChapterVersion(tx: Tx, chapterId: string): number {
  const last = tx
    .select({ version: ChapterVersionTable.version })
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.chapter_id, chapterId))
    .orderBy(desc(ChapterVersionTable.version))
    .limit(1)
    .get()
  return (last?.version ?? 0) + 1
}

/**
 * 应用一批待审提案（组合形态）。按章分组，同章内按锚点位置倒序机械替换/删除，
 * 应用前写全文快照、应用后追加新版本行；quote 不匹配的提案标 failed 不阻断其余。
 */
export function applyCleanupProposalsTx(tx: Tx, proposalIds: string[]): CleanupApplyResult {
  const result: CleanupApplyResult = { applied: [], failed: [] }
  const pendingIds = proposalIds.length === 0 ? [] : proposalIds
  const rows = pendingIds.length
    ? tx
        .select()
        .from(ChapterCleanupProposalTable)
        .where(inArray(ChapterCleanupProposalTable.id, pendingIds))
        .all()
    : []
  const pending = rows.filter((r) => r.status === "pending")
  const byChapter = new Map<string, ChapterCleanupProposal[]>()
  for (const row of pending) {
    const list = byChapter.get(row.chapter_id) ?? []
    list.push(row)
    byChapter.set(row.chapter_id, list)
  }
  const now = Date.now()
  for (const [chapterId, proposals] of byChapter) {
    const chapterAppliedIds: string[] = []
    const chapter = tx.select().from(ChapterTable).where(eq(ChapterTable.id, chapterId)).get()
    if (!chapter) {
      for (const p of proposals) result.failed.push({ id: p.id, reason: "章节不存在" })
      continue
    }
    const paragraphs = chapter.content.split("\n")
    const ordered = [...proposals].sort(
      (a, b) => b.paragraph_index - a.paragraph_index || b.start_offset - a.start_offset,
    )
    const fromVersion = nextChapterVersion(tx, chapterId)
    let fromVersionId: string | null = null
    if (chapter.content) {
      fromVersionId = crypto.randomUUID()
      tx.insert(ChapterVersionTable)
        .values({
          id: fromVersionId,
          chapter_id: chapterId,
          version: fromVersion,
          content: chapter.content,
          word_count: chapter.word_count,
          created_at: now,
          created_by: "cleanup-apply",
        })
        .run()
    }
    for (const p of ordered) {
      const paragraph = paragraphs[p.paragraph_index]
      if (paragraph === undefined) {
        markFailed(tx, p.id, "锚点越界：段落不存在", now)
        result.failed.push({ id: p.id, reason: "锚点越界：段落不存在" })
        continue
      }
      if (paragraph.slice(p.start_offset, p.end_offset) !== p.quote) {
        markFailed(tx, p.id, "锚点漂移：当前文本与引用不一致", now)
        result.failed.push({ id: p.id, reason: "锚点漂移：当前文本与引用不一致" })
        continue
      }
      if (REMOVAL_KINDS.has(p.kind)) {
        paragraphs.splice(p.paragraph_index, 1)
      } else {
        paragraphs[p.paragraph_index] = paragraph.slice(0, p.start_offset) + p.replacement + paragraph.slice(p.end_offset)
      }
      tx.update(ChapterCleanupProposalTable)
        .set({ status: "applied", applied_from_version_id: fromVersionId, updated_at: now })
        .where(eq(ChapterCleanupProposalTable.id, p.id))
        .run()
      result.applied.push(p.id)
      chapterAppliedIds.push(p.id)
    }
    if (chapterAppliedIds.length > 0) {
      const content = paragraphs.join("\n")
      const wordCount = countWords(content)
      const toVersionId = crypto.randomUUID()
      tx.insert(ChapterVersionTable)
        .values({
          id: toVersionId,
          chapter_id: chapterId,
          version: fromVersion + 1,
          content,
          word_count: wordCount,
          created_at: now,
          created_by: "cleanup-apply",
        })
        .run()
      tx.update(ChapterTable)
        .set({ content, word_count: wordCount, updated_at: now })
        .where(eq(ChapterTable.id, chapterId))
        .run()
      tx.update(ChapterCleanupProposalTable)
        .set({ applied_to_version_id: toVersionId, updated_at: now })
        .where(inArray(ChapterCleanupProposalTable.id, chapterAppliedIds))
        .run()
    }
  }
  return result
}

function markFailed(tx: Tx, id: string, reason: string, now: number): void {
  tx.update(ChapterCleanupProposalTable)
    .set({ status: "failed", fail_reason: reason, updated_at: now })
    .where(eq(ChapterCleanupProposalTable.id, id))
    .run()
}

/** 应用一批待审提案（自包形态）。 */
export function applyCleanupProposals(proposalIds: string[], directory?: string | null): CleanupApplyResult {
  return withTransaction(getDb(directory), (tx) => applyCleanupProposalsTx(tx, proposalIds))
}

/** 拒绝待审提案（组合形态）：pending → rejected，留痕不删除。 */
export function rejectCleanupProposalTx(tx: Tx, proposalId: string): void {
  const proposal = tx.select().from(ChapterCleanupProposalTable).where(eq(ChapterCleanupProposalTable.id, proposalId)).get()
  if (!proposal || proposal.status !== "pending") throw new Error(`提案 ${proposalId} 不存在或不是待审状态`)
  tx.update(ChapterCleanupProposalTable)
    .set({ status: "rejected", updated_at: Date.now() })
    .where(eq(ChapterCleanupProposalTable.id, proposalId))
    .run()
}

export function rejectCleanupProposal(proposalId: string, directory?: string | null): void {
  withTransaction(getDb(directory), (tx) => rejectCleanupProposalTx(tx, proposalId))
}

/**
 * 撤销已应用提案（组合形态）：恢复应用前快照内容并追加 revert 版本行，
 * 提案标 reverted（终态）。撤销会覆盖其后的人工编辑——由界面警示兜底。
 */
export function revertCleanupProposalTx(tx: Tx, proposalId: string): void {
  const proposal = tx.select().from(ChapterCleanupProposalTable).where(eq(ChapterCleanupProposalTable.id, proposalId)).get()
  if (!proposal || proposal.status !== "applied") throw new Error(`提案 ${proposalId} 不存在或不是已应用状态`)
  if (!proposal.applied_from_version_id) throw new Error(`提案 ${proposalId} 缺少应用前快照，无法撤销`)
  const fromVersion = tx
    .select()
    .from(ChapterVersionTable)
    .where(eq(ChapterVersionTable.id, proposal.applied_from_version_id))
    .get()
  if (!fromVersion) throw new Error(`提案 ${proposalId} 的应用前快照版本已缺失`)
  const chapter = tx.select().from(ChapterTable).where(eq(ChapterTable.id, proposal.chapter_id)).get()
  if (!chapter) throw new Error(`章节 ${proposal.chapter_id} 不存在`)
  const now = Date.now()
  const revertVersionId = crypto.randomUUID()
  tx.insert(ChapterVersionTable)
    .values({
      id: revertVersionId,
      chapter_id: proposal.chapter_id,
      version: nextChapterVersion(tx, proposal.chapter_id),
      content: fromVersion.content,
      word_count: fromVersion.word_count,
      created_at: now,
      created_by: "cleanup-revert",
    })
    .run()
  tx.update(ChapterTable)
    .set({ content: fromVersion.content, word_count: fromVersion.word_count, updated_at: now })
    .where(eq(ChapterTable.id, proposal.chapter_id))
    .run()
  tx.update(ChapterCleanupProposalTable)
    .set({ status: "reverted", updated_at: now })
    .where(eq(ChapterCleanupProposalTable.id, proposalId))
    .run()
}

export function revertCleanupProposal(proposalId: string, directory?: string | null): void {
  withTransaction(getDb(directory), (tx) => revertCleanupProposalTx(tx, proposalId))
}
