/**
 * AI 拆章执行器工具（narrative-unit-split 任务 2.4，design D3/D4）。
 *
 * 三个确定性工具组成组章流水线：import_split_window 从存档拆章游标组句流窗口
 * （前文衔接 + 编号句流 + 后文缓冲）；cutter（LLM）只输出组章结论；
 * import_split_extract 对结论做硬校验（章题强边界、句末、引号闭合、单调）并按
 * 原段落 + cutter 分段点重排章文本；cleaner 修复后由 import_split_commit 以修复后
 * 文本落章并推进游标。落章走导入语义：createChapterTx（volume_id null、status
 * draft、初始正文直接计字数），不经 write_chapter 的裸写门禁与审批闸门；游标推进
 * 与建章同一事务，重试不重复组章、失败暂停保留游标。
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { Schema } from "effect"
import { eq } from "drizzle-orm"
import { countWords } from "@opennovel-ai/schema/schema"
import { buildWordPrefix, isQuoteBalanced, SENTENCE_CUT_CHARS, splitSentenceSpans } from "@opennovel-ai/novel-store/text-split"
import { looksLikeHeadingLine } from "@opennovel-ai/novel-store/heading"
import { defineTool } from "../../v2/effect/tool.js"
import { toolFailure } from "../../v2/effect/tool-failure.js"
import { ChapterTable, createChapterTx, getDb, getNovelArchive, NovelArchiveTable, withTransaction } from "../session-store.js"
import { projectDirFromCtx, resolveNovelId } from "./shared.js"

/** 句流窗口字数硬上限：目标章上限 3000 字 + 50% 缓冲（design D3）。 */
const WINDOW_WORD_CAP = 4500
/** 后文缓冲字数上限：供 cutter 判断边界后情节走向，不属于本章（design D3）。 */
const BUFFER_WORD_CAP = 500
/** 章字数软约束区间（design D1/D3）：只做提示，硬校验由 extract/commit 负责。 */
const SOFT_MIN_WORDS = 2000
const SOFT_MAX_WORDS = 3000
/** cleaner 修复后字数与原章偏差硬校验上限（design D4）：超限拒绝落章。 */
const CLEAN_WORD_DEVIATION = 0.1

/** 句流单元：[start, end) 字符偏移；heading 单元为章题行（强边界信号）。 */
interface SplitUnit {
  readonly start: number
  readonly end: number
  readonly heading: boolean
  readonly headingTitle: string
}

interface SplitContext {
  readonly novelId: string
  readonly cursor: number
  readonly text: string
  readonly prefix: number[]
  readonly units: SplitUnit[]
}

interface WindowRange {
  readonly startIdx: number
  readonly endIdx: number
  /** 后文缓冲区间的末单元下标（闭区间）；无缓冲时等于 endIdx。 */
  readonly bufferEndIdx: number
}

function nextLineEnd(text: string, from: number): number {
  const index = text.indexOf("\n", from)
  return index === -1 ? text.length : index + 1
}

/**
 * 句流单元构建：章题行独占单元（强边界），行间区域按句末 + 引号闭合切分。
 * 存档文本经导入清洗归一，行结构与段落边界可信（cleanText 段落重组约定）。
 */
function buildSentenceUnits(text: string): SplitUnit[] {
  const units: SplitUnit[] = []
  let cursor = 0
  // 纯空白跨度的归宿：并入前单元尾部；若尚无前单元则顺延为下一单元起点。
  // 句流必须平铺无空洞，否则游标对齐与句号语义都会被空单元污染。
  let pendingStart: number | null = null
  while (cursor < text.length) {
    const lineEnd = nextLineEnd(text, cursor)
    const trimmed = text.slice(cursor, lineEnd).trim()
    if (trimmed.length > 0 && looksLikeHeadingLine(trimmed)) {
      units.push({ start: pendingStart ?? cursor, end: lineEnd, heading: true, headingTitle: trimmed })
      pendingStart = null
      cursor = lineEnd
      continue
    }
    let regionEnd = text.length
    let scan = lineEnd
    while (scan < text.length) {
      const stop = nextLineEnd(text, scan)
      if (looksLikeHeadingLine(text.slice(scan, stop).trim())) {
        regionEnd = scan
        break
      }
      scan = stop
    }
    for (const span of splitSentenceSpans(text.slice(cursor, regionEnd))) {
      const start = cursor + span.start
      const end = cursor + span.end
      if (text.slice(start, end).trim().length === 0) {
        const last = units.at(-1)
        if (last !== undefined) units[units.length - 1] = { ...last, end }
        else pendingStart = pendingStart ?? start
        continue
      }
      units.push({ start: pendingStart ?? start, end, heading: false, headingTitle: "" })
      pendingStart = null
    }
    cursor = regionEnd
  }
  return units
}

