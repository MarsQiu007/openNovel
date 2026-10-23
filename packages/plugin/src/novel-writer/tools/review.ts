/**
 * review 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { eq } from "drizzle-orm"
import type { SessionDomain } from "../../v2/effect/session.js"
import { defineTool } from "../../v2/effect/tool.js"
import { checkContinuity, CONTINUITY_DIMENSIONS } from "../continuity-check.js"
import {
  ChapterTable,
  createChapterReview,
  createEditorialReport,
  createVolumeReview,
  getDb,
  listChapterReviews,
  listStructureForEditor,
  markChapterFactsReviewed,
} from "../session-store.js"
import { checkStructure } from "../structure.js"
import { resolveSessionNovel } from "./session-novel.js"
import { resolveNovelId } from "./shared.js"

// 注意：Schema.mutable 仅放宽解码类型的只读修饰（novel-store 层入参要求可变数组），运行时行为与 Schema.Array 一致。
export function createReviewTools(deps: { session: SessionDomain }) {
  return {
    check_continuity: defineTool({
      description:
        "执行连续性检查。对当前章节进行37维确定性检查（角色/关系/时间线/地点/剧情/世界观/风格/逻辑/细节）。检查结果自动持久化为评审记录（source=deterministic）。流水线步骤4（audit）。",
      args: Schema.Struct({
        novel_id: Schema.String.annotate({ description: "小说 ID" }),
        chapter_number: Schema.Number.annotate({ description: "章节序号" }),
      }),
      async execute(args, ctx) {
        const db = getDb(ctx.directory)
        const novelId = await resolveNovelId(db, args.novel_id)
        const result = await checkContinuity(novelId, args.chapter_number, ctx.directory)
        if (!result) {
          return { title: "check_continuity", output: "连续性检查失败：无法获取检查结果" }
        }
        if (result.chapterId) {
          await createChapterReview(
            result.chapterId,
            {
              source: "deterministic",
              overall: result.overall,
              dimensions: result.dimensions,
              summary: `37维确定性检查：${result.overall}`,
              sessionId: ctx.sessionID,
            },
            ctx.directory,
          )
        }
        const failCount = result.dimensions.filter((d) => d.status === "FAIL").length
        const warnCount = result.dimensions.filter((d) => d.status === "WARN").length
        const passCount = result.dimensions.length - failCount - warnCount
        const failDims = result.dimensions
          .filter((d) => d.status === "FAIL")
          .map((d) => `${d.dimension}：${d.detail}`)
        return {
          title: "check_continuity",
          output: `连续性检查结果：${result.overall}（PASS ${passCount}，WARN ${warnCount}，FAIL ${failCount}）${failDims.length > 0 ? "\n失败维度：\n" + failDims.join("\n") : ""}`,
          metadata: { overall: result.overall, fail_count: failCount, warn_count: warnCount },
        }
      },
    }),
    submit_chapter_review: defineTool({
      description:
        "提交章节评审结果（结构化持久化）。auditor 完成38维深度审计后必须调用此工具提交全部维度结果，供人工审批时查阅。",
      args: Schema.Struct({
        chapter_id: Schema.String.annotate({ description: "章节 ID" }),
        overall: Schema.Literals(["PASS", "WARN", "FAIL"]).annotate({ description: "总体评估" }),
        dimensions: Schema.mutable(
          Schema.Array(
            Schema.Struct({
              dimension: Schema.String.annotate({ description: "维度名称（必须是评审维度清单中的名称）" }),
              status: Schema.Literals(["PASS", "WARN", "FAIL"]).annotate({ description: "该维度审计结果" }),
              detail: Schema.String.annotate({
                description: "具体说明（PASS 说明通过原因，WARN 指出潜在风险，FAIL 指出具体矛盾）",
              }),
              evidence: Schema.optional(Schema.String.annotate({ description: "引用章节中的具体内容作为证据" })),
            }),
          ),
        ).annotate({ description: "全部评审维度的审计结果列表" }),
        summary: Schema.String.annotate({ description: "总体评估文字" }),
      }),
      async execute(args, ctx) {
        const invalid = args.dimensions.filter((d) => !CONTINUITY_DIMENSIONS.includes(d.dimension))
        if (invalid.length > 0) {
          return {
            title: "submit_chapter_review",
            output: `提交失败：${invalid.length} 个维度名称不在评审维度清单中：${invalid.map((d) => d.dimension).join("、")}。有效维度：${CONTINUITY_DIMENSIONS.join("、")}`,
          }
        }
        const review = await createChapterReview(
          args.chapter_id,
          {
            source: "auditor",
            overall: args.overall,
            dimensions: args.dimensions,
            summary: args.summary,
            sessionId: ctx.sessionID,
          },
          ctx.directory,
        )
        // 记忆生命周期（agent-memory-system §3）：审计证据链落库即 reviewed 生产者，
        // 本章 observer 提取的未决事实 pending → reviewed
        const db = getDb(ctx.directory)
        const [chapterRow] = await db
          .select({ novel_id: ChapterTable.novel_id })
          .from(ChapterTable)
          .where(eq(ChapterTable.id, args.chapter_id))
          .limit(1)
          .all()
        const reviewedFacts = chapterRow ? markChapterFactsReviewed(db, chapterRow.novel_id, args.chapter_id) : 0
        return {
          title: "submit_chapter_review",
          output: `评审已提交：第 ${review.round} 轮，总体 ${args.overall}（PASS ${review.pass_count}，WARN ${review.warn_count}，FAIL ${review.fail_count}）`,
          metadata: { review_id: review.id, round: review.round, reviewed_facts: reviewedFacts },
        }
      },
    }),
    list_chapter_reviews: defineTool({
      description:
        "读取章节的审计/评审记录（确定性检查、auditor 审计、人工审批），返回最近若干轮的总体结论、各维度结果和摘要。修订前用它了解该章历史上被指出过的问题。",
      args: Schema.Struct({
        chapter_id: Schema.String.annotate({ description: "章节 ID" }),
        limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 5" })),
      }),
      async execute(args, ctx) {
        const reviews = await listChapterReviews(args.chapter_id, ctx.directory)
        if (reviews.length === 0) {
          return { title: "list_chapter_reviews", output: `章节 ${args.chapter_id} 暂无审计/评审记录` }
        }
        const limited = reviews.slice(0, args.limit ?? 5)
        const lines: string[] = [
          `章节 ${args.chapter_id.slice(0, 8)} 共 ${reviews.length} 条评审，显示最近 ${limited.length} 条：`,
        ]
        for (const r of limited) {
          let dimensions: unknown = []
          try {
            dimensions = JSON.parse(r.dimensions)
          } catch {
            dimensions = []
          }
          const fails = Array.isArray(dimensions)
            ? (dimensions as Array<{ status?: string }>).filter((d) => d.status === "FAIL").length
            : 0
          lines.push(
            `[${new Date(r.created_at).toLocaleString("zh-CN")}] 第${r.round}轮 ${r.source} ${r.overall}（PASS=${r.pass_count} WARN=${r.warn_count} FAIL=${r.fail_count}）${r.summary ? "：" + r.summary : ""}`,
          )
          if (fails > 0) lines.push(`  ⚠ ${fails} 个维度未通过`)
        }
        return {
          title: "list_chapter_reviews",
          output: lines.join("\n"),
          metadata: { count: reviews.length, reviews: limited },
        }
      },
    }),
    review_volume: defineTool({
      description: "生成卷末复盘报告。包含结构、节奏、角色弧、线索、伏笔和下卷牵引。每调用一次新增一轮复盘记录。",
      args: Schema.Struct({
        volume_id: Schema.String.annotate({ description: "卷 ID" }),
        overall: Schema.String.annotate({ description: "总体评价" }),
        score: Schema.optional(Schema.Number.annotate({ description: "评分 0-10" })),
        strengths: Schema.optional(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "优点列表" })),
        weaknesses: Schema.optional(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "不足列表" })),
        structure: Schema.optional(Schema.String.annotate({ description: "结构分析 JSON 字符串" })),
        character_arcs: Schema.optional(Schema.String.annotate({ description: "角色弧分析 JSON 字符串" })),
        open_threads: Schema.optional(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "未闭合线索" })),
        recommendations: Schema.optional(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "下卷建议" })),
      }),
      async execute(args, ctx) {
        const review = await createVolumeReview(
          args.volume_id,
          {
            overall: args.overall,
            score: args.score ?? null,
            strengths: args.strengths ?? [],
            weaknesses: args.weaknesses ?? [],
            structure: args.structure ? JSON.parse(args.structure) : {},
            characterArcs: args.character_arcs ? JSON.parse(args.character_arcs) : [],
            openThreads: args.open_threads ?? [],
            recommendations: args.recommendations ?? [],
          },
          ctx.directory,
        )
        return {
          title: "review_volume",
          output: `已生成第 ${review.round} 轮卷末复盘（评分 ${review.score ?? "N/A"}）`,
          metadata: { review_id: review.id, round: review.round, score: review.score, volume_id: review.volume_id },
        }
      },
    }),
    editorial_review: defineTool({
      description: "运行确定性结构检查，聚合弧覆盖、伏笔回收、线索闭合等风险。不依赖 LLM，返回结构化问题列表。",
      args: Schema.Struct({}),
      async execute(_args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "editorial_review", output: "未找到当前小说项目" }
        const data = await listStructureForEditor(novelId, ctx.directory)
        const report = checkStructure({
          arcs: data.arcs,
          beats: data.beats,
          threads: data.threads,
          foreshadowing: data.foreshadowing,
          chapters: data.chapters,
        })
        const saved = await createEditorialReport(
          novelId,
          {
            scopeType: "book",
            scopeId: null,
            summary: `全书结构检查发现 ${report.issues.length} 个问题（${report.issues.filter((i) => i.severity === "high").length} 严重）`,
            risks: report.issues,
            recommendations: report.issues.filter((i) => i.severity === "high").map((i) => i.message),
          },
          ctx.directory,
        )
        return {
          title: "editorial_review",
          output: saved.summary,
          metadata: {
            report_id: saved.id,
            issue_count: report.issues.length,
            high_count: report.issues.filter((i) => i.severity === "high").length,
            open_threads: report.openThreadCount,
            unresolved_foreshadowing: report.unresolvedForeshadowingCount,
            arc_coverage: report.arcCoverage,
            issues: report.issues,
          },
        }
      },
    }),
  }
}
