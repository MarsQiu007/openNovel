/**
 * source_import 工具（原文驱动导入编排）。
 *
 * 动作：status / read / commit / plan / finalize / mark_stage。
 * 始终按导入任务 ID 定位 novel-store 账本，不接受文件路径；
 * WorkRun 队列由 director 经 workrun 工具驱动，本工具只维护原文账本与任务状态。
 * 硬预算：单章单元内累计阅读字符上限（元数据缺失时的保守默认值），
 * 防止扩展阅读撑爆模型上下文；耗尽后必须 block 当前单元而不是硬切。
 */
import { Schema } from "effect"
import { and, asc, eq } from "drizzle-orm"
import {
  getDb,
  withTransaction,
  NovelTable,
  getImportJob,
  getImportProgress,
  getImportReport,
  readSourceChunk,
  commitImportChapterTx,
  markImportChapterStageTx,
  updateImportJobTx,
  calibrationChapterCharMedian,
  NovelImportChapterTable,
  NovelImportParagraphTable,
  type ChapterDraft,
  type ImportJobRow,
  type SourceParagraph,
} from "../session-store.js"
import { defineTool } from "../../v2/effect/tool.js"

/** 单章单元累计阅读的保守硬预算（字符）。元数据缺失时的默认值。 */
const HARD_BUDGET_TOTAL_CHARS = 120_000
/** 单次 read 的默认目标预算。 */
const DEFAULT_READ_CHARS = 24_000
/** 单次 read 的上限（即使请求更大也按完整段落截断到此）。 */
const MAX_SINGLE_READ_CHARS = 60_000
/** 无中位数字样与显式章题时的兜底章长。 */
const FALLBACK_CHAPTER_CHARS = 3_000

// ─── 章题 hint（仅提示，不拥有建章权） ───

const NUMBER_SOURCE = "([0-9０-９]+|[零一二两三四五六七八九十百千万]+)"

const HEADING_RULES: Array<{ kind: string; re: RegExp }> = [
  { kind: "volume", re: new RegExp("^第" + NUMBER_SOURCE + "[卷部]\\s*[：:、.．\\-—]?\\s*(.*)$") },
  { kind: "volume", re: new RegExp("^卷\\s*" + NUMBER_SOURCE + "\\s*[：:、.．\\-—]?\\s*(.*)$") },
  { kind: "volume", re: /^Volume\s+([0-9]+)\s*[.、．\-—]?\s*(.*)$/i },
  { kind: "chapter", re: new RegExp("^第" + NUMBER_SOURCE + "[章回节]\\s*[：:、.．\\-—]?\\s*(.*)$") },
  { kind: "chapter", re: /^[Cc]hapter\s+([0-9]+)\s*[.、．\-—]?\s*(.*)$/ },
  { kind: "prologue", re: /^(序章|序言|楔子|前言|引言|序)$/ },
  { kind: "epilogue", re: /^(尾声|后记|完结篇)$/ },
  { kind: "extra", re: /^番外(?:篇|章|章节)?\s*[：:、.．]?\s*(.*)$/ },
]
const PROSE_PUNCTUATION = /[。！？；，、…]/
const HEADING_MAX_LENGTH = 40

const CHINESE_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

function toHalfWidthDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

function parseSegment(segment: string): number | null {
  let total = 0
  let section = 0
  for (const ch of segment) {
    const digit = CHINESE_DIGITS[ch]
    const unit = CHINESE_UNITS[ch]
    if (digit !== undefined) { section = digit; continue }
    if (unit !== undefined) { section = (section === 0 ? 1 : section) * unit; total += section; section = 0; continue }
    return null
  }
  return total + section
}

/** 阿拉伯（含全角）或中文数字 → 整数；无法解析返回 null。 */
function parseHeadingNumber(raw: string): number | null {
  const text = toHalfWidthDigits(raw)
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10)
  if (!/^[零一二两三四五六七八九十百千万]+$/.test(text)) return null
  const wanIndex = text.indexOf("万")
  if (wanIndex >= 0) {
    const high = parseSegment(text.slice(0, wanIndex))
    const low = parseSegment(text.slice(wanIndex + 1))
    if (high === null || low === null) return null
    return high * 10000 + low
  }
  return parseSegment(text)
}

interface HeadingHint {
  index: number
  kind: string
  title: string
  number: number | null
}

