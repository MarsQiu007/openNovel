/**
 * 原文驱动导入编排（source-driven-import）：start 启动 / get 进度 / control 控制。
 *
 * start：解码校验 → novel-store 单事务建书+任务+段落索引 → 创建专用导入会话并绑定
 * → SessionV2 durable prompt admission（不在 HTTP 请求内执行 provider work）。
 * 会话/提示步骤失败保留可重试任务（awaiting_queue + error），不静默回滚已落库原文。
 * 标题 hint 逻辑由插件 source_import 工具内建（正则模块），服务端只保留编码与输入边界。
 */
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { SessionV2 } from "@opennovel-ai/core/session"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import type { SessionWorkRun } from "@opennovel-ai/core/session/work-run"
import type {
  NovelImportControlInput,
  NovelImportProgress,
  NovelImportReport,
  NovelImportStartInput,
} from "@opennovel-ai/schema/novel"
import { NovelImportError } from "@opennovel-ai/protocol/groups/novel"
import {
  getDb,
  withTransaction,
  NovelTable,
  ChapterTable,
  VolumeTable,
  tagNovelSession,
  createImportJobTx,
  getImportJobByNovel,
  getImportJob,
  getImportProgress,
  getImportReport,
  updateImportJobTx,
} from "@opennovel-ai/novel-store"
import { decodeDataUrlBytes, decodeWithEncoding, detectAndDecode } from "./encoding"

const IMPORT_DEFAULT_GENRE = "玄幻"

type FailureReason = "encoding-failed" | "invalid-text" | "file-too-large" | "not-found" | "invalid-state"

type SessionService = Effect.Success<typeof SessionV2.Service>
type WorkRunService = Effect.Success<typeof SessionWorkRun.Service>

function importError(message: string, reason?: FailureReason) {
  return new NovelImportError({ name: "NovelImportError", data: { message, ...(reason === undefined ? {} : { reason }) } })
}

function decodeBytes(dataUrl: string): { bytes: Uint8Array } | { error: NovelImportError } {
  const decoded = decodeDataUrlBytes(dataUrl)
  if (decoded.ok) return { bytes: decoded.bytes }
  if (decoded.reason === "file-too-large") return { error: importError("文件超过 50 MiB 上限", "file-too-large") }
  const message = decoded.reason === "empty" ? "文件内容为空" : "文件内容无效"
  return { error: importError(message, "invalid-text") }
}

function decodeSource(bytes: Uint8Array, encoding: NovelImportStartInput["encoding"]) {
  if (encoding !== undefined) {
    const text = decodeWithEncoding(bytes, encoding)
    return text === null ? null : { text, encoding }
  }
  return detectAndDecode(bytes)
}

function buildStartInstruction(input: { novelId: string; jobId: string; title: string; totalChars: number }): string {
  return [
    `小说 ID：${input.novelId}`,
    `导入任务 ID：${input.jobId}`,
    "",
    `《${input.title}》原文已入库（约 ${input.totalChars} 字），请执行原文驱动导入：`,
    "1. 用 workrun 创建队列，首单元为「校准第 1 章」（校准期逐章结算，达到 25% 且至少 3 章后生成剩余计划）；",
    "2. 用 source_import(status/read/commit/plan/finalize) 顺序处理：按段落与预算流式阅读，边界不合理就追加段落，同一轮阅读完成分章、正文修复、设定与技法抽取；",
    "3. commit 返回 source_exhausted 时在完成当前章单元前追加「书籍简介生成」「汇总汇报」收尾任务；",
    "4. finalize 确认全部原文处置后产出统一导入报告并终结队列。",
  ].join("\n")
}

