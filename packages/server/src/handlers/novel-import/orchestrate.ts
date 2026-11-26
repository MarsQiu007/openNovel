/**
 * 书籍导入编排（book-import）：analyze 预览与 apply 事务化建书。
 *
 * analyze：dataUrl → 解码 →（可选清洗）→ 拆卷拆章 → 预览 + previewToken。
 * apply：重解码重解析并校验 previewToken 一致性 → 单事务建书（书/卷/章 + 初始正文）。
 * previewToken 为不透明串（base64url JSON）：解析器版本 + 原文哈希 + 解析参数
 * （清洗开关、生效编码、兜底分章开关与字数范围、拆章方式）；analyze 不落盘任何原文或中间件。
 *
 * AI 拆章（narrative-unit-split）：analyze 仅输出预估（不创建章节）；apply 单事务建书
 * （书 + 原文存档文件 + 存档元数据，无卷章），章节由 AI 拆章队列逐章产出。
 */
import { createHash } from "crypto"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { Effect } from "effect"
import { countWords } from "@opennovel-ai/schema/schema"
import type {
  NovelImportAiEstimate,
  NovelImportAnalyzeInput,
  NovelImportApplyInput,
  NovelImportEncoding,
  NovelImportIssue,
  NovelImportPreview,
  NovelImportReport,
  NovelSplitMode,
} from "@opennovel-ai/schema/novel"
import { NovelImportError } from "@opennovel-ai/protocol/groups/novel"
import {
  getDb,
  NovelArchiveTable,
  NovelTable,
  createChapterTx,
  createVolumeTx,
  withTransaction,
} from "@opennovel-ai/novel-store"
import { decodeDataUrlBytes, decodeWithEncoding, detectAndDecode } from "./encoding"
import { DEFAULT_SPLIT_RANGE, parseStructure, splitByRange, type ParsedVolume } from "./structure"
import { cleanText, emptyCleanSummary, type CleanSummary } from "./clean"

const PARSER_VERSION = "book-import-v3"

/** 导入建书的默认题材（契约无题材字段，沿用既有题材表首项；建书后可再改）。 */
const IMPORT_DEFAULT_GENRE = "玄幻"

type ImportFailureReason = "encoding-failed" | "invalid-text" | "file-too-large" | "preview-expired"

interface ImportSource {
  bytes: Uint8Array
  text: string
  encoding: NovelImportEncoding
  cleanEnabled: boolean
  fallbackFixedLength: boolean
  splitRange: { min: number; max: number }
  splitMode: NovelSplitMode
}

interface PreviewTokenPayload {
  v: string
  hash: string
  clean: boolean
  enc: NovelImportEncoding
  fixed: boolean
  range: { min: number; max: number }
  mode: NovelSplitMode
}