/**
 * 窗口构建（window 与 extract 共用，保证句号语义完全一致）：
 * 从 startIdx 起累计到字数硬上限，至少 1 句；后文缓冲独立计上限。
 */
function locateWindow(prefix: number[], units: SplitUnit[], startIdx: number): WindowRange {
  let endIdx = startIdx
  while (endIdx + 1 < units.length && prefix[units[endIdx + 1].end] - prefix[units[startIdx].start] <= WINDOW_WORD_CAP) endIdx++
  let bufferEndIdx = endIdx
  while (bufferEndIdx + 1 < units.length && prefix[units[bufferEndIdx + 1].end] - prefix[units[endIdx].end] <= BUFFER_WORD_CAP) bufferEndIdx++
  return { startIdx, endIdx, bufferEndIdx }
}

/** 存档加载：novel 解析 → 存档行 → 文本 → 句流单元与字数前缀表。 */
async function loadSplitContext(novelIdArg: string, directory: string | null | undefined): Promise<SplitContext> {
  const novelId = await resolveNovelId(getDb(directory), novelIdArg)
  const archive = await getNovelArchive(novelId, directory)
  if (!archive)
    throw toolFailure("not_found", "未找到原文存档：AI 拆章仅支持以「AI 拆章」方式导入的书（建书时落档原文）。", { code: "archive_not_found" })
  const absolute = join(projectDirFromCtx(directory), archive.file_path)
  if (!existsSync(absolute))
    throw toolFailure("not_found", "原文存档文件缺失（" + archive.file_path + "）：存档被移动或删除时无法续拆，请重新以 AI 拆章方式导入。", { code: "archive_file_missing" })
  const text = readFileSync(absolute, "utf8")
  if (archive.split_cursor > text.length)
    throw toolFailure("gate_blocked", "拆章游标超出存档文本长度，存档文件与元数据不一致，无法继续组章。", { code: "archive_cursor_corrupt" })
  return { novelId, cursor: archive.split_cursor, text, prefix: buildWordPrefix(text), units: buildSentenceUnits(text) }
}

/** 游标对齐校验：返回窗口起始单元下标；游标必须精确落在句流单元边界。 */
function alignedStartIdx(context: SplitContext, cursor: number): number {
  const startIdx = context.units.findIndex((unit) => unit.start >= cursor)
  if (startIdx === -1)
    throw toolFailure("gate_blocked", "拆章游标已到全书末尾，窗口已耗尽。", { code: "window_exhausted" })
  if (context.units[startIdx].start !== cursor)
    throw toolFailure("gate_blocked", "拆章游标与句流单元不对齐（存档文本可能被外部修改），无法继续组章；请重新以 AI 拆章方式导入。", { code: "cursor_misaligned" })
  return startIdx
}

/** 整数参数校验：LLM 输出与转抄值一律过界检查。 */
function requireInt(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw toolFailure("param_error", label + " 非法：" + value + "（须为 " + min + "-" + max + " 的整数）")
  return value
}

/** 单元文本展示：换行折叠为单空格，仅用于窗口列表展示；切分始终基于字符偏移。 */
function displayUnit(text: string, unit: SplitUnit): string {
  return text.slice(unit.start, unit.end).trim().replace(/\s+/g, " ")
}

/** 前文衔接：游标前最多 2 个句流单元的原文（design D3）。 */
function recentText(text: string, units: SplitUnit[], startIdx: number): string {
  const parts: string[] = []
  for (let index = Math.max(0, startIdx - 2); index < startIdx; index++) parts.push(displayUnit(text, units[index]))
  return parts.length > 0 ? parts.join(" ") : "无（全书开头）"
}

/**
 * 章文本段落重排：存档清洗后每个换行都是段落边界（cleanText 段落重组约定），
 * cutter 分段点仅在落入行内时把该行再切开；空白折叠为统一段落分隔。
 * 只调整空白与段落边界，不改动正文字符（分段不改正文）。
 */