function toProgress(directory: string, jobId: string): NovelImportProgress {
  const progress = getImportProgress(jobId, directory)
  const db = getDb(directory)
  const carryCount = (JSON.parse(progress.job.carry_json) as number[]).length
  const chapterRows = new Map(
    db
      .select({ id: ChapterTable.id, title: ChapterTable.title, word_count: ChapterTable.word_count })
      .from(ChapterTable)
      .where(eq(ChapterTable.novel_id, progress.job.novel_id))
      .all()
      .map((c) => [c.id, c]),
  )
  return {
    novelId: progress.job.novel_id,
    jobId: progress.job.id,
    sessionId: progress.job.session_id,
    status: progress.job.status,
    phase: progress.job.phase,
    processedChars: progress.processedChars,
    totalChars: progress.totalChars,
    progressRatio: progress.progressRatio,
    chapterCount: progress.chapterCount,
    calibrationReached: progress.calibrationReached,
    sourceExhausted: progress.sourceExhausted,
    planVersion: progress.job.plan_version,
    ...(progress.job.planned_count === null ? {} : { plannedCount: progress.job.planned_count }),
    carryCount,
    chapters: progress.chapters.map((c) => {
      const row = chapterRows.get(c.chapter_id)
      return {
        chapterId: c.chapter_id,
        order: c.chapter_order,
        title: row?.title ?? "",
        wordCount: row?.word_count ?? 0,
        settingsStage: c.settings_stage,
        techniqueStage: c.technique_stage,
      }
    }),
  }
}

export function startImport(
  directory: string,
  session: SessionService,
  payload: NovelImportStartInput,
): Effect.Effect<NovelImportProgress, NovelImportError> {
  return Effect.gen(function* () {
    const decoded = decodeBytes(payload.dataUrl)
    if ("error" in decoded) return yield* Effect.fail(decoded.error)
    const source = decodeSource(decoded.bytes, payload.encoding)
    if (source === null) return yield* Effect.fail(importError("编码识别失败，请显式指定编码后重试", "encoding-failed"))

    const novelId = crypto.randomUUID()
    const db = getDb(directory)
    const jobId = withTransaction(db, (tx) => {
      const now = Date.now()
      tx.insert(NovelTable)
        .values({ id: novelId, title: payload.title, genre: IMPORT_DEFAULT_GENRE, synopsis: "", created_at: now, updated_at: now, status: "draft", content_nature: "general" })
        .run()
      return createImportJobTx(tx, {
        novelId,
        filename: payload.filename,
        encoding: source.encoding,
        sourceHash: "",
        rawText: source.text,
        options: {
          ...(payload.targetChapterChars === undefined ? {} : { targetChapterChars: payload.targetChapterChars }),
          repairLevel: payload.repairLevel ?? "standard",
        },
      })
    })
    withTransaction(db, (tx) => updateImportJobTx(tx, jobId, { error: null }))

    const created = yield* session.create({ location: { directory: AbsolutePath.make(directory) } }).pipe(
      Effect.mapError(() => importError("创建导入会话失败，任务已保留，可重试")),
    )
    yield* Effect.tryPromise({
      try: () => tagNovelSession(created.id, novelId, directory),
      catch: () => importError("绑定导入会话失败"),
    }).pipe(Effect.mapError((error) => error))
    yield* session
      .prompt({ sessionID: created.id, prompt: { text: buildStartInstruction({ novelId, jobId, title: payload.title, totalChars: source.text.length }) } })
      .pipe(Effect.mapError(() => importError("投递导入启动指令失败，任务已保留，可重试")))
    withTransaction(db, (tx) => updateImportJobTx(tx, jobId, { session_id: created.id, status: "calibrating" }))
    return toProgress(directory, jobId)
  })
}

function requireJob(directory: string, novelId: string) {
  const job = getImportJobByNovel(novelId, directory)
  if (!job) throw importError("该书籍没有导入任务", "not-found")
  return job
}

export function getImportProgressEndpoint(directory: string, novelId: string): Effect.Effect<NovelImportProgress, NovelImportError> {
  return Effect.try({
    try: () => toProgress(directory, requireJob(directory, novelId).id),
    catch: (error): NovelImportError => (error instanceof NovelImportError ? error : importError(String(error))),
  })
}