function headingHints(paragraphs: SourceParagraph[]): HeadingHint[] {
  const hints: HeadingHint[] = []
  for (const p of paragraphs) {
    const text = p.text.trim()
    if (text.length === 0 || text.length > HEADING_MAX_LENGTH) continue
    if (PROSE_PUNCTUATION.test(text)) continue
    for (const rule of HEADING_RULES) {
      const m = rule.re.exec(text)
      if (!m) continue
      const number = m[1] ? parseHeadingNumber(m[1]) : null
      const title = (m[2] ?? "").trim() || text
      hints.push({ index: p.index, kind: rule.kind, title, number })
      break
    }
  }
  return hints
}

function hintItemLabel(h: HeadingHint): string {
  if (h.kind === "prologue") return "序章/楔子/前言（特殊章）"
  if (h.kind === "epilogue") return "尾声/后记（特殊章）"
  if (h.kind === "extra") return "番外" + (h.title ? "《" + h.title + "》" : "")
  return h.number !== null ? "第 " + h.number + " 章" + (h.title ? "《" + h.title + "》" : "") : h.title
}

// ─── 参数 ───

const OpSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("keep"),
    source: Schema.Number,
    reason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("merge"),
    source: Schema.Array(Schema.Number),
    separator: Schema.String,
    reason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("split"),
    source: Schema.Number,
    anchors: Schema.Array(Schema.String),
    reason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("replace"),
    source: Schema.Number,
    original: Schema.String,
    replacement: Schema.String,
    category: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("exclude"),
    source: Schema.Number,
    category: Schema.String,
    reason: Schema.String,
  }),
])

const ArgsSchema = Schema.Struct({
  action: Schema.Literals(["status", "read", "commit", "plan", "finalize", "mark_stage"]),
  job_id: Schema.String,
  max_chars: Schema.optional(Schema.Number),
  draft: Schema.optional(
    Schema.Struct({
      title: Schema.String,
      volume_title: Schema.NullOr(Schema.String),
      chapter_order: Schema.Number,
      ops: Schema.Array(OpSchema),
      carry: Schema.Array(Schema.Number),
      window_size: Schema.Number,
    }),
  ),
  reason: Schema.optional(
    Schema.Literals(["first_plan", "source_exhausted", "work_remaining", "structure_invalidated", "options_changed"]),
  ),
  evidence: Schema.optional(Schema.String),
  chapter_order: Schema.optional(Schema.Number),
  stage: Schema.optional(Schema.Literals(["settings", "technique"])),
})

// ─── 共享辅助 ───

interface PlanHistoryEntry {
  version: number
  reason: string
  items: number
  at: number
}

interface JobStats {
  readCharsTotal?: number
  planHistory?: PlanHistoryEntry[]
}

function parseStats(raw: string): JobStats {
  try {
    return JSON.parse(raw) as JobStats
  } catch {
    return {}
  }
}

