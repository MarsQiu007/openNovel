/**
 * chapter 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { and, asc, eq, sql } from "drizzle-orm"
import { countWords } from "@opennovel-ai/schema/schema"
import { defineTool } from "../../v2/effect/tool.js"
import { toolFailure } from "../../v2/effect/tool-failure.js"
import {
  advanceWritingBatch,
  applyRestructure,
  beginWritingBatch,
  ChapterReviewTable,
  ChapterSummaryTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterTable,
  consolidateChapterFacts,
  deleteChapter,
  getDb,
  getWritingBatch,
  invalidateChapterFactsByQuote,
  NovelTable,
  PendingUpdateTable,
  readNovelConfig,
  rebuildNextChapterSnapshot,
  repairChapterSequence,
  simulateRestructure,
  updateChapter,
  WorldEntryTable,
  writingBatchCompleted,
  type RestructureOp,
} from "../session-store.js"
import { scanReferences } from "../state-commit.js"
import { detectKinshipEntityDrift, loadCharacterBindingView } from "../drift-guards.js"
import {
  checkChapterLengthGate,
  checkChapterSequentialGate,
  checkDuplicateRatio,
  detectCoordinateLeak,
  detectOutlineLabels,
  getChapterLengthMax,
  getFirstUnpassedChapter,
  getTargetWordCount,
} from "./chapter-guards.js"
import { detectFixedSplit } from "../detect-fixed-split.js"
import { nextVersion, projectDirFromCtx, resolveNovelId } from "./shared.js"
import { recordMetrics, recordMetricsBatch } from "../evaluate/metrics.js"

export const chapterTools = {
  write_chapter: defineTool({
    description: "撰写小说章节内容。将生成的章节正文写入数据库，并归档一个历史版本。若章节已存在正文则覆盖。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      content: Schema.String.annotate({ description: "章节正文" }),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
      if (!chapter)
        throw toolFailure(
          "not_found",
          `章节不存在：${args.chapter_id}。请先用 list_chapters 定位真实章节 ID；若章节尚不存在，可先派发 @outliner 生成章纲创建章节。`,
          { code: "chapter_not_found" },
        )

      // 新书兜底：完全无核心设定时禁止静默裸写第一章，但保留旧书和已有设定项目的写作路径。
      if (chapter.order === 1 && chapter.content.length === 0) {
        const characters = await db
          .select({ id: CharacterTable.id })
          .from(CharacterTable)
          .where(eq(CharacterTable.novel_id, chapter.novel_id))
          .all()
        const worldEntries = await db
          .select({ id: WorldEntryTable.id })
          .from(WorldEntryTable)
          .where(eq(WorldEntryTable.novel_id, chapter.novel_id))
          .all()
        if (characters.length === 0 && worldEntries.length === 0) {
          throw toolFailure(
            "gate_blocked",
            "当前小说还没有角色或世界观设定。请先初始化小说设定（生成故事圣经、题材规则和核心设定），再写第一章。",
          )
        }
      }

      // 顺序门禁：review 模式逐章串行——前置章节未全部通过审批时，不得写后续章节正文
      const firstUnpassed =
        readNovelConfig(projectDirFromCtx(ctx.directory)).writing_mode === "review"
          ? await getFirstUnpassedChapter(db, chapter.novel_id, chapter.order)
          : null
      checkChapterSequentialGate("write_chapter", firstUnpassed)

      const pendingCount = await db
        .select({ id: PendingUpdateTable.id, priority: PendingUpdateTable.priority })
        .from(PendingUpdateTable)
        .where(and(eq(PendingUpdateTable.novel_id, chapter.novel_id), eq(PendingUpdateTable.status, "pending")))
        .all()
      if (pendingCount.length > 0) {
        const highCount = pendingCount.filter((t) => t.priority === "high").length
        throw toolFailure(
          "gate_blocked",
          `当前小说有 ${pendingCount.length} 个未完成影响任务（高优先级 ${highCount} 个）未处理，不能写新章节。先用 cascade_list_pending 查看任务列表与证据，处理后调用 cascade_execute 批量执行；确需跳过用 cascade_resolve 标记 skipped。门禁将在任务清零后解除。`,
        )
      }

      // 字数校验：下限常驻硬约束；上限存在时区间双向拒绝（非法/≤下限组合已降级为不设上限）
      const target = await getTargetWordCount(db, chapter.novel_id)
      const upper = await getChapterLengthMax(db, chapter.novel_id, target)
      const wordCount = countWords(args.content)
      checkChapterLengthGate("write_chapter", wordCount, target, upper)

      // 大纲标签校验：禁止把章纲模板/节拍标签写进读者正文
      const outlineLeaks = detectOutlineLabels(args.content)
      if (outlineLeaks.length > 0) {
        throw toolFailure(
          "content_rejected",
          `正文不能包含大纲/节拍标签或编号分段，例如：${outlineLeaks.join(" / ")}。请将这些提纲转化为连续小说正文，用自然段落和场景转换表达，去掉所有标题、编号和【】标签后重新调用 write_chapter。`,
        )
      }

      const coordLeak = detectCoordinateLeak(args.content)
      if (coordLeak.length > 0) {
        throw toolFailure(
          "content_rejected",
          `正文不能将「第N章」「第N卷」等书籍控制层坐标作为叙事时间使用，例如：${coordLeak.join(" / ")}。请将坐标转换为故事层时间表达（如"三日前""当夜""上月""去年""那时"）或因果衔接后重新调用 write_chapter。`,
        )
      }

      // 重复度校验：与前文章节重复（照抄或开头场景重演）拒绝写入，防止重写已写过的内容
      const dup = await checkDuplicateRatio(db, chapter.novel_id, args.content, chapter.order)
      if (dup.duplicate) {
        const why =
          dup.openingRatio > 0.05
            ? `本章开头与前文章节高度相似（相似度约 ${Math.round(dup.openingRatio * 100)}%）`
            : `约 ${Math.round(dup.ratio * 100)}% 的段落与前文相同`
        throw toolFailure(
          "content_rejected",
          `检测到与前文章节重复的内容：${why}。例如：${dup.samples.join(" / ")}。禁止重复已写章节的事件和场景，请承接上一章结尾之后重写后重新调用 write_chapter。`,
        )
      }

      // 保守称谓守卫：不阻止写入，但把疑似称谓实体化问题交给后续 auditor 判断
      const bindingView = await loadCharacterBindingView(db, chapter.novel_id, args.content)
      const kinshipFindings = detectKinshipEntityDrift(args.content, bindingView)
      // 自评价埋点：称谓守卫检查次数与命中（C2；命中交给 auditor，属警告级不硬拦）
      recordMetricsBatch(projectDirFromCtx(ctx.directory), [
        { domain: "c2-prompt-control", key: "driftguard.checked", delta: 1 },
        ...(kinshipFindings.length > 0
          ? [{ domain: "c2-prompt-control", key: "driftguard.finding", delta: kinshipFindings.length }]
          : []),
      ])

      // 归档当前正文为历史版本（仅当已有正文时）
      if (chapter.content.length > 0) {
        await db
          .insert(ChapterVersionTable)
          .values({
            id: crypto.randomUUID(),
            chapter_id: chapter.id,
            version: await nextVersion(db, chapter.id),
            content: chapter.content,
            word_count: chapter.word_count,
            created_by: ctx.agent,
          })
          .run()
      }

      const now = Date.now()
      await db
        .update(ChapterTable)
        .set({ content: args.content, word_count: wordCount, status: "draft", updated_at: now })
        .where(eq(ChapterTable.id, args.chapter_id))
        .run()

      await scanReferences(db, chapter.novel_id, "chapter", args.chapter_id, "content", args.content)

      // 记忆生命周期（agent-memory-system §3）：正文变更后，逐字引句已不在新正文中的事实 → stale
      const staleFacts = invalidateChapterFactsByQuote(db, chapter.novel_id, args.chapter_id, args.content)

      const driftWarning =
        kinshipFindings.length > 0
          ? `
⚠️ 称谓守卫审计提示：${kinshipFindings.map((finding) => finding.message).join(" ")} 原文证据：${kinshipFindings.map((finding) => finding.evidence).join(" / ")}。请在 auditor 审计中检查关系连续性。`
          : ""
      return {
        title: "write_chapter",
        output: `已写入第${chapter.order}章「${chapter.title}」：${wordCount}字（${upper ? `下限 ${target} / 上限 ${upper} 字` : `下限≥${target}字`}）${driftWarning}`,
        metadata: {
          chapter_id: args.chapter_id,
          word_count: wordCount,
          stale_facts: staleFacts.length,
          audit_prompts:
            kinshipFindings.length > 0
              ? kinshipFindings.map((finding) => `${finding.message} 原文证据：${finding.evidence}`)
              : [],
        },
      }
    },
  }),
  revise_chapter: defineTool({
    description: "修改已生成的章节内容。先归档旧版本，再用新正文覆盖。用于审计失败后的自动修订或人工修改。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      revision: Schema.String.annotate({ description: "修订后的完整章节正文（非修改意见）" }),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
      if (!chapter)
        throw toolFailure(
          "not_found",
          `章节不存在：${args.chapter_id}。请先用 list_chapters 定位真实章节 ID；若章节尚不存在，可先派发 @outliner 生成章纲创建章节。`,
          { code: "chapter_not_found" },
        )
      if (chapter.content.length === 0)
        throw toolFailure(
          "state_conflict",
          `章节尚无正文，无法修订：${args.chapter_id}。空章节请改用 write_chapter 写入正文。`,
        )
      if (typeof args.revision !== "string" || args.revision.trim().length === 0)
        throw toolFailure(
          "param_error",
          "缺少 revision：请传入 chapter_id 和 revision（修订后的完整章节正文），正文参数名是 revision，不是 content。",
        )

      // 顺序门禁：review 模式逐章串行——前置章节未全部通过审批时，不得修订后续章节正文
      const firstUnpassed =
        readNovelConfig(projectDirFromCtx(ctx.directory)).writing_mode === "review"
          ? await getFirstUnpassedChapter(db, chapter.novel_id, chapter.order)
          : null
      checkChapterSequentialGate("revise_chapter", firstUnpassed)

      const pendingCount = await db
        .select({ id: PendingUpdateTable.id, priority: PendingUpdateTable.priority })
        .from(PendingUpdateTable)
        .where(and(eq(PendingUpdateTable.novel_id, chapter.novel_id), eq(PendingUpdateTable.status, "pending")))
        .all()
      if (pendingCount.length > 0) {
        const highCount = pendingCount.filter((t) => t.priority === "high").length
        throw toolFailure(
          "gate_blocked",
          `当前小说有 ${pendingCount.length} 个未完成影响任务（高优先级 ${highCount} 个）未处理，不能修订章节。先用 cascade_list_pending 查看任务列表与证据，处理后调用 cascade_execute 批量执行；确需跳过用 cascade_resolve 标记 skipped。门禁将在任务清零后解除。`,
        )
      }

      // 修订后仍需满足字数区间：下限常驻（防止修订改少）；上限存在时双向校验（非法/≤下限组合已降级为不设上限）
      const target = await getTargetWordCount(db, chapter.novel_id)
      const upper = await getChapterLengthMax(db, chapter.novel_id, target)
      const wordCount = countWords(args.revision)
      checkChapterLengthGate("revise_chapter", wordCount, target, upper)

      // 大纲标签校验：修订时同样禁止把章纲模板/节拍标签写进正文
      const outlineLeaks = detectOutlineLabels(args.revision)
      if (outlineLeaks.length > 0) {
        throw toolFailure(
          "content_rejected",
          `修订正文不能包含大纲/节拍标签或编号分段，例如：${outlineLeaks.join(" / ")}。请改为连续小说正文，去掉所有标题、编号和【】标签后重新调用 revise_chapter。`,
        )
      }

      const coordLeak = detectCoordinateLeak(args.revision)
      if (coordLeak.length > 0) {
        throw toolFailure(
          "content_rejected",
          `修订正文不能将「第N章」「第N卷」等书籍控制层坐标作为叙事时间使用，例如：${coordLeak.join(" / ")}。请将坐标转换为故事层时间表达后重新调用 revise_chapter。`,
        )
      }
      const dup = await checkDuplicateRatio(db, chapter.novel_id, args.revision, chapter.order)
      if (dup.duplicate) {
        const why =
          dup.openingRatio > 0.05
            ? `修订后开头与前文章节高度相似（相似度约 ${Math.round(dup.openingRatio * 100)}%）`
            : `约 ${Math.round(dup.ratio * 100)}% 的段落与前文相同`
        throw toolFailure(
          "content_rejected",
          `检测到修订内容与前文章节重复：${why}。例如：${dup.samples.join(" / ")}。禁止重复已写章节的事件和场景，请重写重复部分后重新调用 revise_chapter。`,
        )
      }

      // 归档修订前版本
      await db
        .insert(ChapterVersionTable)
        .values({
          id: crypto.randomUUID(),
          chapter_id: chapter.id,
          version: await nextVersion(db, chapter.id),
          content: chapter.content,
          word_count: chapter.word_count,
          created_by: ctx.agent,
        })
        .run()

      const now = Date.now()
      await db
        .update(ChapterTable)
        .set({ content: args.revision, word_count: wordCount, status: "revised", updated_at: now })
        .where(eq(ChapterTable.id, args.chapter_id))
        .run()

      await scanReferences(db, chapter.novel_id, "chapter", args.chapter_id, "content", args.revision)

      // 记忆生命周期：修订正文后同样做引句失效判定
      const staleFacts = invalidateChapterFactsByQuote(db, chapter.novel_id, args.chapter_id, args.revision)

      return {
        title: "revise_chapter",
        output: `已修订第${chapter.order}章「${chapter.title}」：${wordCount}字（${upper ? `下限 ${target} / 上限 ${upper} 字` : `下限≥${target}字`}）`,
        metadata: { chapter_id: args.chapter_id, word_count: wordCount, stale_facts: staleFacts.length },
      }
    },
  }),
  begin_writing_batch: defineTool({
    description:
      "登记批量写作任务。连续多章批量写作的首步：持久化批量意图（起始章/总数/发起会话），供崩溃中断后的断点续跑与进度查询。同书新批量整体替换旧记录。单章写作不要调用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      start_chapter: Schema.Number.annotate({ description: "批量起始章节序号（从 1 开始）" }),
      total: Schema.Number.annotate({ description: "批量总章数" }),
    }),
    execute: async (args, ctx) => {
      if (!Number.isInteger(args.start_chapter) || args.start_chapter < 1)
        throw toolFailure("param_error", `起始章序号无效：${args.start_chapter}（须为 ≥1 的整数）`)
      if (!Number.isInteger(args.total) || args.total < 1)
        throw toolFailure("param_error", `批量总章数无效：${args.total}（须为 ≥1 的整数）`)
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const [novel] = await db.select({ id: NovelTable.id }).from(NovelTable).where(eq(NovelTable.id, novelId)).all()
      if (!novel) throw toolFailure("not_found", `小说不存在：${args.novel_id}。请先用 list_novels 列举真实小说 ID。`, { code: "novel_not_found" })
      await beginWritingBatch(
        { novelId, sessionId: ctx.sessionID, startChapter: args.start_chapter, total: args.total },
        ctx.directory,
      )
      return {
        title: "begin_writing_batch",
        output: `已登记批量写作：第${args.start_chapter}章起共${args.total}章。每章完成后由 advance_chapter 自动推进持久化进度；中断后可按持久化进度续跑。`,
        metadata: { novel_id: novelId, start_chapter: args.start_chapter, total: args.total },
      }
    },
  }),
  get_writing_batch: defineTool({
    description:
      "查询批量写作任务进度。返回批量记录（起始章/总数/已完成/状态/发起会话），供断点续跑判定与进度汇报；无批量任务时明确返回空。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const batch = await getWritingBatch(novelId, ctx.directory)
      if (!batch) return { title: "get_writing_batch", output: "当前没有批量写作任务记录。" }
      const statusLabel =
        batch.status === "running"
          ? "进行中"
          : batch.status === "completed"
            ? "已完成"
            : batch.status === "cancelled"
              ? "已放弃"
              : batch.status
      return {
        title: "get_writing_batch",
        output: `批量写作任务：第${batch.start_chapter}章起共${batch.total}章，已完成${writingBatchCompleted(batch)}章，状态：${statusLabel}。`,
        metadata: {
          novel_id: batch.novel_id,
          session_id: batch.session_id,
          start_chapter: batch.start_chapter,
          total: batch.total,
          completed: writingBatchCompleted(batch),
          status: batch.status,
        },
      }
    },
  }),
  advance_chapter: defineTool({
    description:
      "推进到下一章。返回下一章序号，流水线步骤8（next）。批量写作时同步推进持久化批量进度（单调、重跑幂等；无 running 批量的单章写作静默跳过）。卷级汇总在新卷首章生成大纲时由 generate_chapter_outline 自动触发，本工具不负责。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      chapter_number: Schema.Number.annotate({ description: "当前章节序号" }),
    }),
    execute: async (args, ctx) => {
      const nextChapter = args.chapter_number + 1
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      await advanceWritingBatch(novelId, args.chapter_number, ctx.directory)
      const batch = await getWritingBatch(novelId, ctx.directory)
      const progress = batch && batch.status !== "cancelled" ? `（批量进度 ${writingBatchCompleted(batch)}/${batch.total}）` : ""
      return {
        title: "advance_chapter",
        output: `流水线完成，下一章为第${nextChapter}章${progress}`,
        metadata: { next_chapter: nextChapter },
      }
    },
  }),
  read_chapter_content: defineTool({
    description:
      "读取章节正文内容。返回完整的章节正文文本，供 observer/auditor 分析使用。可通过 chapter_id（UUID）或 chapter_number（章节序号，从 1 开始）定位章节，二选一即可。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      chapter_id: Schema.optional(
        Schema.String.annotate({ description: "章节 ID（UUID）。与 chapter_number 二选一。" }),
      ),
      chapter_number: Schema.optional(
        Schema.Number.annotate({ description: "章节序号（从 1 开始）。与 chapter_id 二选一。" }),
      ),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      if (!args.chapter_id && args.chapter_number === undefined) {
        throw toolFailure("param_error", "请提供 chapter_id 或 chapter_number 之一")
      }
      const chapter = args.chapter_id
        ? await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).get()
        : await db
            .select()
            .from(ChapterTable)
            .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, args.chapter_number!)))
            .get()
      if (!chapter) {
        const locator = args.chapter_id ? `ID：${args.chapter_id}` : `第${args.chapter_number}章`
        throw toolFailure(
          "not_found",
          `章节不存在：${locator}。请先用 list_chapters 定位真实章节序号或 ID；若章节尚不存在，可先派发 @outliner 生成章纲创建章节。`,
          { code: "chapter_not_found" },
        )
      }
      return {
        title: "read_chapter_content",
        output: chapter.content.length > 0 ? chapter.content : "章节正文为空",
        metadata: { chapter_id: chapter.id, chapter_number: chapter.order, word_count: chapter.word_count },
      }
    },
  }),
  list_chapters: defineTool({
    description: "列出小说所有章节。返回章节 UUID、序号、标题、字数、状态，供 agent 在读写正文前定位章节。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const chapters = await db
        .select({
          id: ChapterTable.id,
          chapter_number: ChapterTable.order,
          title: ChapterTable.title,
          word_count: ChapterTable.word_count,
          status: ChapterTable.status,
        })
        .from(ChapterTable)
        .where(eq(ChapterTable.novel_id, novelId))
        .orderBy(asc(ChapterTable.order))
        .all()
      if (chapters.length === 0) {
        return { title: "list_chapters", output: `小说 ${novelId} 暂无章节记录` }
      }
      const lines = chapters.map(
        (c) => `第${c.chapter_number}章 | ${c.title} | ${c.word_count}字 | ${c.status} | ${c.id}`,
      )
      // 固定分章特征（fixed-split-restructure）：命中时编排会话须先做分章体检再建整理队列
      const fixedSplit = detectFixedSplit(chapters.map((c) => ({ title: c.title, wordCount: c.word_count })))
      return {
        title: "list_chapters",
        output:
          (fixedSplit
            ? "检测到固定长度分章特征（fixed_split=true）：本书为机械等长分章，导入整理建队前应先做分章体检与确认式重切。\n"
            : "") + lines.join("\n"),
        metadata: { count: chapters.length, chapters, fixed_split: fixedSplit },
      }
    },
  }),
  update_chapter: defineTool({
    description:
      "更新章节标题或状态。可通过 chapter_id（UUID）或 chapter_number（章节序号，从 1 开始）定位章节，二选一。\n" +
      "**章节标识来源**：章节标识必须来自 list_chapters、read_chapter_outline 或章纲生成等工具的真实返回，禁止自行构造。\n" +
      "**审批门禁**：项目 writing_mode=review 时，禁止直接设 status=final（必须走阅读页审批流 — 调 submitApproval 工具）；auto 模式下允许。其他状态（draft/pending_review/rejected/audited/revised/published）按需可设。\n" +
      "正文内容请用 write_chapter/revise_chapter，不要用本工具写正文。",
    args: Schema.Struct({
      novel_id: Schema.optional(
        Schema.String.annotate({ description: "小说 ID（可选）。不传且库内仅一本小说时自动解析；库内多本小说时必须提供。" }),
      ),
      chapter_id: Schema.optional(
        Schema.String.annotate({
          description:
            "章节 ID（UUID）。必须来自 list_chapters / read_chapter_outline / 章纲生成等工具的真实返回，禁止自行构造。与 chapter_number 二选一。",
        }),
      ),
      chapter_number: Schema.optional(
        Schema.Number.annotate({ description: "章节序号（从 1 开始）。与 chapter_id 二选一。" }),
      ),
      title: Schema.optional(Schema.String.annotate({ description: "新的章节标题（不传则不改）" })),
      status: Schema.optional(
        Schema.String.annotate({
          description:
            "新的章节状态：planned/outline/draft/drafting/audited/revised/pending_review/final/rejected/published/failed（不传则不改）",
        }),
      ),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      if (!args.chapter_id && args.chapter_number === undefined) {
        throw toolFailure("param_error", "请提供 chapter_id 或 chapter_number 之一")
      }
      const novelId = args.novel_id !== undefined
        ? await resolveNovelId(db, args.novel_id)
        : await resolveOwnedNovelId(db)
      const chapter = args.chapter_id
        ? db
            .select()
            .from(ChapterTable)
            .where(and(eq(ChapterTable.id, args.chapter_id), eq(ChapterTable.novel_id, novelId)))
            .get()
        : db
            .select()
            .from(ChapterTable)
            .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, args.chapter_number!)))
            .get()
      if (!chapter) {
        const locator = args.chapter_id ? `ID：${args.chapter_id}` : `第${args.chapter_number}章`
        throw toolFailure(
          "not_found",
          `章节不存在：${locator}。请先用 list_chapters（或读取章纲）定位真实章节序号或 ID；若章节尚不存在，可先派发 @outliner 生成章纲创建章节。`,
          { code: "chapter_not_found" },
        )
      }
      const fields: { title?: string; status?: string } = {}
      if (args.title !== undefined) fields.title = args.title
      if (args.status !== undefined) fields.status = args.status
      if (Object.keys(fields).length === 0) {
        throw toolFailure("param_error", "未提供任何要更新的字段：请传入 title 或 status 之一。")
      }

      // 审批门禁：review 模式下禁止直接设 final/published — 必须走审批流
      if (args.status !== undefined) {
        const mode = readNovelConfig(projectDirFromCtx(ctx.directory))
        if (mode.writing_mode === "review" && (args.status === "final" || args.status === "published")) {
          throw toolFailure(
            "gate_blocked",
            `当前项目写作模式为 review，禁止直接设 status=${args.status}。` +
              `必须先在阅读页提交审批（submitApproval 工具）或用户在阅读页批准/驳回。` +
              `如需立即结案，请先切换为 auto 模式（update_project_config 改 writing_mode=auto），或用 director 对话让用户改模式。`,
          )
        }
      }

      const updated = await updateChapter(chapter.id, fields, ctx.directory)
      // 自评价埋点：进入待审批计一次审批请求（C2 拒绝率分母；定稿决策在 novel-store handleApproval 计数）
      if (args.status === "pending_review" && chapter.status !== "pending_review") {
        recordMetrics(projectDirFromCtx(ctx.directory), {
          domain: "c2-prompt-control",
          key: "approval.requested",
          delta: 1,
        })
      }
      // 记忆生命周期（agent-memory-system §2.4/§6）：章定稿即审批通过（auto 模式路径），
      // 本章相关卡去重合并（自动可撤销）+ 为下一章预计算注入快照；review 模式的审批入口
      // 在 server submitApproval。整理先于快照重建，保证注入包反映合并结果
      const approved = args.status === "final" || args.status === "published"
      const consolidated = approved
        ? consolidateChapterFacts(db, chapter.novel_id, chapter.id).reduce((n, g) => n + g.retired.length, 0)
        : 0
      if (approved) await rebuildNextChapterSnapshot(db, chapter.novel_id, chapter.id)
      return {
        title: "update_chapter",
        output:
          `已更新第${updated.order}章「${updated.title}」状态=${updated.status}` +
          (consolidated > 0 ? `；整理合并了 ${consolidated} 张重复记忆卡（retired 留痕可撤销）` : ""),
        metadata: { chapter_id: updated.id, title: updated.title, status: updated.status, consolidated_facts: consolidated },
      }
    },
  }),
  delete_chapter: defineTool({
    description:
      "删除章节及其所有关联数据（正文版本、摘要、角色状态、张力记录、审计记录、状态日志、实体引用）。此操作不可逆，删除前请确认。通常用于删除生成失败或多余的空章节。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "要删除的章节 ID" }),
      confirm: Schema.Boolean.annotate({
        description: "必须传 true 确认删除；不传或 false 时只返回预览信息不执行删除",
      }),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
      if (!chapter)
        throw toolFailure(
          "not_found",
          `章节不存在：${args.chapter_id}。请先用 list_chapters 定位真实章节 ID；若章节尚不存在，可先派发 @outliner 生成章纲创建章节。`,
          { code: "chapter_not_found" },
        )
      if (!args.confirm) {
        return {
          title: "delete_chapter",
          output: `待删除：第${chapter.order}章「${chapter.title}」（${chapter.word_count}字，状态=${chapter.status}）。关联数据（版本/摘要/角色状态/张力/审计/引用）将一并删除，后续章序号自动补位。确认删除请传 confirm=true。`,
        }
      }
      // 级联清理 + 补位重排 + 派生同步已收口 novel-store 统一删除帮手（与服务端接口共用）
      const deletion = await deleteChapter(args.chapter_id, ctx.directory)
      return {
        title: "delete_chapter",
        output:
          `已删除第${chapter.order}章「${chapter.title}」及其全部关联数据，后续章序号已补位` +
          (deletion.batchCancelled ? "；进行中的批量写作任务已作废，请重新登记批量" : ""),
        metadata: { deleted_chapter_id: args.chapter_id, order: chapter.order, batch_cancelled: deletion.batchCancelled },
      }
    },
  }),
  repair_chapter_sequence: defineTool({
    description:
      "显式修复章节序号。仅当连续性检查「事件顺序」维度报 WARN（序号缺口/重复/派生锚定漂移）或用户明确要求时调用：按阅读序把全书重排为 1..N，输出旧→新映射供核对，并同步张力/弧线/主线等按号派生数据。已连续唯一时返回「无需修复」不做任何改动。本工具绝不自动执行。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const [novel] = await db.select({ id: NovelTable.id }).from(NovelTable).where(eq(NovelTable.id, novelId)).all()
      if (!novel) throw toolFailure("not_found", `小说不存在：${args.novel_id}。请先用 list_novels 列举真实小说 ID。`, { code: "novel_not_found" })

      const repair = repairChapterSequence(novelId, ctx.directory)
      if (repair.alreadyContiguous) {
        return {
          title: "repair_chapter_sequence",
          output: "章节序号已连续唯一（1~N），无需修复。",
          metadata: { novel_id: novelId, repaired: false, mapping: [] },
        }
      }
      const mappingLines = repair.changes.map((change) => `第${change.oldOrder}章 → 第${change.newOrder}章`)
      return {
        title: "repair_chapter_sequence",
        output:
          `已修复章节序号：全书重排为 1..${repair.changes.length} 共 ${repair.changes.length} 处变动，旧→新映射：\n${mappingLines.join("\n")}\n` +
          "张力/弧线/主线等按号派生数据已同步新号" +
          (repair.batchCancelled ? "；进行中的批量写作任务已作废，请重新登记批量" : ""),
        metadata: {
          novel_id: novelId,
          repaired: true,
          batch_cancelled: repair.batchCancelled,
          mapping: repair.changes.map((change) => ({
            chapter_id: change.chapterId,
            old_order: change.oldOrder,
            new_order: change.newOrder,
          })),
        },
      }
    },
  }),
  search_chapters: defineTool({
    description:
      "全文检索小说章节。在所有已写章节的标题和正文中搜索关键词，返回匹配章节及上下文片段，供 agent 查证某事件/人物/设定出现在哪一章。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      query: Schema.String.annotate({ description: "搜索关键词（不少于 2 个字符）" }),
      limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 10" })),
    }),
    execute: async (args, ctx) => {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      if (!args.query || args.query.trim().length < 2) {
        throw toolFailure("param_error", "关键词长度至少 2 个字符")
      }
      const pattern = `%${args.query.trim()}%`
      const rows = await db
        .select({
          id: ChapterTable.id,
          order: ChapterTable.order,
          title: ChapterTable.title,
          content: ChapterTable.content,
        })
        .from(ChapterTable)
        .where(
          and(
            eq(ChapterTable.novel_id, novelId),
            sql`(${ChapterTable.content} LIKE ${pattern} OR ${ChapterTable.title} LIKE ${pattern})`,
          ),
        )
        .orderBy(asc(ChapterTable.order))
        .limit(args.limit ?? 10)
        .all()
      const matched = rows
      if (matched.length === 0) {
        return { title: "search_chapters", output: `未找到包含「${args.query}」的章节` }
      }
      const lines: string[] = [`找到 ${matched.length} 章包含「${args.query}」：`]
      for (const r of matched) {
        const idx = r.content.indexOf(args.query.trim())
        const snippet =
          idx >= 0
            ? r.content.slice(Math.max(0, idx - 30), idx + args.query.trim().length + 50).replace(/\n+/g, " ")
            : r.title
        lines.push(`第${r.order}章 ${r.title}（${r.id}）：…${snippet}…`)
      }
      return {
        title: "search_chapters",
        output: lines.join("\n"),
        metadata: { count: matched.length, query: args.query },
      }
    },
  }),
  restructure_chapters: defineTool({
    description:
      "对一本书执行章节结构重切：按锚点拆分、相邻章合并、章节改题，用于修复固定长度兜底分章等不合理边界。\n" +
      "**两段式**：默认只校验并返回逐步预览（不写库）；用户明确同意后传 confirm=true 在单事务内应用——正文被改的既有章自动保存版本快照（可经 restore_chapter_version 回滚正文），被合并章连同关联数据删除（预览会列出警示），应用后全书序号重排为 1..N。\n" +
      "**章节标识来源**：chapterId 必须来自 list_chapters 的真实返回，禁止自行构造；split 可用 key 声明占位，后续操作以 new:<key> 引用该拆分新章（如先拆出场景起点再并入下一章）。\n" +
      "**锚点语义**：anchor 为「新章正文的起始片段」，必须在目标章正文中恰好出现一次；请从 read_chapter_content 的真实正文中原样摘取。",
    args: Schema.Struct({
      novel_id: Schema.optional(
        Schema.String.annotate({ description: "小说 ID（可选）。不传且库内仅一本小说时自动解析；库内多本小说时必须提供。" }),
      ),
      operations: Schema.Array(
        Schema.Struct({
          op: Schema.Literals(["split", "merge", "retitle"]).annotate({ description: "操作类型：split 按锚点拆分 / merge 相邻合并 / retitle 改题" }),
          chapterId: Schema.String.annotate({ description: "作用章 ID（split/retitle）或合并目标章 ID（merge）；须来自 list_chapters 真实返回，或 new:<key> 引用拆分新章" }),
          anchor: Schema.optional(Schema.String.annotate({ description: "split 必填：新章正文起始片段，须在目标章正文中恰好出现一次" })),
          newTitle: Schema.optional(Schema.String.annotate({ description: "split 可选：新章标题（缺省为「原题（续）」）" })),
          key: Schema.optional(Schema.String.annotate({ description: "split 可选：拆分新章占位标识，后续操作用 new:<key> 引用" })),
          nextChapterId: Schema.optional(Schema.String.annotate({ description: "merge 必填：被合并章 ID，应用时点必须紧随目标章" })),
          title: Schema.optional(Schema.String.annotate({ description: "retitle 必填：新标题" })),
        }),
      ),
      confirm: Schema.optional(Schema.Boolean.annotate({ description: "必须传 true 才应用；不传或 false 时只返回校验预览，不写库" })),
    }),
    execute: async (args, ctx) => {
      if (args.operations.length === 0) {
        throw toolFailure("param_error", "重切方案为空：请至少提供一个操作（split / merge / retitle）。")
      }
      const ops: RestructureOp[] = args.operations.map((operation, index) => {
        if (operation.op === "split") {
          if (operation.anchor === undefined || operation.anchor.length === 0) {
            throw toolFailure("param_error", `第 ${index + 1} 个操作（split）缺少 anchor：请提供新章正文起始片段。`)
          }
          return {
            op: "split",
            chapterId: operation.chapterId,
            anchor: operation.anchor,
            ...(operation.newTitle !== undefined ? { newTitle: operation.newTitle } : {}),
            ...(operation.key !== undefined ? { key: operation.key } : {}),
          }
        }
        if (operation.op === "merge") {
          if (operation.nextChapterId === undefined) {
            throw toolFailure("param_error", `第 ${index + 1} 个操作（merge）缺少 nextChapterId：请提供被合并章 ID。`)
          }
          return { op: "merge", chapterId: operation.chapterId, nextChapterId: operation.nextChapterId }
        }
        if (operation.title === undefined || operation.title.trim().length === 0) {
          throw toolFailure("param_error", `第 ${index + 1} 个操作（retitle）缺少 title：请提供新标题。`)
        }
        return { op: "retitle", chapterId: operation.chapterId, title: operation.title }
      })
      const db = getDb(ctx.directory)
      const novelId = args.novel_id !== undefined ? await resolveNovelId(db, args.novel_id) : await resolveOwnedNovelId(db)
      const chapters = db
        .select({
          id: ChapterTable.id,
          title: ChapterTable.title,
          content: ChapterTable.content,
          order: ChapterTable.order,
          volumeId: ChapterTable.volume_id,
        })
        .from(ChapterTable)
        .where(eq(ChapterTable.novel_id, novelId))
        .orderBy(asc(ChapterTable.order))
        .all()
      const simulation = simulateRestructure(chapters, ops)
      if (!simulation.ok) {
        throw toolFailure("param_error", `重切方案校验失败：${simulation.error.message}`, { code: "restructure_invalid" })
      }
      const { plan } = simulation
      const titleOf = new Map(chapters.map((chapter) => [chapter.id, chapter.title]))
      // 合并删除警示（design D4）：预览列出被删章及其关联数据量，确认后才执行
      const deletionWarnings = plan.deletedChapterIds.map((chapterId) => ({
        chapter_id: chapterId,
        title: titleOf.get(chapterId) ?? chapterId,
        versions: db.select({ id: ChapterVersionTable.id }).from(ChapterVersionTable).where(eq(ChapterVersionTable.chapter_id, chapterId)).all().length,
        summaries: db.select({ id: ChapterSummaryTable.id }).from(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, chapterId)).all().length,
        reviews: db.select({ id: ChapterReviewTable.id }).from(ChapterReviewTable).where(eq(ChapterReviewTable.chapter_id, chapterId)).all().length,
      }))
      if (args.confirm !== true) {
        const lines = [`重切方案预览（共 ${plan.steps.length} 步，未应用）：`]
        for (const step of plan.steps) lines.push(`${step.index}. ${step.summary}`)
        if (deletionWarnings.length > 0) {
          lines.push("⚠️ 合并将删除以下章节及其关联数据：")
          for (const warning of deletionWarnings) {
            lines.push(`- 「${warning.title}」(${warning.chapter_id})：历史版本 ${warning.versions} 个、摘要 ${warning.summaries} 条、评审 ${warning.reviews} 条`)
          }
        }
        lines.push("确认无误后传 confirm=true 应用；正文被改的既有章将自动保存版本快照，全书序号重排为 1..N。")
        return {
          title: "restructure_chapters（预览，未应用）",
          output: lines.join("\n"),
          metadata: {
            applied: false,
            steps: plan.steps,
            deletion_warnings: deletionWarnings,
            final_chapter_count: plan.finalChapters.length,
          },
        }
      }
      const result = applyRestructure(novelId, ops, ctx.directory)
      return {
        title: "restructure_chapters（已应用）",
        output:
          `已应用章节重切：新章 ${result.createdChapterIds.length} 个、合并删除 ${result.deletedChapterIds.length} 章、` +
          `正文修改 ${result.modifiedChapterIds.length} 章（已存版本快照）、改题 ${result.retitledChapterIds.length} 章；` +
          `全书序号已重排为 1..${plan.finalChapters.length}` +
          (result.batchCancelled ? "；进行中的批量写作任务已作废，请重新登记批量" : ""),
        metadata: { applied: true, ...result },
      }
    },
  }),
}

/**
 * update_chapter 的小说归属解析：显式传 novel_id 走 resolveNovelId 参数匹配；
 * 未传时单书兜底（库内恰一书即该书），0 本或多本无法唯一解析时 param_error 失败并指引。
 */
const resolveOwnedNovelId = async (db: ReturnType<typeof getDb>): Promise<string> => {
  const novels = db.select({ id: NovelTable.id }).from(NovelTable).limit(2).all()
  if (novels.length === 1) return novels[0].id
  throw toolFailure(
    "param_error",
    `无法唯一解析小说归属（未提供 novel_id，库内现有 ${novels.length} 本小说）。请提供 novel_id，或先用 list_novels 列举小说后按真实 ID 调用；库内还没有小说时请先初始化。`,
  )
}