function importError(message: string, reason: ImportFailureReason) {
  return new NovelImportError({ name: "NovelImportError", data: { message, reason } })
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** 解码 dataUrl；失败以错误值返回（调用方 Effect.fail 收口为类型化错误）。 */
function decodeBytes(dataUrl: string): { bytes: Uint8Array } | { error: NovelImportError } {
  const decoded = decodeDataUrlBytes(dataUrl)
  if (decoded.ok) return { bytes: decoded.bytes }
  if (decoded.reason === "file-too-large") return { error: importError("文件超过 50 MiB 上限", "file-too-large") }
  const message = decoded.reason === "empty" ? "文件内容为空" : "文件内容无效"
  return { error: importError(message, "invalid-text") }
}

/** 解析参数 → 生效文本：显式指定编码优先，否则评分检测；失败返回 null。 */
function decodeSource(bytes: Uint8Array, encoding: NovelImportEncoding | undefined) {
  if (encoding !== undefined) {
    const text = decodeWithEncoding(bytes, encoding)
    return text === null ? null : { text, encoding }
  }
  return detectAndDecode(bytes)
}

/** 备齐解析源：解码失败返回错误值。 */
function prepareSource(input: {
  dataUrl: string
  cleanEnabled: boolean
  encoding?: NovelImportEncoding | undefined
  fallbackFixedLength?: boolean | undefined
  splitRange?: { min: number; max: number } | undefined
  splitMode?: NovelSplitMode | undefined
}): { source: ImportSource } | { error: NovelImportError } {
  const decodedBytes = decodeBytes(input.dataUrl)
  if ("error" in decodedBytes) return decodedBytes
  const decoded = decodeSource(decodedBytes.bytes, input.encoding)
  if (decoded === null) return { error: importError("编码识别失败，请显式指定编码后重试", "encoding-failed") }
  const splitMode = input.splitMode ?? "fast"
  // AI 拆章不做脚本分章，兜底开关与字数范围仅快速拆章生效；默认值仍进 source 供 token 一致性校验
  const splitRange = input.splitRange ?? DEFAULT_SPLIT_RANGE
  if (splitRange.min >= splitRange.max) return { error: importError("字数范围无效：下限须小于上限", "invalid-text") }
  return {
    source: {
      bytes: decodedBytes.bytes,
      text: decoded.text,
      encoding: decoded.encoding,
      cleanEnabled: input.cleanEnabled,
      fallbackFixedLength: input.fallbackFixedLength ?? false,
      splitRange,
      splitMode,
    },
  }
}

/** AI 拆章预估：章节按目标字数中值折算，非最终章数（最终章数由 LLM 组章决定）。 */
function aiEstimate(cleanedText: string): NovelImportAiEstimate {
  const targetMid = (DEFAULT_SPLIT_RANGE.min + DEFAULT_SPLIT_RANGE.max) / 2
  const estimatedChapters = Math.max(1, Math.round(countWords(cleanedText) / targetMid))
  // 每章两次 LLM 调用（组章边界窗口 + 清洗全章读改），收尾一次（简介 + 汇总）
  const llmCalls = estimatedChapters * 2 + 1
  // 量级估算：组章窗口约 4.5k 输入、清洗全章读改约 5k 出入，收尾固定量级
  const tokenEstimate = estimatedChapters * 9500 + 4000
  return { estimatedChapters, llmCalls, tokenEstimate }
}

function cleanForParse(source: ImportSource): { text: string; summary: CleanSummary } {
  return source.cleanEnabled ? cleanText(source.text) : { text: source.text, summary: emptyCleanSummary() }
}

/** 结构解析；未识别边界且开启等长兜底时按固定字数分章（兜底成功清空问题清单）。 */
function parseBook(source: ImportSource, cleanedText: string): {
  volumes: ParsedVolume[]
  issues: NovelImportIssue[]
} {
  const parsed = parseStructure(cleanedText)
  if (parsed.chapterHeadingCount === 0 && source.fallbackFixedLength) {
    return splitByRange(cleanedText, source.splitRange)
  }
  return { volumes: parsed.volumes, issues: parsed.issues }
}

function buildPreviewToken(source: ImportSource): string {
  const payload: PreviewTokenPayload = {
    v: PARSER_VERSION,
    hash: sha256Hex(source.bytes),
    clean: source.cleanEnabled,
    enc: source.encoding,
    fixed: source.fallbackFixedLength,
    range: source.splitRange,
    mode: source.splitMode,
  }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function parsePreviewToken(token: string): PreviewTokenPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    const candidate = parsed as Partial<PreviewTokenPayload>
    if (typeof candidate.v !== "string" || typeof candidate.hash !== "string") return null
    if (typeof candidate.clean !== "boolean" || typeof candidate.fixed !== "boolean") return null
    if (typeof candidate.enc !== "string") return null
    if (typeof candidate.range !== "object" || candidate.range === null) return null
    if (typeof candidate.range.min !== "number" || typeof candidate.range.max !== "number") return null
    if (candidate.mode !== "fast" && candidate.mode !== "ai") return null
    return {
      v: candidate.v,
      hash: candidate.hash,
      clean: candidate.clean,
      enc: candidate.enc,
      fixed: candidate.fixed,
      range: { min: candidate.range.min, max: candidate.range.max },
      mode: candidate.mode,
    }
  } catch {
    return null
  }
}

/** 校验 token 与本次重解析的输入一致性；任一参数漂移即视为预览过期。 */
function validateToken(token: PreviewTokenPayload | null, source: ImportSource): NovelImportError | null {
  if (
    token === null ||
    token.v !== PARSER_VERSION ||
    token.hash !== sha256Hex(source.bytes) ||
    token.clean !== source.cleanEnabled ||
    token.fixed !== source.fallbackFixedLength ||
    token.enc !== source.encoding ||
    token.mode !== source.splitMode ||
    token.range.min !== source.splitRange.min ||
    token.range.max !== source.splitRange.max
  ) {
    return importError("预览已过期，请重新分析后再确认导入", "preview-expired")
  }
  return null
}

/** 文件名去扩展名作为建议书名（取不到回退原文件名）。 */
function suggestedTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "")
  return base.length > 0 ? base : filename
}

