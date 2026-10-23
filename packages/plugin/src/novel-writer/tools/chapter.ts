/**
 * chapter 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { and, asc, eq, sql } from "drizzle-orm"
import { countWords } from "@opennovel-ai/schema/schema"
import { defineTool } from "../../v2/effect/tool.js"
import {
  advanceWritingBatch,
  beginWritingBatch,
  ChapterReviewTable,
  ChapterSummaryTable,
  ChapterTable,
  ChapterVersionTable,
  CharacterStateTable,
  CharacterTable,
  deleteChapter,
  EntityRefTable,
  ForeshadowingTable,
  getDb,
  getWritingBatch,
  HookRotationTable,
  invalidateChapterFactsByQuote,
  NovelStateLogTable,
  NovelTable,
  PendingUpdateTable,
  readNovelConfig,
  rebuildNextChapterSnapshot,
  TensionLogTable,
  updateChapter,
  WorldEntryTable,
  writingBatchCompleted,
} from "../session-store.js"
import { scanReferences } from "../state-commit.js"
import { detectKinshipEntityDrift, loadCharacterBindingView } from "../drift-guards.js"
import {
  CHAPTER_LENGTH_TOLERANCE,
  checkChapterLengthGate,
  checkDuplicateRatio,
  detectCoordinateLeak,
  detectOutlineLabels,
  getChapterLengthLimit,
  getTargetWordCount,
} from "./chapter-guards.js"
import { nextVersion, projectDirFromCtx, resolveNovelId } from "./shared.js"

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
      if (!chapter) return { title: "write_chapter", output: `章节不存在：${args.chapter_id}` }

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
          return {
            title: "write_chapter（需要初始化设定）",
            output:
              "当前小说还没有角色或世界观设定。请先初始化小说设定（生成故事圣经、题材规则和核心设定），再写第一章。",
            metadata: { blocked: true, reason: "uninitialized" },
          }
        }
      }

      const pendingCount = await db
        .select({ id: PendingUpdateTable.id, priority: PendingUpdateTable.priority })
        .from(PendingUpdateTable)
        .where(and(eq(PendingUpdateTable.novel_id, chapter.novel_id), eq(PendingUpdateTable.status, "pending")))
        .all()
      if (pendingCount.length > 0) {
        const highCount = pendingCount.filter((t) => t.priority === "high").length
        return {
          title: "write_chapter（被门禁拦截）",
          output: `当前小说有 ${pendingCount.length} 个未完成影响任务（高优先级 ${highCount} 个）未处理，不能写新章节。先用 cascade_list_pending 查看任务列表与证据，处理后调用 cascade_execute 批量执行；确需跳过用 cascade_resolve 标记 skipped。门禁将在任务清零后解除。`,
          metadata: { blocked: true, pending_count: pendingCount.length, high_priority_count: highCount },
        }
      }

      // 字数校验：不启用篇幅限制时仅保留下限硬约束（现状）；启用时按目标 ±15% 双向拒绝
      const target = await getTargetWordCount(db, chapter.novel_id)
      const limit = await getChapterLengthLimit(db, chapter.novel_id)
      const wordCount = countWords(args.content)
      const lengthRejection = checkChapterLengthGate("write_chapter", wordCount, target, limit)
      if (lengthRejection) return lengthRejection

      // 大纲标签校验：禁止把章纲模板/节拍标签写进读者正文
      const outlineLeaks = detectOutlineLabels(args.content)
      if (outlineLeaks.length > 0) {
        return {
          title: "write_chapter（正文含提纲标签）",
          output: `正文不能包含大纲/节拍标签或编号分段，例如：${outlineLeaks.join(" / ")}。请将这些提纲转化为连续小说正文，用自然段落和场景转换表达，去掉所有标题、编号和【】标签后重新调用 write_chapter。`,
          metadata: { rejected: true, reason: "outline_label", samples: outlineLeaks },
        }

      const coordLeak = detectCoordinateLeak(args.content)
      if (coordLeak.length > 0) {
        return {
          title: "write_chapter（正文含书籍坐标泄漏）",
          output: `正文不能将「第N章」「第N卷」等书籍控制层坐标作为叙事时间使用，例如：${coordLeak.join(" / ")}。请将坐标转换为故事层时间表达（如"三日前""当夜""上月""去年""那时"）或因果衔接后重新调用 write_chapter。`,
          metadata: { rejected: true, reason: "coordinate_leak", samples: coordLeak },
        }
      }
      }

      // 重复度校验：与前文章节重复（照抄或开头场景重演）拒绝写入，防止重写已写过的内容
      const dup = await checkDuplicateRatio(db, chapter.novel_id, args.content, chapter.order)
      if (dup.duplicate) {
        const why =
          dup.openingRatio > 0.05
            ? `本章开头与前文章节高度相似（相似度约 ${Math.round(dup.openingRatio * 100)}%）`
            : `约 ${Math.round(dup.ratio * 100)}% 的段落与前文相同`
        return {
          title: "write_chapter（与前文重复）",
          output: `检测到与前文章节重复的内容：${why}。例如：${dup.samples.join(" / ")}。禁止重复已写章节的事件和场景，请承接上一章结尾之后重写后重新调用 write_chapter。`,
          metadata: { rejected: true, reason: "duplicate", ratio: dup.ratio, opening_ratio: dup.openingRatio },
        }
      }

      // 保守称谓守卫：不阻止写入，但把疑似称谓实体化问题交给后续 auditor 判断
      const bindingView = await loadCharacterBindingView(db, chapter.novel_id, args.content)
      const kinshipFindings = detectKinshipEntityDrift(args.content, bindingView)

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
        output: `已写入第${chapter.order}章「${chapter.title}」：${wordCount}字（${limit ? `目标 ${target}±15%（${Math.floor(target * (1 - CHAPTER_LENGTH_TOLERANCE))}–${Math.ceil(target * (1 + CHAPTER_LENGTH_TOLERANCE))} 字）` : `目标≥${target}字`}）${driftWarning}`,
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
      if (!chapter) return { title: "revise_chapter", output: `章节不存在：${args.chapter_id}` }
      if (chapter.content.length === 0)
        return { title: "revise_chapter", output: `章节尚无正文，无需修订：${args.chapter_id}` }
      if (typeof args.revision !== "string" || args.revision.trim().length === 0)
        return {
          title: "revise_chapter（参数错误）",
          output: "缺少 revision：请传入 chapter_id 和 revision（修订后的完整章节正文），正文参数名是 revision，不是 content。",
        }

      const pendingCount = await db
        .select({ id: PendingUpdateTable.id, priority: PendingUpdateTable.priority })
        .from(PendingUpdateTable)
        .where(and(eq(PendingUpdateTable.novel_id, chapter.novel_id), eq(PendingUpdateTable.status, "pending")))
        .all()
      if (pendingCount.length > 0) {
        const highCount = pendingCount.filter((t) => t.priority === "high").length
        return {
          title: "revise_chapter（被门禁拦截）",
          output: `当前小说有 ${pendingCount.length} 个未完成影响任务（高优先级 ${highCount} 个）未处理，不能修订章节。先用 cascade_list_pending 查看任务列表与证据，处理后调用 cascade_execute 批量执行；确需跳过用 cascade_resolve 标记 skipped。门禁将在任务清零后解除。`,
          metadata: { blocked: true, pending_count: pendingCount.length, high_priority_count: highCount },
        }
      }

      // 修订后仍需满足字数门槛：不启用时保留下限（防止修订改少）；启用时按目标 ±15% 双向校验
      const target = await getTargetWordCount(db, chapter.novel_id)
      const limit = await getChapterLengthLimit(db, chapter.novel_id)
      const wordCount = countWords(args.revision)
      const lengthRejection = checkChapterLengthGate("revise_chapter", wordCount, target, limit)
      if (lengthRejection) return lengthRejection

      // 大纲标签校验：修订时同样禁止把章纲模板/节拍标签写进正文
      const outlineLeaks = detectOutlineLabels(args.revision)
      if (outlineLeaks.length > 0) {
        return {
          title: "revise_chapter（正文含提纲标签）",
          output: `修订正文不能包含大纲/节拍标签或编号分段，例如：${outlineLeaks.join(" / ")}。请改为连续小说正文，去掉所有标题、编号和【】标签后重新调用 revise_chapter。`,
          metadata: { rejected: true, reason: "outline_label", samples: outlineLeaks },
        }
      }


      const coordLeak = detectCoordinateLeak(args.revision)
      if (coordLeak.length > 0) {
        return {
          title: "revise_chapter（修订正文含书籍坐标泄漏）",
          output: `修订正文不能将「第N章」「第N卷」等书籍控制层坐标作为叙事时间使用，例如：${coordLeak.join(" / ")}。请将坐标转换为故事层时间表达后重新调用 revise_chapter。`,
          metadata: { rejected: true, reason: "coordinate_leak", samples: coordLeak },
        }
      }
      const dup = await checkDuplicateRatio(db, chapter.novel_id, args.revision, chapter.order)
      if (dup.duplicate) {
        const why =
          dup.openingRatio > 0.05
            ? `修订后开头与前文章节高度相似（相似度约 ${Math.round(dup.openingRatio * 100)}%）`
            : `约 ${Math.round(dup.ratio * 100)}% 的段落与前文相同`
        return {
          title: "revise_chapter（与前文重复）",
          output: `检测到修订内容与前文章节重复：${why}。例如：${dup.samples.join(" / ")}。禁止重复已写章节的事件和场景，请重写重复部分后重新调用 revise_chapter。`,
          metadata: { rejected: true, reason: "duplicate", ratio: dup.ratio, opening_ratio: dup.openingRatio },
        }
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
        output: `已修订第${chapter.order}章「${chapter.title}」：${wordCount}字（${limit ? `目标 ${target}±15%（${Math.floor(target * (1 - CHAPTER_LENGTH_TOLERANCE))}–${Math.ceil(target * (1 + CHAPTER_LENGTH_TOLERANCE))} 字）` : `目标≥${target}字`}）`,
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
        return { title: "begin_writing_batch", output: `起始章序号无效：${args.start_chapter}（须为 ≥1 的整数）` }
      if (!Number.isInteger(args.total) || args.total < 1)
        return { title: "begin_writing_batch", output: `批量总章数无效：${args.total}（须为 ≥1 的整数）` }
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const [novel] = await db.select({ id: NovelTable.id }).from(NovelTable).where(eq(NovelTable.id, novelId)).all()
      if (!novel) return { title: "begin_writing_batch", output: `小说不存在：${args.novel_id}` }
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
        return { title: "read_chapter_content", output: "请提供 chapter_id 或 chapter_number 之一" }
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
        return { title: "read_chapter_content", output: `章节不存在：${locator}` }
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
      return {
        title: "list_chapters",
        output: lines.join("\n"),
        metadata: { count: chapters.length, chapters },
      }
    },
  }),
  update_chapter: defineTool({
    description:
      "更新章节标题或状态。用于修改章节标题、推进章节状态。\n" +
      "**审批门禁**：项目 writing_mode=review 时，禁止直接设 status=final（必须走阅读页审批流 — 调 submitApproval 工具）；auto 模式下允许。其他状态（draft/pending_review/rejected/audited/revised/published）按需可设。\n" +
      "正文内容请用 write_chapter/revise_chapter，不要用本工具写正文。",
    args: Schema.Struct({
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
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
      const [chapter] = await db.select().from(ChapterTable).where(eq(ChapterTable.id, args.chapter_id)).all()
      if (!chapter) return { title: "update_chapter", output: `章节不存在：${args.chapter_id}` }
      const fields: { title?: string; status?: string } = {}
      if (args.title !== undefined) fields.title = args.title
      if (args.status !== undefined) fields.status = args.status
      if (Object.keys(fields).length === 0) {
        return { title: "update_chapter", output: "未提供任何要更新的字段" }
      }

      // 审批门禁：review 模式下禁止直接设 final/published — 必须走审批流
      if (args.status !== undefined) {
        const mode = readNovelConfig(projectDirFromCtx(ctx.directory))
        if (mode.writing_mode === "review" && (args.status === "final" || args.status === "published")) {
          return {
            title: "update_chapter（被门禁拦截）",
            output:
              `当前项目写作模式为 review，禁止直接设 status=${args.status}。` +
              `必须先在阅读页提交审批（submitApproval 工具）或用户在阅读页批准/驳回。` +
              `如需立即结案，请先切换为 auto 模式（update_project_config 改 writing_mode=auto），或用 director 对话让用户改模式。`,
            metadata: { blocked: true, reason: "review_mode_bypass" },
          }
        }
      }

      const updated = await updateChapter(args.chapter_id, fields, ctx.directory)
      // 记忆生命周期（agent-memory-system §2.4）：章定稿即审批通过（auto 模式路径），
      // 为下一章预计算注入快照；review 模式的审批入口在 server submitApproval
      if (args.status === "final" || args.status === "published") {
        await rebuildNextChapterSnapshot(db, chapter.novel_id, args.chapter_id)
      }
      return {
        title: "update_chapter",
        output: `已更新第${updated.order}章「${updated.title}」状态=${updated.status}`,
        metadata: { chapter_id: updated.id, title: updated.title, status: updated.status },
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
      if (!chapter) return { title: "delete_chapter", output: `章节不存在：${args.chapter_id}` }
      if (!args.confirm) {
        return {
          title: "delete_chapter",
          output: `待删除：第${chapter.order}章「${chapter.title}」（${chapter.word_count}字，状态=${chapter.status}）。关联数据（版本/摘要/角色状态/张力/审计/引用）将一并删除。确认删除请传 confirm=true。`,
        }
      }
      // 级联清理：FK CASCADE 仅在 Bun SQLite 开启 foreign_keys 时生效，这里显式清理确保彻底
      await db.delete(ChapterVersionTable).where(eq(ChapterVersionTable.chapter_id, args.chapter_id)).run()
      await db.delete(ChapterSummaryTable).where(eq(ChapterSummaryTable.chapter_id, args.chapter_id)).run()
      await db.delete(CharacterStateTable).where(eq(CharacterStateTable.chapter_id, args.chapter_id)).run()
      await db.delete(ChapterReviewTable).where(eq(ChapterReviewTable.chapter_id, args.chapter_id)).run()
      await db.delete(NovelStateLogTable).where(eq(NovelStateLogTable.chapter_id, args.chapter_id)).run()
      await db.delete(HookRotationTable).where(eq(HookRotationTable.chapter_id, args.chapter_id)).run()
      await db
        .delete(EntityRefTable)
        .where(and(eq(EntityRefTable.source_type, "chapter"), eq(EntityRefTable.source_id, args.chapter_id)))
        .run()
      // 伏笔的 planted/resolved_chapter_id 置空（SET NULL 语义）
      await db
        .update(ForeshadowingTable)
        .set({ planted_chapter_id: null })
        .where(eq(ForeshadowingTable.planted_chapter_id, args.chapter_id))
        .run()
      await db
        .update(ForeshadowingTable)
        .set({ resolved_chapter_id: null })
        .where(eq(ForeshadowingTable.resolved_chapter_id, args.chapter_id))
        .run()
      // 该章张力记录按 chapter_number 删除
      await db
        .delete(TensionLogTable)
        .where(
          and(eq(TensionLogTable.novel_id, chapter.novel_id), eq(TensionLogTable.chapter_number, chapter.order)),
        )
        .run()
      await deleteChapter(args.chapter_id, ctx.directory)
      return {
        title: "delete_chapter",
        output: `已删除第${chapter.order}章「${chapter.title}」及其全部关联数据`,
        metadata: { deleted_chapter_id: args.chapter_id, order: chapter.order },
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
        return { title: "search_chapters", output: "关键词长度至少 2 个字符" }
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
}