export function getImportReportEndpoint(directory: string, novelId: string): Effect.Effect<NovelImportReport, NovelImportError> {
  return Effect.try({
    try: () => {
      const job = requireJob(directory, novelId)
      const report = getImportReport(job.id, directory)
      const novel = getDb(directory).select({ title: NovelTable.title }).from(NovelTable).where(eq(NovelTable.id, novelId)).get()
      return {
        novelId,
        title: novel?.title ?? "",
        chapterCount: report.chapterCount,
        planVersion: report.planVersion,
        ...(report.plannedCount === null ? {} : { plannedCount: report.plannedCount }),
        opCounts: report.opCounts,
        excluded: report.excluded,
        operations: report.operations,
        moveCount: report.moveCount,
        unresolvedCount: report.unresolvedCount,
      }
    },
    catch: (error) => (error instanceof NovelImportError ? error : importError(String(error))),
  })
}

function resumePrompt(novelId: string, jobId: string, extra: string): string {
  return [`小说 ID：${novelId}`, `导入任务 ID：${jobId}`, "", extra].join("\n")
}

export function controlImport(
  directory: string,
  services: { session: SessionService; workrun: WorkRunService },
  novelId: string,
  payload: NovelImportControlInput,
): Effect.Effect<NovelImportProgress, NovelImportError> {
  return Effect.gen(function* () {
    const job = requireJob(directory, novelId)
    const db = getDb(directory)
    if (payload.action === "pause") {
      if (job.session_id !== null) {
        yield* services.workrun.pause(SessionV2.ID.make(job.session_id)).pipe(Effect.ignore)
      }
      withTransaction(db, (tx) => updateImportJobTx(tx, job.id, { status: "paused" }))
      return toProgress(directory, job.id)
    }
    if (payload.action === "resume") {
      if (job.status !== "paused") return yield* Effect.fail(importError("仅暂停的导入可以恢复", "invalid-state"))
      if (job.session_id !== null) {
        yield* services.workrun.resume(SessionV2.ID.make(job.session_id)).pipe(Effect.ignore)
        yield* services.session
          .prompt({ sessionID: SessionV2.ID.make(job.session_id), prompt: { text: resumePrompt(novelId, job.id, "导入队列已恢复：按持久化进度继续推进未完成单元。") } })
          .pipe(Effect.mapError(() => importError("投递恢复指令失败")))
      }
      withTransaction(db, (tx) => updateImportJobTx(tx, job.id, { status: job.phase === "calibration" ? "calibrating" : "planned" }))
      return toProgress(directory, job.id)
    }
    if (payload.action === "retry") {
      if (job.session_id === null) return yield* Effect.fail(importError("导入缺少会话，无法重试", "invalid-state"))
      yield* services.session
        .prompt({ sessionID: SessionV2.ID.make(job.session_id), prompt: { text: resumePrompt(novelId, job.id, "请重试导入：先读 source_import status 核对持久化进度，从最近未完成章节或阶段继续，不要重复已提交章节。") } })
        .pipe(Effect.mapError(() => importError("投递重试指令失败")))
      withTransaction(db, (tx) => updateImportJobTx(tx, job.id, { status: job.phase === "calibration" ? "calibrating" : "planned", error: null }))
      return toProgress(directory, job.id)
    }
    // configure：仅 paused，更新未开始部分配置并触发尾部重规划
    if (job.status !== "paused") return yield* Effect.fail(importError("仅暂停的导入可以修改配置", "invalid-state"))
    const options = JSON.parse(job.options_json) as Record<string, unknown>
    const nextOptions = {
      ...options,
      ...(payload.targetChapterChars === undefined ? {} : { targetChapterChars: payload.targetChapterChars }),
      ...(payload.repairLevel === undefined ? {} : { repairLevel: payload.repairLevel }),
    }
    withTransaction(db, (tx) => {
      updateImportJobTx(tx, job.id, { options_json: JSON.stringify(nextOptions) })
    })
    if (job.session_id !== null) {
      yield* services.session
        .prompt({
          sessionID: SessionV2.ID.make(job.session_id),
          prompt: { text: resumePrompt(novelId, job.id, "配置已更新（仅应用到未开始部分）：请对未开始尾部执行 replan，已完成与进行中单元保持不变。") },
        })
        .pipe(Effect.mapError(() => importError("投递配置指令失败")))
    }
    return toProgress(directory, job.id)
  })
}
