/**
 * 原文驱动导入（source-driven-import）数据层。
 *
 * 职责：不可变原文与稳定段落索引、结构化章节草稿校验与确定性正文构造、
 * 单章幂等事务提交、校准/计划/报告查询。原文只随书籍删除级联清理，
 * 处理进度由「游标（首个尚未读取段落）+ carry（已读留给下一章）」表达。
 */
import { createHash } from "crypto"
import { eq, and, asc } from "drizzle-orm"
import {
  getDb,
  withTransaction,
  NovelImportJobTable,
  NovelImportParagraphTable,
  NovelImportChapterTable,
  NovelImportOperationTable,
  ChapterTable,
  VolumeTable,
  createChapterTx,
  createVolumeTx,
  type Tx,
} from "./index.js"
import type { Db } from "./index.js"

// ─── 类型 ───

export type ImportJobStatus =
  | "awaiting_queue"
  | "calibrating"
  | "planned"
  | "paused"
  | "blocked"
  | "failed"
  | "completed"

export type ImportJobPhase = "calibration" | "planned" | "finalizing" | "done"

export interface SourceParagraph {
  index: number
  startOffset: number
  endOffset: number
  text: string
}

/** 有序操作：顺序即输出段落顺序；乱序由操作顺序表达并在账本中合成 move 记录。 */
export type ImportOp =
  | { kind: "keep"; source: number; reason?: string }
  | { kind: "merge"; source: number[]; separator: string; reason?: string }
  | { kind: "split"; source: number; anchors: string[]; reason?: string }
  | { kind: "replace"; source: number; original: string; replacement: string; category: string; reason: string }
  | { kind: "exclude"; source: number; category: string; reason: string }

export interface ChapterDraft {
  title: string
  volumeTitle: string | null
  chapterOrder: number
  ops: ImportOp[]
  /** 已读但留给下一章的段落索引 */
  carry: number[]
  /** 本次 read 覆盖的窗口大小（从游标起的新段落数，不含 carry） */
  windowSize: number
}

export type DraftValidation =
  | { ok: true }
  | { ok: false; code: string; message: string }

export interface CommitSignal {
  calibrationReached: boolean
  sourceExhausted: boolean
  remainingParagraphs: number
}

export interface ImportJobRow {
  id: string
  novel_id: string
  session_id: string | null
  filename: string
  encoding: string
  source_hash: string
  raw_text: string
  total_chars: number
  status: ImportJobStatus
  phase: ImportJobPhase
  next_paragraph_index: number
  processed_chars: number
  carry_json: string
  planned_count: number | null
  plan_version: number
  options_json: string
  stats_json: string
  error: string | null
  created_at: number
  updated_at: number
}

const CALIBRATION_RATIO = 0.25
const CALIBRATION_MIN_CHAPTERS = 3

// ─── 纯函数：段落索引 ───

/**
 * 为解码原文建立稳定段落索引：每个非空原始行即一个可索引段落，
 * 不预先按空行或标点合并。偏移为 UTF-16 code unit，与 JS 切片一致。
 */