function buildParagraphs(slice: string, cutOffsets: number[]): string[] {
  const boundaries = new Set(cutOffsets)
  const paragraphs: string[] = []
  let cursor = 0
  while (cursor < slice.length) {
    const lineEnd = slice.indexOf("\n", cursor)
    const stop = lineEnd === -1 ? slice.length : lineEnd
    let segmentStart = cursor
    for (let offset = cursor + 1; offset <= stop; offset++) {
      if (boundaries.has(offset)) {
        paragraphs.push(slice.slice(segmentStart, offset))
        segmentStart = offset
      }
    }
    paragraphs.push(slice.slice(segmentStart, stop))
    if (lineEnd === -1) break
    cursor = lineEnd + 1
  }
  return paragraphs.map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0)
}

export const importSplitTools = {
  import_split_window: defineTool({
    description:
      "AI 拆章第一步：从原文存档的拆章游标处组一个句流窗口（前文衔接 + 编号句流 + 后文缓冲），供 cutter 选章末句。仅支持以 AI 拆章方式导入的书。",
    args: Schema.Struct({
      novel_id: Schema.optional(Schema.String.annotate({ description: "小说 ID；绑定会话可不传，单书自动解析" })),
    }),
    execute: async (args, ctx) => {
      const context = await loadSplitContext(args.novel_id ?? "", ctx.directory)
      const startIdx = context.units.findIndex((unit) => unit.start >= context.cursor)
      if (startIdx === -1) {
        return {
          title: "import_split_window",
          output: "拆章游标已到全书末尾，组章完成，无剩余窗口。",
          metadata: { novel_id: context.novelId, exhausted: true },
        }
      }
      if (context.units[startIdx].start !== context.cursor)
        throw toolFailure("gate_blocked", "拆章游标与句流单元不对齐（存档文本可能被外部修改），无法继续组章；请重新以 AI 拆章方式导入。", { code: "cursor_misaligned" })
      const range = locateWindow(context.prefix, context.units, startIdx)
      const windowWordCount = context.prefix[context.units[range.endIdx].end] - context.prefix[context.units[range.startIdx].start]
      const remaining = context.prefix[context.text.length] - context.prefix[context.units[range.endIdx].end]
      const lines: string[] = ["【前文衔接】", recentText(context.text, context.units, startIdx)]
      lines.push("", "【句流窗口】（句号 1-" + (range.endIdx - range.startIdx + 1) + "，约 " + windowWordCount + " 字）")
      for (let index = range.startIdx; index <= range.endIdx; index++) {
        const unit = context.units[index]
        const number = index - range.startIdx + 1
        lines.push(unit.heading ? "【章题】" + number + ". " + unit.headingTitle : number + ". " + displayUnit(context.text, unit))
      }
      lines.push("", "【后文缓冲】（不属于本章）")
      lines.push(
        range.bufferEndIdx > range.endIdx
          ? context.text.slice(context.units[range.endIdx].end, context.units[range.bufferEndIdx].end).trim().replace(/\s+/g, " ")
          : "无（已到全书末尾）",
      )
      lines.push(
        "",
        remaining === 0
          ? "提示：窗口已覆盖到全书末尾。"
          : windowWordCount < SOFT_MIN_WORDS
            ? "提示：窗口仅约 " + windowWordCount + " 字，低于目标下限 " + SOFT_MIN_WORDS + "，可能临近全书结尾。"
            : "提示：窗口后仍剩约 " + remaining + " 字。",
      )
      return {
        title: "import_split_window",
        output: lines.join("\n"),
        metadata: {
          novel_id: context.novelId,
          window_cursor: context.cursor,
          sentence_count: range.endIdx - range.startIdx + 1,
          window_word_count: windowWordCount,
          remaining_word_count: remaining,
          exhausted: false,
        },
      }
    },
  }),

  import_split_extract: defineTool({
    description:
      "AI 拆章第二步：对 cutter 的组章结论做硬校验（章题强边界、句末、引号闭合、游标一致），切出章文本（原段落 + cutter 分段点重排）并返回落章所需偏移与字数。",
    args: Schema.Struct({
      novel_id: Schema.optional(Schema.String.annotate({ description: "小说 ID；绑定会话可不传，单书自动解析" })),
      window_cursor: Schema.Number.annotate({ description: "import_split_window 元数据中的拆章游标" }),
      end_sentence: Schema.Number.annotate({ description: "章末句号（相对句流窗口，1 起）" }),
      segments: Schema.optional(Schema.Array(Schema.Number).annotate({ description: "章内新段落起始句号列表（升序，不含 1）" })),
    }),
    execute: async (args, ctx) => {
      const context = await loadSplitContext(args.novel_id ?? "", ctx.directory)
      const cursor = requireInt(args.window_cursor, "window_cursor", 0, context.text.length)
      if (context.cursor !== cursor)
        throw toolFailure("gate_blocked", "拆章游标已推进（当前 " + context.cursor + " 不等于窗口 " + cursor + "），窗口过期：请重新执行 import_split_window，不得基于过期窗口切章。", { code: "cursor_advanced" })
      const range = locateWindow(context.prefix, context.units, alignedStartIdx(context, cursor))
      const windowLen = range.endIdx - range.startIdx + 1
      const endSentence = requireInt(args.end_sentence, "end_sentence", 1, windowLen)
      let previousSegment = 0
      for (const segment of args.segments ?? []) {
        const value = requireInt(segment, "segments 项", 2, endSentence)
        if (value <= previousSegment)
          throw toolFailure("param_error", "segments 须严格递增：" + value + " 不大于前值 " + previousSegment)
        previousSegment = value
      }
      // 章题强边界（design D3）：窗口内第一个章题单元（句号至少为 2）处必须收章
      let headingSentence: number | null = null
      for (let index = range.startIdx + 1; index <= range.endIdx; index++) {
        if (context.units[index].heading) {
          headingSentence = index - range.startIdx + 1
          break
        }
      }
      if (headingSentence !== null && endSentence !== headingSentence - 1)
        throw toolFailure(
          "content_rejected",
          "章题强边界：句号 " + headingSentence + " 是章题行，原书自带连续章题时章末句必须为其前一句 " + (headingSentence - 1) + "，收到 " + endSentence + "。",
        )
      const endUnit = context.units[range.startIdx + endSentence - 1]
      if (endUnit.heading)
        throw toolFailure("content_rejected", "章末句不能是章题行：章题行属于下一章。")
      const chapterStart = context.units[range.startIdx].start
      const chapterEnd = endUnit.end
      const lastChar = context.text.slice(chapterStart, chapterEnd).trimEnd().at(-1)
      if (lastChar === undefined || !SENTENCE_CUT_CHARS.has(lastChar))
        throw toolFailure("content_rejected", "章末句硬校验失败：末字符不是句末标点，不得在句中收章。")
      if (!isQuoteBalanced(context.text, chapterStart, chapterEnd))
        throw toolFailure("content_rejected", "章末句硬校验失败：收章处引号未闭合，不得在对话中途收章。")
      const rawSlice = context.text.slice(chapterStart, chapterEnd)
      const cutOffsets = (args.segments ?? []).map((segment) => context.units[range.startIdx + segment - 1].start - chapterStart)
      const paragraphs = buildParagraphs(rawSlice, cutOffsets)
      const chapterText = paragraphs.join("\n\n")
      const rawWordCount = countWords(chapterText)
      if (rawWordCount === 0)
        throw toolFailure("content_rejected", "切出的章文本为空，无法组章。")
      const softHint =
        rawWordCount < SOFT_MIN_WORDS
          ? "章字数约 " + rawWordCount + "，低于软约束下限 " + SOFT_MIN_WORDS + "：若非临近结尾，请重选边界。"
          : rawWordCount > SOFT_MAX_WORDS
            ? "章字数约 " + rawWordCount + "，超出软约束上限 " + SOFT_MAX_WORDS + "：叙事完整性优先，但优先考虑再拆。"
            : "章字数约 " + rawWordCount + "，在软约束区间内。"
      const titleHint = context.units[range.startIdx].heading ? context.units[range.startIdx].headingTitle : null
      return {
        title: "import_split_extract",
        output: [
          "已切出章文本：约 " + rawWordCount + " 字、" + paragraphs.length + " 段。",
          softHint,
          titleHint !== null ? "存档章题（title_hint）：" + titleHint : "本窗口无存档章题，章题由 cutter 拟定。",
          "下一步：将章节全文交给 cleaner 单读修复（错字/噪声/段落，保留段落结构），修复后以 extract 元数据调用 import_split_commit 落章；commit 校验修复后字数偏差不超过 10%。",
        ].join("\n"),
        metadata: {
          novel_id: context.novelId,
          window_cursor: cursor,
          end_offset: chapterEnd,
          raw_word_count: rawWordCount,
          paragraph_count: paragraphs.length,
          chapter_text: chapterText,
          title_hint: titleHint,
        },
      }
    },
  }),

  import_split_commit: defineTool({
    description:
      "AI 拆章第三步：以 cleaner 修复后的章文本落章（导入语义：不分组、draft、初始正文直接计字数），校验字数偏差不超过 10% 与游标一致性，同事务推进拆章游标。",
    args: Schema.Struct({
      novel_id: Schema.optional(Schema.String.annotate({ description: "小说 ID；绑定会话可不传，单书自动解析" })),
      title: Schema.String.annotate({ description: "章题" }),
      content: Schema.String.annotate({ description: "cleaner 修复后的章正文（保留 extract 返回的段落结构）" }),
      window_cursor: Schema.Number.annotate({ description: "import_split_extract 元数据中的窗口游标" }),
      end_offset: Schema.Number.annotate({ description: "import_split_extract 元数据中的章末偏移" }),
      raw_word_count: Schema.Number.annotate({ description: "import_split_extract 元数据中的原章字数" }),
    }),
    execute: async (args, ctx) => {
      const context = await loadSplitContext(args.novel_id ?? "", ctx.directory)
      const cursor = requireInt(args.window_cursor, "window_cursor", 0, context.text.length)
      const endOffset = requireInt(args.end_offset, "end_offset", 1, context.text.length)
      if (endOffset <= cursor)
        throw toolFailure("param_error", "end_offset 必须大于 window_cursor：" + endOffset + " 不大于 " + cursor + "，游标不得倒退。")
      if (context.cursor !== cursor)
        throw toolFailure("gate_blocked", "拆章游标已推进（当前 " + context.cursor + " 不等于窗口 " + cursor + "）：该章可能已落库或窗口过期，请重新执行 import_split_window，不得重复落章。", { code: "cursor_advanced" })
      const slice = context.text.slice(cursor, endOffset)
      const lastChar = slice.trimEnd().at(-1)
      if (lastChar === undefined || !SENTENCE_CUT_CHARS.has(lastChar))
        throw toolFailure("content_rejected", "落章硬校验失败：章末偏移不在句末标点之后。")
      if (!isQuoteBalanced(context.text, cursor, endOffset))
        throw toolFailure("content_rejected", "落章硬校验失败：章末偏移处引号未闭合。")
      const sliceWordCount = countWords(slice)
      const rawWordCount = requireInt(args.raw_word_count, "raw_word_count", 1, Number.MAX_SAFE_INTEGER)
      if (rawWordCount !== sliceWordCount)
        throw toolFailure("param_error", "raw_word_count 与存档切片字数不符：应为 " + sliceWordCount + "，收到 " + rawWordCount + "。请使用 import_split_extract 返回的元数据。")
      const title = args.title.trim()
      if (title.length === 0) throw toolFailure("param_error", "章题不能为空。")
      const content = args.content.trim()
      if (content.length === 0) throw toolFailure("param_error", "章正文不能为空。")
      const wordCount = countWords(content)
      const deviation = Math.abs(wordCount - rawWordCount) / rawWordCount
      if (deviation > CLEAN_WORD_DEVIATION)
        throw toolFailure(
          "content_rejected",
          "修复后字数偏差 " + (deviation * 100).toFixed(1) + "% 超过 10% 上限（原章约 " + rawWordCount + " 字，修复后约 " + wordCount + " 字）。请降级为仅结构清洗（分段与噪声，不改正文用词）后重新提交。",
        )
      const chapterId = withTransaction(getDb(ctx.directory), (tx) => {
        const id = createChapterTx(tx, context.novelId, title, undefined, null, content)
        tx.update(NovelArchiveTable)
          .set({ split_cursor: endOffset, updated_at: Date.now() })
          .where(eq(NovelArchiveTable.novel_id, context.novelId))
          .run()
        return id
      })
      const [chapter] = getDb(ctx.directory)
        .select({ order: ChapterTable.order, word_count: ChapterTable.word_count })
        .from(ChapterTable)
        .where(eq(ChapterTable.id, chapterId))
        .all()
      const remaining = context.prefix[context.text.length] - context.prefix[endOffset]
      return {
        title: "import_split_commit",
        output: [
          "第 " + (chapter?.order ?? "?") + " 章已创建（不分组、draft）：" + title + "，约 " + wordCount + " 字。",
          "拆章游标推进至 " + endOffset + "，剩余约 " + remaining + " 字" + (remaining === 0 ? "，全书组章完成。" : "。"),
        ].join("\n"),
        metadata: {
          novel_id: context.novelId,
          chapter_id: chapterId,
          order: chapter?.order ?? null,
          word_count: wordCount,
          split_cursor: endOffset,
          remaining_word_count: remaining,
        },
      }
    },
  }),
}