export function analyzeImport(directory: string, input: NovelImportAnalyzeInput) {
  return Effect.gen(function* () {
    const prepared = prepareSource(input)
    if ("error" in prepared) return yield* Effect.fail(prepared.error)
    const { source } = prepared
    const cleaned = cleanForParse(source)
    if (source.splitMode === "ai") {
      // AI 拆章（narrative-unit-split）：不做脚本分章，仅输出预估；volumes 为空
      const preview: NovelImportPreview = {
        suggestedTitle: suggestedTitleFromFilename(input.filename),
        encoding: source.encoding,
        volumes: [],
        issues: [],
        cleanSummary: cleaned.summary,
        previewToken: buildPreviewToken(source),
        splitMode: "ai",
        aiEstimate: aiEstimate(cleaned.text),
      }
      return preview
    }
    const parsed = parseBook(source, cleaned.text)
    const preview: NovelImportPreview = {
      suggestedTitle: suggestedTitleFromFilename(input.filename),
      encoding: source.encoding,
      volumes: parsed.volumes.map((volume) => ({
        title: volume.title,
        chapters: volume.chapters.map((chapter) => ({
          title: chapter.title,
          wordCount: countWords(chapter.content),
          contentHash: createHash("sha256").update(chapter.content, "utf8").digest("hex"),
          ...(chapter.special === null ? {} : { special: chapter.special }),
        })),
      })),
      issues: parsed.issues,
      cleanSummary: cleaned.summary,
      previewToken: buildPreviewToken(source),
      splitMode: "fast",
    }
    return preview
  })
}

export function applyImport(directory: string, input: NovelImportApplyInput) {
  return Effect.gen(function* () {
    const prepared = prepareSource(input)
    if ("error" in prepared) return yield* Effect.fail(prepared.error)
    const { source } = prepared
    const tokenError = validateToken(parsePreviewToken(input.previewToken), source)
    if (tokenError !== null) return yield* Effect.fail(tokenError)
    const cleaned = cleanForParse(source)
    if (source.splitMode === "ai") {
      // AI 拆章建书（narrative-unit-split）：单事务建书（书行 + 原文存档文件 + 存档元数据），无卷章。
      // 存档文件写入在事务回调内同步执行，任一步失败整体回滚，工作区不留半成品。
      const novelId = crypto.randomUUID()
      const now = Date.now()
      const db = getDb(directory)
      const archiveRelativePath = `.opennovel/sources/${novelId}.txt`
      yield* Effect.sync(() =>
        withTransaction(db, (tx) => {
          tx.insert(NovelTable)
            .values({
              id: novelId,
              title: input.title,
              genre: IMPORT_DEFAULT_GENRE,
              synopsis: "",
              created_at: now,
              updated_at: now,
              status: "draft",
              content_nature: "general",
              split_mode: "ai",
            })
            .run()
          const archivePath = join(directory, archiveRelativePath)
          mkdirSync(join(archivePath, ".."), { recursive: true })
          writeFileSync(archivePath, source.text, "utf8")
          tx.insert(NovelArchiveTable)
            .values({
              id: crypto.randomUUID(),
              novel_id: novelId,
              content_hash: sha256Hex(source.bytes),
              encoding: source.encoding,
              word_count: countWords(source.text),
              file_path: archiveRelativePath,
              created_at: now,
              updated_at: now,
            })
            .run()
        }),
      )
      const report: NovelImportReport = {
        novelId,
        title: input.title,
        volumeCount: 0,
        chapterCount: 0,
        cleanSummary: cleaned.summary,
        issues: [],
        splitMode: "ai",
      }
      return report
    }
    const parsed = parseBook(source, cleaned.text)
    const chapterCount = parsed.volumes.reduce((total, volume) => total + volume.chapters.length, 0)
    if (chapterCount === 0) {
      return yield* Effect.fail(importError("未识别到章节边界，无法建书；可选择按固定长度分章后重试", "invalid-text"))
    }
    const novelId = crypto.randomUUID()
    const now = Date.now()
    const db = getDb(directory)
    const appliedChapterCount = yield* Effect.sync(() =>
      withTransaction(db, (tx) => {
        tx.insert(NovelTable)
          .values({
            id: novelId,
            title: input.title,
            genre: IMPORT_DEFAULT_GENRE,
            synopsis: "",
            created_at: now,
            updated_at: now,
            status: "draft",
            content_nature: "general",
            split_mode: "fast",
          })
          .run()
        let chapterOrder = 0
        for (const volume of parsed.volumes) {
          const volumeId = volume.title === null ? null : createVolumeTx(tx, novelId, volume.title)
          for (const chapter of volume.chapters) {
            chapterOrder += 1
            createChapterTx(tx, novelId, chapter.title, chapterOrder, volumeId, chapter.content)
          }
        }
        return chapterOrder
      }),
    )
    const report: NovelImportReport = {
      novelId,
      title: input.title,
      volumeCount: parsed.volumes.length,
      chapterCount: appliedChapterCount,
      cleanSummary: cleaned.summary,
      issues: parsed.issues,
      splitMode: "fast",
    }
    return report
  })
}