export function indexSourceParagraphs(rawText: string): Array<{ index: number; startOffset: number; endOffset: number }> {
  const paragraphs: Array<{ index: number; startOffset: number; endOffset: number }> = []
  const run = /[^\r\n]+/g
  let match: RegExpExecArray | null
  let index = 0
  while ((match = run.exec(rawText)) !== null) {
    if (match[0].trim().length > 0) {
      paragraphs.push({ index: index++, startOffset: match.index, endOffset: match.index + match[0].length })
    }
  }
  return paragraphs
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

// ─── 纯函数：草稿校验 ───

/**
 * 校验候选章节草稿对本次 read 窗口的覆盖与操作合法性。
 * windowParagraphs：窗口内全部段落索引（carry + 游标起 windowSize 段）。
 * repairEnabled=false 时仅允许 keep（关闭正文修复，仍允许分章与 carry）。
 */
export function validateChapterDraft(
  draft: ChapterDraft,
  windowParagraphs: number[],
  paragraphText: (index: number) => string,
  repairEnabled: boolean,
): DraftValidation {
  const window = new Set(windowParagraphs)
  const assigned = new Set<number>()
  const contentSources: number[] = []

  for (const [opIndex, op] of draft.ops.entries()) {
    const sources = op.kind === "merge" ? op.source : [op.source]
    for (const s of sources) {
      if (!window.has(s)) return { ok: false, code: "source-out-of-window", message: `段落 ${s} 不在本次阅读窗口内（禁止跨窗口移动或引用已消费段落）` }
      if (assigned.has(s)) return { ok: false, code: "source-reused", message: `段落 ${s} 被重复分配` }
      assigned.add(s)
      if (op.kind !== "exclude") contentSources.push(s)
    }
    if (op.kind === "merge" && op.source.length < 2)
      return { ok: false, code: "merge-too-few", message: `第 ${opIndex} 个 merge 操作少于 2 个来源段落` }
    if (op.kind === "split") {
      if (op.anchors.length === 0) return { ok: false, code: "split-no-anchor", message: "split 操作缺少锚点" }
      const text = paragraphText(op.source)
      for (const anchor of op.anchors) {
        const first = text.indexOf(anchor)
        if (first === -1 || text.indexOf(anchor, first + anchor.length) !== -1)
          return { ok: false, code: "split-anchor-invalid", message: `split 锚点在段落 ${op.source} 中未唯一出现` }
      }
    }
    if (op.kind === "replace") {
      const text = paragraphText(op.source)
      const first = text.indexOf(op.original)
      if (op.original.length === 0 || first === -1 || text.indexOf(op.original, first + op.original.length) !== -1)
        return { ok: false, code: "replace-original-invalid", message: `replace 原文在段落 ${op.source} 中未唯一出现` }
    }
    if (!repairEnabled && (op.kind === "merge" || op.kind === "split" || op.kind === "replace" || op.kind === "exclude"))
      return { ok: false, code: "repair-disabled", message: `正文修复已关闭，仅允许 keep（第 ${opIndex} 个操作为 ${op.kind}）` }
  }

  for (const c of draft.carry) {
    if (!window.has(c)) return { ok: false, code: "carry-out-of-window", message: `carry 段落 ${c} 不在本次阅读窗口内` }
    if (assigned.has(c)) return { ok: false, code: "carry-reused", message: `carry 段落 ${c} 已被操作分配` }
    assigned.add(c)
  }

  for (const w of windowParagraphs) {
    if (!assigned.has(w)) return { ok: false, code: "source-uncovered", message: `段落 ${w} 未出现在任何操作或 carry 中` }
  }

  if (contentSources.length === 0) return { ok: false, code: "empty-chapter", message: "候选章节没有任何正文段落" }
  return { ok: true }
}

// ─── 纯函数：确定性正文构造 ───

/** 按操作顺序确定性地构造章节正文；输出段落以空行分隔。 */
export function buildChapterContent(draft: ChapterDraft, paragraphText: (index: number) => string): string {
  const outputs: string[] = []
  for (const op of draft.ops) {
    if (op.kind === "keep") outputs.push(paragraphText(op.source))
    if (op.kind === "merge") outputs.push(op.source.map((s) => paragraphText(s)).join(op.separator))
    if (op.kind === "split") outputs.push(...splitParts(paragraphText(op.source), op.anchors))
    if (op.kind === "replace") {
      const text = paragraphText(op.source)
      const at = text.indexOf(op.original)
      outputs.push(text.slice(0, at) + op.replacement + text.slice(at + op.original.length))
    }
  }
  return outputs.join("\n\n")
}

function splitParts(text: string, anchors: string[]): string[] {
  let rest = text
  const parts: string[] = []
  for (const anchor of anchors) {
    const at = rest.indexOf(anchor)
    parts.push(rest.slice(0, at))
    rest = rest.slice(at)
  }
  parts.push(rest)
  return parts.filter((p) => p.trim().length > 0)
}

// ─── 操作账本 ───

interface LedgerOp {
  kind: string
  source: number[]
  outputIndex: number
  params: Record<string, unknown>
  reason: string
  beforeText: string
  afterText: string
}

function buildLedger(draft: ChapterDraft, paragraphText: (index: number) => string): LedgerOp[] {
  const ledger: LedgerOp[] = []
  const seenOrder: number[] = []
  let outputIndex = 0
  for (const op of draft.ops) {
    const sources = op.kind === "merge" ? op.source : [op.source]
    if (op.kind === "keep") {
      const t = paragraphText(sources[0])
      ledger.push({ kind: "keep", source: sources, outputIndex, params: {}, reason: op.reason ?? "", beforeText: t, afterText: t })
      seenOrder.push(sources[0]); outputIndex += 1
    }
    if (op.kind === "merge") {
      const before = sources.map((s) => paragraphText(s)).join("")
      const after = sources.map((s) => paragraphText(s)).join(op.separator)
      ledger.push({ kind: "merge", source: sources, outputIndex, params: { separator: op.separator }, reason: op.reason ?? "断段合并", beforeText: before, afterText: after })
      seenOrder.push(...sources); outputIndex += 1
    }
    if (op.kind === "split") {
      const beforeText = paragraphText(sources[0])
      for (const part of splitParts(beforeText, op.anchors)) {
        ledger.push({ kind: "split", source: sources, outputIndex, params: { anchors: op.anchors }, reason: op.reason ?? "长段拆分", beforeText, afterText: part })
        outputIndex += 1
      }
      seenOrder.push(sources[0])
    }
    if (op.kind === "replace") {
      const beforeText = paragraphText(sources[0])
      const at = beforeText.indexOf(op.original)
      const afterText = beforeText.slice(0, at) + op.replacement + beforeText.slice(at + op.original.length)
      ledger.push({ kind: "replace", source: sources, outputIndex, params: { original: op.original, replacement: op.replacement, category: op.category }, reason: op.reason, beforeText, afterText })
      seenOrder.push(sources[0]); outputIndex += 1
    }
    if (op.kind === "exclude") {
      ledger.push({ kind: "exclude", source: sources, outputIndex: -1, params: { category: op.category }, reason: op.reason, beforeText: paragraphText(sources[0]), afterText: "" })
      seenOrder.push(sources[0])
    }
  }
  const sorted = [...seenOrder].sort((a, b) => a - b)
  for (let i = 0; i < seenOrder.length; i++) {
    if (seenOrder[i] !== sorted[i]) {
      ledger.push({ kind: "move", source: seenOrder, outputIndex: -1, params: { fromOrder: sorted }, reason: "段落顺序调整", beforeText: "", afterText: "" })
      break
    }
  }
  return ledger
}

// ─── 任务创建 ───

export interface CreateImportJobInput {
  novelId: string
  filename: string
  encoding: string
  sourceHash: string
  rawText: string
  options: Record<string, unknown>
}

/** 创建导入任务 + 段落索引（组合形态，外层与建书同事务）。 */
export function createImportJobTx(tx: Tx, input: CreateImportJobInput): string {
  const jobId = crypto.randomUUID()
  const paragraphs = indexSourceParagraphs(input.rawText)
  tx.insert(NovelImportJobTable)
    .values({
      id: jobId,
      novel_id: input.novelId,
      filename: input.filename,
      encoding: input.encoding,
      source_hash: input.sourceHash,
      raw_text: input.rawText,
      total_chars: input.rawText.length,
      options_json: JSON.stringify(input.options),
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .run()
  for (const p of paragraphs) {
    tx.insert(NovelImportParagraphTable)
      .values({ job_id: jobId, paragraph_index: p.index, start_offset: p.startOffset, end_offset: p.endOffset })
      .run()
  }
  return jobId
}

// ─── 读取 ───

export interface ReadChunkResult {
  job: ImportJobRow
  carry: SourceParagraph[]
  /** 从游标起的新段落（不含 carry） */
  fresh: SourceParagraph[]
  /** 全部窗口段落（carry + fresh） */
  window: SourceParagraph[]
  windowConsumedChars: number
  prevChapterTail: string
  chapterCount: number
  totalParagraphs: number
}

function toRow(r: typeof NovelImportJobTable.$inferSelect): ImportJobRow {
  return r as ImportJobRow
}

export function getImportJobByNovel(novelId: string, directory?: string | null): ImportJobRow | undefined {
  const row = getDb(directory).select().from(NovelImportJobTable).where(eq(NovelImportJobTable.novel_id, novelId)).get()
  return row ? toRow(row) : undefined
}

export function getImportJob(jobId: string, directory?: string | null): ImportJobRow | undefined {
  const row = getDb(directory).select().from(NovelImportJobTable).where(eq(NovelImportJobTable.id, jobId)).get()
  return row ? toRow(row) : undefined
}

type ParagraphRow = typeof NovelImportParagraphTable.$inferSelect

function loadParagraphs(db: Db, jobId: string): ParagraphRow[] {
  return db.select().from(NovelImportParagraphTable).where(eq(NovelImportParagraphTable.job_id, jobId)).orderBy(asc(NovelImportParagraphTable.paragraph_index)).all()
}

/** 读取下一批原文：carry + 从游标起的完整段落，直到字符预算。 */
export function readSourceChunk(jobId: string, maxChars: number, directory?: string | null): ReadChunkResult {
  const db = getDb(directory)
  const jobRow = db.select().from(NovelImportJobTable).where(eq(NovelImportJobTable.id, jobId)).get()
  if (!jobRow) throw new Error(`导入任务不存在: ${jobId}`)
  const job = toRow(jobRow)
  const all = loadParagraphs(db, jobId)
  const carryIdx: number[] = JSON.parse(job.carry_json)
  const byIndex = new Map(all.map((p) => [p.paragraph_index, p]))
  const toSource = (p: ParagraphRow): SourceParagraph => ({ index: p.paragraph_index, startOffset: p.start_offset, endOffset: p.end_offset, text: job.raw_text.slice(p.start_offset, p.end_offset) })
  const carry = carryIdx.map((i) => {
    const p = byIndex.get(i)
    if (!p) throw new Error(`carry 段落 ${i} 不在段落索引中`)
    return toSource(p)
  })
  const fresh: SourceParagraph[] = []
  let used = 0
  for (let i = job.next_paragraph_index; i < all.length; i++) {
    const p = byIndex.get(i)!
    const sp = toSource(p)
    if (fresh.length > 0 && used + sp.text.length > maxChars) break
    fresh.push(sp)
    used += sp.text.length
    if (used >= maxChars) break
  }
  const prev = db
    .select({ content: ChapterTable.content, order: ChapterTable.order })
    .from(ChapterTable)
    .where(eq(ChapterTable.novel_id, job.novel_id))
    .orderBy(asc(ChapterTable.order))
    .all()
  const prevChapterTail = prev.length > 0 ? (prev[prev.length - 1].content.slice(-600) ?? "") : ""
  const chapters = db.select({ id: NovelImportChapterTable.id }).from(NovelImportChapterTable).where(eq(NovelImportChapterTable.job_id, jobId)).all()
  return {
    job,
    carry,
    fresh,
    window: [...carry, ...fresh],
    windowConsumedChars: used,
    prevChapterTail,
    chapterCount: chapters.length,
    totalParagraphs: all.length,
  }
}

// ─── 提交 ───

export interface CommitResult {
  chapterId: string
  content: string
  signal: CommitSignal
  idempotentReplay: boolean
}

export interface CommitChapterInput {
  novelId: string
  draft: ChapterDraft
  repairEnabled: boolean
}

/**
 * 单章幂等事务提交（组合形态）。
 * 幂等键 = (job_id, chapter_order)；input_fingerprint 相同返回既有结果，不同报冲突。
 */
export function commitImportChapterTx(tx: Tx, input: CommitChapterInput): CommitResult {
  const jobRow = tx.select().from(NovelImportJobTable).where(eq(NovelImportJobTable.novel_id, input.novelId)).get()
  if (!jobRow) throw new Error(`书籍 ${input.novelId} 没有导入任务`)
  const job = toRow(jobRow)
  const all = tx.select().from(NovelImportParagraphTable).where(eq(NovelImportParagraphTable.job_id, job.id)).orderBy(asc(NovelImportParagraphTable.paragraph_index)).all()
  const byIndex = new Map(all.map((p) => [p.paragraph_index, p]))
  const textOf = (i: number): string => {
    const p = byIndex.get(i)
    if (!p) throw new Error(`段落 ${i} 不存在`)
    return job.raw_text.slice(p.start_offset, p.end_offset)
  }
  const carryIdx: number[] = JSON.parse(job.carry_json)
  const windowIdx = [...carryIdx, ...all.filter((p) => p.paragraph_index >= job.next_paragraph_index && p.paragraph_index < job.next_paragraph_index + input.draft.windowSize).map((p) => p.paragraph_index)]

  const inputFingerprint = sha256Hex(JSON.stringify({ order: input.draft.chapterOrder, ops: input.draft.ops, carry: input.draft.carry }))
  const existing = tx
    .select()
    .from(NovelImportChapterTable)
    .where(and(eq(NovelImportChapterTable.job_id, job.id), eq(NovelImportChapterTable.chapter_order, input.draft.chapterOrder)))
    .get()
  if (existing) {
    if (existing.input_fingerprint === inputFingerprint) {
      const replaySignal: CommitSignal = {
        calibrationReached: job.total_chars > 0 && job.processed_chars / job.total_chars >= CALIBRATION_RATIO && tx.select({ id: NovelImportChapterTable.id }).from(NovelImportChapterTable).where(eq(NovelImportChapterTable.job_id, job.id)).all().length >= CALIBRATION_MIN_CHAPTERS,
        sourceExhausted: job.next_paragraph_index >= all.length && carryIdx.length === 0,
        remainingParagraphs: Math.max(0, all.length - job.next_paragraph_index),
      }
      return { chapterId: existing.chapter_id, content: "", signal: replaySignal, idempotentReplay: true }
    }
    throw new Error(`章节序号 ${input.draft.chapterOrder} 已存在不同的提交（冲突），请从持久化状态恢复`)
  }

  const validation = validateChapterDraft(input.draft, windowIdx, textOf, input.repairEnabled)
  if (!validation.ok) throw new Error(`草稿校验失败 [${validation.code}]: ${validation.message}`)

  const content = buildChapterContent(input.draft, textOf)
  const commitFingerprint = sha256Hex(content)
  let volumeId: string | null = null
  if (input.draft.volumeTitle !== null) {
    const volumes = tx.select({ id: VolumeTable.id, title: VolumeTable.title }).from(VolumeTable).where(eq(VolumeTable.novel_id, input.novelId)).all()
    volumeId = volumes.find((v) => titleMatches(v.title, input.draft.volumeTitle!))?.id ?? createVolumeTx(tx, input.novelId, input.draft.volumeTitle!)
  }
  const chapterId = createChapterTx(tx, input.novelId, input.draft.title, input.draft.chapterOrder, volumeId, content)

  const now = Date.now()
  tx.insert(NovelImportChapterTable)
    .values({
      id: crypto.randomUUID(),
      job_id: job.id,
      chapter_id: chapterId,
      chapter_order: input.draft.chapterOrder,
      source_start: windowIdx.length > 0 ? Math.min(...windowIdx) : 0,
      source_end: windowIdx.length > 0 ? Math.max(...windowIdx) : 0,
      input_fingerprint: inputFingerprint,
      commit_fingerprint: commitFingerprint,
      created_at: now,
      updated_at: now,
    })
    .run()

  const ledger = buildLedger(input.draft, textOf)
  for (const [i, entry] of ledger.entries()) {
    tx.insert(NovelImportOperationTable)
      .values({
        id: crypto.randomUUID(),
        job_id: job.id,
        chapter_id: chapterId,
        op_index: i,
        kind: entry.kind,
        source_json: JSON.stringify(entry.source),
        output_index: entry.outputIndex,
        params_json: JSON.stringify(entry.params),
        reason: entry.reason,
        before_text: entry.beforeText,
        after_text: entry.afterText,
        created_at: now,
      })
      .run()
  }

  // 推进：游标越过本窗口；carry 更新；processed 计入本次最终处置段落（章节 + 排除）
  const disposed = new Set<number>()
  for (const op of input.draft.ops) {
    const sources = op.kind === "merge" ? op.source : [op.source]
    for (const s of sources) {
      if (op.kind === "exclude") disposed.add(s)
      else disposed.add(s)
    }
  }
  let processedDelta = 0
  for (const i of disposed) {
    const p = byIndex.get(i)
    if (p) processedDelta += p.end_offset - p.start_offset
  }
  const newCursor = job.next_paragraph_index + input.draft.windowSize
  const newCarry = input.draft.carry
  const chapterCount = tx.select({ id: NovelImportChapterTable.id }).from(NovelImportChapterTable).where(eq(NovelImportChapterTable.job_id, job.id)).all().length
  const calibrationReached =
    job.total_chars > 0 &&
    (job.processed_chars + processedDelta) / job.total_chars >= CALIBRATION_RATIO &&
    chapterCount >= CALIBRATION_MIN_CHAPTERS
  tx.update(NovelImportJobTable)
    .set({
      next_paragraph_index: newCursor,
      processed_chars: job.processed_chars + processedDelta,
      carry_json: JSON.stringify(newCarry),
      phase: calibrationReached && job.phase === "calibration" ? "planned" : job.phase,
      updated_at: now,
    })
    .where(eq(NovelImportJobTable.id, job.id))
    .run()

  const signal: CommitSignal = {
    calibrationReached,
    sourceExhausted: newCursor >= all.length && newCarry.length === 0,
    remainingParagraphs: Math.max(0, all.length - newCursor),
  }
  return { chapterId, content, signal, idempotentReplay: false }
}

function titleMatches(existing: string, wanted: string): boolean {
  return existing === wanted || existing.includes(wanted) || wanted.includes(existing)
}

function computeSignal(job: ImportJobRow, totalParagraphs: number, carry: number[]): CommitSignal {
  const calibrationReached =
    job.total_chars > 0 && job.processed_chars / job.total_chars >= CALIBRATION_RATIO
  return {
    calibrationReached,
    sourceExhausted: job.next_paragraph_index >= totalParagraphs && carry.length === 0,
    remainingParagraphs: Math.max(0, totalParagraphs - job.next_paragraph_index),
  }
}


// ─── 阶段推进 ───

export function markImportChapterStageTx(tx: Tx, chapterId: string, stage: "settings" | "technique", status: string): void {
  const row = tx.select().from(NovelImportChapterTable).where(eq(NovelImportChapterTable.chapter_id, chapterId)).get()
  if (!row) throw new Error(`导入章节记录不存在: ${chapterId}`)
  const field = stage === "settings" ? { settings_stage: status } : { technique_stage: status }
  tx.update(NovelImportChapterTable).set({ ...field, updated_at: Date.now() }).where(eq(NovelImportChapterTable.chapter_id, chapterId)).run()
}

export function updateImportJobTx(
  tx: Tx,
  jobId: string,
  fields: Partial<{
    status: ImportJobStatus
    phase: ImportJobPhase
    planned_count: number | null
    plan_version: number
    error: string | null
    session_id: string
    options_json: string
    stats_json: string
  }>,
): void {
  tx.update(NovelImportJobTable).set({ ...fields, updated_at: Date.now() }).where(eq(NovelImportJobTable.id, jobId)).run()
}

// ─── 查询（进度/计划/报告） ───

export function getImportProgress(jobId: string, directory?: string | null) {
  const db = getDb(directory)
  const job = getImportJob(jobId, directory)!
  const total = db.select({ i: NovelImportParagraphTable.paragraph_index }).from(NovelImportParagraphTable).where(eq(NovelImportParagraphTable.job_id, jobId)).all().length
  const chapters = db.select().from(NovelImportChapterTable).where(eq(NovelImportChapterTable.job_id, jobId)).orderBy(asc(NovelImportChapterTable.chapter_order)).all()
  return {
    job,
    processedChars: job.processed_chars,
    totalChars: job.total_chars,
    progressRatio: job.total_chars > 0 ? job.processed_chars / job.total_chars : 0,
    chapterCount: chapters.length,
    calibrationReached:
      job.total_chars > 0 && job.processed_chars / job.total_chars >= CALIBRATION_RATIO && chapters.length >= CALIBRATION_MIN_CHAPTERS,
    sourceExhausted: job.next_paragraph_index >= total && (JSON.parse(job.carry_json) as number[]).length === 0,
    chapters,
  }
}

export function listImportOperations(chapterId: string, directory?: string | null) {
  return getDb(directory).select().from(NovelImportOperationTable).where(eq(NovelImportOperationTable.chapter_id, chapterId)).orderBy(asc(NovelImportOperationTable.op_index)).all()
}

export interface ImportReport {
  chapterCount: number
  planVersion: number
  plannedCount: number | null
  opCounts: Record<string, number>
  excluded: Array<{ chapterId: string; reason: string; beforeText: string }>
  moveCount: number
  unresolvedCount: number
}

export function getImportReport(jobId: string, directory?: string | null): ImportReport {
  const db = getDb(directory)
  const chapters = db.select().from(NovelImportChapterTable).where(eq(NovelImportChapterTable.job_id, jobId)).all()
  const chapterIds = chapters.map((c) => c.chapter_id)
  const ops =
    chapterIds.length > 0
      ? db.select().from(NovelImportOperationTable).where(eq(NovelImportOperationTable.job_id, jobId)).orderBy(asc(NovelImportOperationTable.op_index)).all()
      : []
  const opCounts: Record<string, number> = {}
  const excluded: ImportReport["excluded"] = []
  for (const op of ops) {
    opCounts[op.kind] = (opCounts[op.kind] ?? 0) + 1
    // 章题/卷题归入标题的排除是结构处置，不属于用户-facing「排除内容」
    if (op.kind === "exclude" && !op.params_json.includes("\"heading\""))
      excluded.push({ chapterId: op.chapter_id, reason: op.reason, beforeText: op.before_text })
  }
  const job = getImportJob(jobId, directory)!
  return {
    chapterCount: chapters.length,
    planVersion: job.plan_version,
    plannedCount: job.planned_count,
    opCounts,
    excluded,
    moveCount: opCounts["move"] ?? 0,
    unresolvedCount: 0,
  }
}

/**
 * 校准统计：已完成章节的来源字数中位数，供首次剩余计划。
 * 章节来源字数按操作账本中该章全部来源段落的字符长度合计（含排除、不含 carry）；
 * source_start/end 是段落索引区间，不能直接当字数用。
 */
export function calibrationChapterCharMedian(jobId: string, directory?: string | null): number | null {
  const db = getDb(directory)
  const chapters = db.select().from(NovelImportChapterTable).where(eq(NovelImportChapterTable.job_id, jobId)).all()
  if (chapters.length === 0) return null
  const paragraphs = loadParagraphs(db, jobId)
  const byIndex = new Map(paragraphs.map((p) => [p.paragraph_index, p]))
  const ops = db.select().from(NovelImportOperationTable).where(eq(NovelImportOperationTable.job_id, jobId)).all()
  const perChapter = new Map<string, Set<number>>()
  for (const op of ops) {
    const set = perChapter.get(op.chapter_id) ?? new Set<number>()
    for (const i of JSON.parse(op.source_json) as number[]) set.add(i)
    perChapter.set(op.chapter_id, set)
  }
  const lengths = chapters
    .map((c) => {
      const sources = perChapter.get(c.chapter_id)
      if (!sources || sources.size === 0) return 0
      let len = 0
      for (const i of sources) {
        const p = byIndex.get(i)
        if (p) len += p.end_offset - p.start_offset
      }
      return len
    })
    .filter((l) => l > 0)
    .sort((a, b) => a - b)
  if (lengths.length === 0) return null
  const mid = Math.floor(lengths.length / 2)
  return lengths.length % 2 === 1 ? lengths[mid] : Math.round((lengths[mid - 1] + lengths[mid]) / 2)
}