function parseOptions(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function repairEnabledOf(options: Record<string, unknown>): boolean {
  return options.repairLevel !== "off"
}

function requireJob(directory: string, jobId: string): ImportJobRow {
  const job = getImportJob(jobId, directory)
  if (!job) throw new Error("导入任务不存在: " + jobId)
  return job
}

function assertNotPaused(job: ImportJobRow): void {
  if (job.status === "paused") throw new Error("导入已暂停：恢复后再执行推进类动作")
}

function chapterTaskLabel(order: number): string {
  return "第 " + order + " 章（待分章）"
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

// ─── 动作实现 ───

type Args = typeof ArgsSchema.Type

function statusAction(directory: string, job: ImportJobRow): string {
  const progress = getImportProgress(job.id, directory)
  const stats = parseStats(job.stats_json)
  const used = stats.readCharsTotal ?? 0
  return json({
    ok: true,
    job_id: job.id,
    novel_id: job.novel_id,
    status: job.status,
    phase: job.phase,
    plan_version: job.plan_version,
    planned_count: job.planned_count,
    processed_chars: progress.processedChars,
    total_chars: progress.totalChars,
    progress_ratio: progress.progressRatio,
    calibration_reached: progress.calibrationReached,
    source_exhausted: progress.sourceExhausted,
    next_paragraph_index: job.next_paragraph_index,
    carry: JSON.parse(job.carry_json) as number[],
    chapter_count: progress.chapterCount,
    chapters: progress.chapters.map((c) => ({
      chapter_order: c.chapter_order,
      chapter_id: c.chapter_id,
      source_start: c.source_start,
      source_end: c.source_end,
      content_stage: c.content_stage,
      settings_stage: c.settings_stage,
      technique_stage: c.technique_stage,
    })),
    options: parseOptions(job.options_json),
    repair_enabled: repairEnabledOf(parseOptions(job.options_json)),
    hard_budget: { total: HARD_BUDGET_TOTAL_CHARS, used, remaining: HARD_BUDGET_TOTAL_CHARS - used },
    plan_history: stats.planHistory ?? [],
    error: job.error,
  })
}

function readAction(directory: string, job: ImportJobRow, maxChars: number | undefined): string {
  assertNotPaused(job)
  const db = getDb(directory)
  const stats = parseStats(job.stats_json)
  const used = stats.readCharsTotal ?? 0
  const remainingHard = HARD_BUDGET_TOTAL_CHARS - used
  if (remainingHard <= 0) {
    return json({
      ok: false,
      code: "hard-budget-exhausted",
      message:
        "本单元累计阅读已达硬预算 " + HARD_BUDGET_TOTAL_CHARS + " 字符仍无安全章末：禁止再读、禁止固定字数硬切。请用 workrun block_item 标记受阻（建议调整目标章长或人工介入）。",
      used_hard_chars: used,
    })
  }
  const requested = maxChars ?? DEFAULT_READ_CHARS
  const effective = Math.max(1000, Math.min(requested, remainingHard, MAX_SINGLE_READ_CHARS))
  const chunk = readSourceChunk(job.id, effective, directory)
  const windowChars = chunk.window.reduce((sum, p) => sum + p.text.length, 0)
  const nextStats: JobStats = { ...stats, readCharsTotal: used + windowChars }
  withTransaction(db, (tx) => updateImportJobTx(tx, job.id, { stats_json: json(nextStats) }))
  const carryIdx = new Set(chunk.carry.map((p) => p.index))
  return json({
    ok: true,
    job_id: job.id,
    prev_chapter_tail: chunk.prevChapterTail,
    carry: chunk.carry.map((p) => ({ index: p.index, text: p.text })),
    fresh: chunk.fresh.map((p) => ({ index: p.index, text: p.text })),
    window_indexes: chunk.window.map((p) => p.index),
    window_chars: windowChars,
    title_hints: headingHints(chunk.window).map((h) => ({ paragraph: h.index, kind: h.kind, title: h.title, number: h.number })),
    remaining_chars: chunk.job.total_chars - chunk.job.processed_chars,
    progress_ratio: chunk.job.total_chars > 0 ? chunk.job.processed_chars / chunk.job.total_chars : 0,
    phase: chunk.job.phase,
    calibration_reached:
      chunk.job.total_chars > 0 && chunk.job.processed_chars / chunk.job.total_chars >= 0.25 && chunk.chapterCount >= 3,
    plan_version: chunk.job.plan_version,
    chapter_count: chunk.chapterCount,
    total_paragraphs: chunk.totalParagraphs,
    source_exhausted: chunk.job.next_paragraph_index >= chunk.totalParagraphs && carryIdx.size === 0,
    hard_budget: { total: HARD_BUDGET_TOTAL_CHARS, used: used + windowChars, remaining: HARD_BUDGET_TOTAL_CHARS - used - windowChars },
  })
}

function commitAction(directory: string, job: ImportJobRow, draft: Args["draft"]): string {
  if (!draft) throw new Error("commit 需要 draft 参数（标题/卷题/章节序号/结构化操作/carry/窗口大小）")
  assertNotPaused(job)
  const options = parseOptions(job.options_json)
  const db = getDb(directory)
  const chapterDraft: ChapterDraft = {
    title: draft.title,
    volumeTitle: draft.volume_title,
    chapterOrder: draft.chapter_order,
    ops: draft.ops.map((op): ChapterDraft["ops"][number] => {
      if (op.kind === "merge") return { ...op, source: [...op.source] }
      if (op.kind === "split") return { ...op, anchors: [...op.anchors] }
      return { ...op }
    }),
    carry: [...draft.carry],
    windowSize: draft.window_size,
  }
  const result = withTransaction(db, (tx) =>
    commitImportChapterTx(tx, { novelId: job.novel_id, draft: chapterDraft, repairEnabled: repairEnabledOf(options) }),
  )
  const stats = parseStats(job.stats_json)
  withTransaction(db, (tx) =>
    updateImportJobTx(tx, job.id, { stats_json: json({ ...stats, readCharsTotal: 0 }) }),
  )
  const guidance: string[] = []
  if (result.signal.calibrationReached && job.plan_version === 0) {
    guidance.push(
      "已达到校准阈值（25% 且至少 3 章）：先 source_import(action=plan, reason=first_plan) 生成剩余章节任务，再用 workrun(action=「replan」, items=plan 返回的任务列表) 替换未开始尾部，最后 complete_item 当前单元。",
    )
  }
  if (result.signal.sourceExhausted) {
    guidance.push(
      "原文已全部处置：完成当前章单元前，先 source_import(action=plan, reason=source_exhausted) 取「书籍简介生成」「汇总汇报」收尾任务，再用 workrun 替换未开始尾部，然后 complete_item。",
    )
  }
  if (guidance.length === 0) {
    guidance.push(
      "校准期：用 workrun 追加下一校准单元（replan items=[校准第 N+1 章]）再 complete_item；计划期：直接 complete_item 后 claim 下一单元。随后在同一轮阅读内完成设定与技法抽取并 mark_stage。",
    )
  }
  return json({
    ok: true,
    chapter_id: result.chapterId,
    content_chars: result.content.length,
    idempotent_replay: result.idempotentReplay,
    signal: result.signal,
    guidance,
  })
}

function planAction(
  directory: string,
  job: ImportJobRow,
  reason: Args["reason"],
  evidence: string | undefined,
): string {
  if (job.status === "paused" && reason !== "options_changed") throw new Error("导入已暂停：恢复后再重规划")
  if (job.status === "completed") throw new Error("导入已完成，禁止重规划")
  const planReason = reason ?? "first_plan"
  const db = getDb(directory)
  const progress = getImportProgress(job.id, directory)
  if (planReason === "first_plan") {
    if (job.plan_version !== 0) throw new Error("首次计划已存在（plan_version=" + job.plan_version + "）：常规提交禁止重算计划")
    if (!progress.calibrationReached) throw new Error("尚未达到校准阈值（25% 且至少 3 章），校准期只追加下一校准单元，不生成剩余计划")
  }
  if (planReason === "source_exhausted" && !progress.sourceExhausted) {
    throw new Error("原文尚未处置完，不能用 source_exhausted 重规划")
  }
  if (planReason === "structure_invalidated" && (!evidence || evidence.trim().length === 0)) {
    throw new Error("structure_invalidated 必须携带具体证据（新卷题/大段乱序等），禁止凭单章长短改计划")
  }
  const stats = parseStats(job.stats_json)
  const options = parseOptions(job.options_json)
  const target = typeof options.targetChapterChars === "number" ? options.targetChapterChars : null
  const remainingChars = progress.totalChars - progress.processedChars
  const carrySet = new Set(JSON.parse(job.carry_json) as number[])
  const paragraphs = db
    .select()
    .from(NovelImportParagraphTable)
    .where(eq(NovelImportParagraphTable.job_id, job.id))
    .orderBy(asc(NovelImportParagraphTable.paragraph_index))
    .all()
  const remainingParas: SourceParagraph[] = paragraphs
    // 未消费段落 = 游标起的新段落 + carry（carry 已读但留给下一章，同属未处置）
    .filter((p) => p.paragraph_index >= job.next_paragraph_index || carrySet.has(p.paragraph_index))
    .map((p) => ({ index: p.paragraph_index, startOffset: p.start_offset, endOffset: p.end_offset, text: job.raw_text.slice(p.start_offset, p.end_offset) }))
  const chapterHints = headingHints(remainingParas).filter((h) => h.kind !== "volume")
  const median = calibrationChapterCharMedian(job.id, directory)
  let items: string[] = []
  let estimated = 0
  if (planReason === "source_exhausted") {
    items = ["书籍简介生成", "汇总汇报"]
  } else if (planReason === "options_changed" && target !== null && target > 0) {
    estimated = Math.max(1, Math.round(remainingChars / target))
  } else if (chapterHints.length > 0) {
    estimated = chapterHints.length
  } else if (median !== null && median > 0) {
    estimated = Math.max(1, Math.round(remainingChars / median))
  } else {
    estimated = Math.max(1, Math.round(remainingChars / (target ?? FALLBACK_CHAPTER_CHARS)))
  }
  if (items.length === 0) {
    if (planReason !== "options_changed" && chapterHints.length > 0) {
      items = chapterHints.map(hintItemLabel)
    } else {
      const startOrder = progress.chapterCount + 1
      items = Array.from({ length: estimated }, (_, i) => chapterTaskLabel(startOrder + i))
    }
  }
  const nextVersion = job.plan_version + 1
  const history: PlanHistoryEntry[] = [...(stats.planHistory ?? []), { version: nextVersion, reason: planReason, items: items.length, at: Date.now() }]
  withTransaction(db, (tx) =>
    updateImportJobTx(tx, job.id, {
      planned_count: estimated,
      plan_version: nextVersion,
      stats_json: json({ ...stats, readCharsTotal: 0, planHistory: history }),
    }),
  )
  return json({
    ok: true,
    reason: planReason,
    plan_version: nextVersion,
    planned_count: estimated,
    items,
    detected_titles: chapterHints.map((h) => ({ paragraph: h.index, kind: h.kind, title: h.title, number: h.number })),
    remaining_chars: remainingChars,
    baseline_median_chars: median,
    guidance: "请用 workrun(action=「replan」, items=本列表) 原子替换未开始尾部；已完成/进行中/跳过/受阻单元不受影响。校准期首次建队后正常章节提交禁止再 plan。",
  })
}

function markStageAction(directory: string, job: ImportJobRow, chapterOrder: number | undefined, stage: Args["stage"]): string {
  if (chapterOrder === undefined || stage === undefined) throw new Error("mark_stage 需要 chapter_order 与 stage")
  assertNotPaused(job)
  const db = getDb(directory)
  const row = db
    .select()
    .from(NovelImportChapterTable)
    .where(and(eq(NovelImportChapterTable.job_id, job.id), eq(NovelImportChapterTable.chapter_order, chapterOrder)))
    .get()
  if (!row) throw new Error("导入任务中不存在章节序号 " + chapterOrder)
  withTransaction(db, (tx) => markImportChapterStageTx(tx, row.chapter_id, stage, "done"))
  return json({ ok: true, chapter_order: chapterOrder, stage, status: "done" })
}

function finalizeAction(directory: string, job: ImportJobRow): string {
  assertNotPaused(job)
  const db = getDb(directory)
  const progress = getImportProgress(job.id, directory)
  if (!progress.sourceExhausted) {
    const carrySet = new Set(JSON.parse(job.carry_json) as number[])
    const leftover = db
      .select({ i: NovelImportParagraphTable.paragraph_index })
      .from(NovelImportParagraphTable)
      .where(eq(NovelImportParagraphTable.job_id, job.id))
      .orderBy(asc(NovelImportParagraphTable.paragraph_index))
      .all()
      .filter((p) => p.i >= job.next_paragraph_index && !carrySet.has(p.i))
      .slice(0, 10)
      .map((p) => p.i)
    throw new Error("仍有未消费原文（段落 " + leftover.join(", ") + " 等），禁止完成导入：请先继续提交章节或显式排除")
  }
  const pendingStages = progress.chapters.filter((c) => c.settings_stage !== "done" || c.technique_stage !== "done")
  if (pendingStages.length > 0) {
    throw new Error("存在未完成设定/技法阶段的章节（序号 " + pendingStages.map((c) => c.chapter_order).join(", ") + "），请先补做并 mark_stage")
  }
  const novel = db.select({ synopsis: NovelTable.synopsis }).from(NovelTable).where(eq(NovelTable.id, job.novel_id)).get()
  if (!novel || novel.synopsis.trim().length === 0) {
    throw new Error("书籍简介为空：请先完成「书籍简介生成」单元（update_novel synopsis）再 finalize")
  }
  withTransaction(db, (tx) => updateImportJobTx(tx, job.id, { status: "completed", phase: "done" }))
  const report = getImportReport(job.id, directory)
  return json({
    ok: true,
    job_id: job.id,
    report,
    summary: "导入完成：" + report.chapterCount + " 章，计划版本 v" + report.planVersion + "，修复操作 " + JSON.stringify(report.opCounts) + "。队列可 finish 终结。",
  })
}

// ─── 工具导出 ───

export const importSourceTools = {
  source_import: defineTool({
    description:
      "原文驱动导入编排。按导入任务 ID 操作已入库原文账本（不接受文件路径）。动作：status 查进度/章节阶段/计划历史；read 按完整段落与字符预算读下一批原文（返回上一章结尾、carry、本批段落、章题 hint、真实进度、硬预算余量）；commit 用 keep/merge/split/replace/exclude 结构化操作提交单章（幂等，carry 留给下一章）；plan 生成/重规划剩余章节任务列表（first_plan/source_exhausted/work_remaining/structure_invalidated/options_changed），返回列表须由 workrun replan 原子替换未开始尾部；mark_stage 记录章节设定/技法阶段完成；finalize 校验全部原文已处置、简介已写、阶段齐全后完成导入并返回统一报告。导入暂停时推进类动作被拒绝。",
    args: ArgsSchema,
    async execute(args, ctx) {
      const job = requireJob(ctx.directory, args.job_id)
      if (args.action === "status") return statusAction(ctx.directory, job)
      if (args.action === "read") return readAction(ctx.directory, job, args.max_chars)
      if (args.action === "commit") return commitAction(ctx.directory, job, args.draft)
      if (args.action === "plan") return planAction(ctx.directory, job, args.reason, args.evidence)
      if (args.action === "mark_stage") return markStageAction(ctx.directory, job, args.chapter_order, args.stage)
      return finalizeAction(ctx.directory, job)
    },
  }),
}

