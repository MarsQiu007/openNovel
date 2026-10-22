/**
 * annotations 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { and, desc, eq, sql } from "drizzle-orm"
import { Schema } from "effect"
import type { SessionDomain } from "../../v2/effect/session.js"
import { defineTool } from "../../v2/effect/tool.js"
import {
  AnnotationRoundTable,
  ChapterVersionTable,
  DescriptionHistoryTable,
  WorldEntryTable,
  createAnnotation,
  getAnnotation,
  getDb,
  listAnnotations,
  updateAnnotation,
  updateAnnotationRound,
} from "../session-store.js"
import { resolveSessionNovel } from "./session-novel.js"

export function createAnnotationsTools(deps: { session: SessionDomain }) {
  return {
    annotate: defineTool({
      description:
        "为可批注目标创建批注或润色建议。target_type=chapter 面向章节段落，target_type=world_entry 面向世界观条目（必须先 read_setting 获取全文，并只使用当前原文中真实存在的段落和引用）。source=user 用户批注，source=ai AI 批注；suggested_replacement 非空时即为润色建议。禁止虚构 ID、锚点或设定事实。",
      args: Schema.Struct({
        target_type: Schema.Literals(["chapter", "world_entry"]).annotate({ description: "批注目标类型" }),
        target_id: Schema.String.annotate({ description: "目标 ID（章节 ID 或世界观条目 ID）" }),
        field: Schema.optional(Schema.String.annotate({ description: "目标字段，缺省为 content" })),
        source: Schema.optional(Schema.Literals(["user", "ai"]).annotate({ description: "批注来源" })),
        anchor_type: Schema.optional(Schema.Literals(["paragraph", "range", "chapter"])),
        paragraph_index: Schema.optional(Schema.Number.annotate({ description: "段落索引（从 0 开始）" })),
        start_offset: Schema.optional(Schema.Number),
        end_offset: Schema.optional(Schema.Number),
        end_paragraph_index: Schema.optional(
          Schema.Number.annotate({ description: "结束段落索引（从 0 开始）；跨段批注时提供，缺省为单段" }),
        ),
        quote: Schema.optional(Schema.String.annotate({ description: "引用的原文片段" })),
        comment: Schema.String.annotate({ description: "批注内容" }),
        suggested_replacement: Schema.optional(Schema.String.annotate({ description: "润色替换文本" })),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "annotate", output: "未找到当前小说项目" }
        const field = args.field ?? "content"
        let source = args.source ?? "user"
        let authorSessionId: string | null = null
        let quote = args.quote ?? ""
        if (args.target_type === "world_entry") {
          source = "ai"
          authorSessionId = ctx.sessionID
          const db = getDb(ctx.directory)
          const entry = await db
            .select()
            .from(WorldEntryTable)
            .where(and(eq(WorldEntryTable.id, args.target_id), eq(WorldEntryTable.novel_id, novelId)))
            .get()
          if (!entry) return { title: "annotate", output: `world_entry 不存在：${args.target_id}` }
          quote = entry.content.includes(quote) ? quote : ""
          if (!quote.trim()) return { title: "annotate", output: "quote 不是当前 world_entry 原文中的精确片段" }
          if (args.paragraph_index != null) {
            const paragraphs = entry.content.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
            const paragraph = paragraphs[args.paragraph_index]
            const start = args.start_offset ?? 0
            const end = args.end_offset ?? quote.length
            const endParagraphIndex = args.end_paragraph_index ?? args.paragraph_index
            if (endParagraphIndex === args.paragraph_index) {
              if (!paragraph || args.paragraph_index < 0 || start < 0 || end <= start || end > paragraph.length || paragraph.slice(start, end) !== quote) {
                return { title: "annotate", output: "段落索引或偏移量与原文不一致" }
              }
            } else {
              // 跨段锚点：结构与边界校验 + quote 去空白宽松比较（与服务端校验语义一致）
              const endParagraph = paragraphs[endParagraphIndex]
              const expected = paragraph && endParagraph
                ? [paragraph.slice(start), ...paragraphs.slice(args.paragraph_index + 1, endParagraphIndex), endParagraph.slice(0, end)].join("\n")
                : ""
              if (
                !paragraph || args.paragraph_index < 0
                || endParagraphIndex < args.paragraph_index || !endParagraph
                || start < 0 || start > paragraph.length
                || end < 0 || end > endParagraph.length
                || expected.replace(/\s+/g, "") !== quote.replace(/\s+/g, "")
              ) {
                return { title: "annotate", output: "段落索引或偏移量与原文不一致" }
              }
            }
          }
        }
        const annotation = await createAnnotation(
          {
            novelId,
            targetType: args.target_type,
            targetId: args.target_id,
            field,
            source,
            anchorType: args.anchor_type ?? "paragraph",
            paragraphIndex: args.paragraph_index ?? null,
            startOffset: args.start_offset ?? null,
            endOffset: args.end_offset ?? null,
            endParagraphIndex: args.end_paragraph_index ?? null,
            quote,
            comment: args.comment,
            suggestedReplacement: args.suggested_replacement ?? null,
            authorSessionId,
          },
          ctx.directory,
        )
        return {
          title: "annotate",
          output: annotation.suggested_replacement ? "已创建润色建议" : "已创建批注",
          metadata: {
            annotation_id: annotation.id,
            target_type: annotation.target_type,
            target_id: annotation.target_id,
            paragraph_index: annotation.paragraph_index,
            end_paragraph_index: annotation.end_paragraph_index,
            quote: annotation.quote,
            status: annotation.status,
            has_suggestion: annotation.suggested_replacement != null,
          },
        }
      },
    }),
    list_annotations: defineTool({
      description: "按目标列出批注和润色建议，可按状态筛选。只返回数据库中的真实 ID 和锚点。",
      args: Schema.Struct({
        target_type: Schema.Literals(["chapter", "world_entry"]).annotate({ description: "批注目标类型" }),
        target_id: Schema.String.annotate({ description: "目标 ID（章节 ID 或世界观条目 ID）" }),
        status: Schema.optional(Schema.Literals(["open", "resolved", "wontfix", "applied"])),
      }),
      async execute(args, ctx) {
        if (args.target_type === "world_entry") {
          const db = getDb(ctx.directory)
          const entry = await db
            .select({ id: WorldEntryTable.id })
            .from(WorldEntryTable)
            .where(eq(WorldEntryTable.id, args.target_id))
            .get()
          if (!entry) return { title: "list_annotations", output: `world_entry 不存在：${args.target_id}` }
        }
        const annotations = await listAnnotations(
          { targetType: args.target_type, targetId: args.target_id },
          ctx.directory,
          { status: args.status },
        )
        return {
          title: "list_annotations",
          output: `共 ${annotations.length} 条批注`,
          metadata: {
            total: annotations.length,
            annotations: annotations.map((annotation) => ({
              id: annotation.id,
              target_type: annotation.target_type,
              target_id: annotation.target_id,
              source: annotation.source,
              paragraph_index: annotation.paragraph_index,
              start_offset: annotation.start_offset,
              end_offset: annotation.end_offset,
              quote: annotation.quote,
              comment: annotation.comment,
              suggested_replacement: annotation.suggested_replacement,
              status: annotation.status,
              execution_round_id: annotation.execution_round_id,
              created_at: annotation.created_at,
            })),
          },
        }
      },
    }),
    resolve_annotation: defineTool({
      description: "解决批注：标记为 resolved（已解决）、wontfix（不处理）或 applied（已采纳润色）。只能使用 list_annotations 返回的真实批注 ID。",
      args: Schema.Struct({
        annotation_id: Schema.String.annotate({ description: "批注 ID" }),
        status: Schema.Literals(["resolved", "wontfix", "applied", "open"]).annotate({ description: "目标状态" }),
        comment: Schema.optional(Schema.String.annotate({ description: "更新批注内容" })),
      }),
      async execute(args, ctx) {
        const existing = await getAnnotation(args.annotation_id, ctx.directory)
        if (!existing) return { title: "resolve_annotation", output: `批注不存在：${args.annotation_id}` }
        const updated = await updateAnnotation(
          args.annotation_id,
          { status: args.status, comment: args.comment },
          ctx.directory,
        )
        return {
          title: "resolve_annotation",
          output: `批注状态已更新为 ${updated.status}`,
          metadata: { annotation_id: updated.id, status: updated.status },
        }
      },
    }),
    report_annotation_execution: defineTool({
      description:
        "回填批注执行轮次结果。AI 完成批注改稿或确认失败后必须调用；completed 必须有对应结果引用（章节版本或设定描述历史），部分失败必须报 failed。禁止绕过本工具或虚构轮次 ID。",
      args: Schema.Struct({
        execution_round_id: Schema.String.annotate({ description: "执行轮次 ID" }),
        status: Schema.Literals(["completed", "failed"]).annotate({ description: "执行结果状态" }),
        result_summary: Schema.String.annotate({ description: "本轮修改内容、涉及批注数、未定位项或失败原因摘要" }),
      }),
      async execute(args, ctx) {
        const db = getDb(ctx.directory)
        const round = await db
          .select()
          .from(AnnotationRoundTable)
          .where(eq(AnnotationRoundTable.id, args.execution_round_id))
          .get()
        if (!round) return { title: "report_annotation_execution", output: "执行轮次不存在" }
        const targetId = round.target_id
        if (!targetId) return { title: "report_annotation_execution", output: "执行轮次缺少目标 ID" }
        let resultRefId: string | null = null
        if (args.status === "completed") {
          if (round.target_type === "world_entry") {
            const history = await db
              .select({ id: DescriptionHistoryTable.id })
              .from(DescriptionHistoryTable)
              .where(
                and(
                  eq(DescriptionHistoryTable.entity_type, "world_entry"),
                  eq(DescriptionHistoryTable.entity_id, targetId),
                  eq(DescriptionHistoryTable.field, "content"),
                ),
              )
              .orderBy(desc(sql`rowid`))
              .get()
            if (!history) {
              return { title: "report_annotation_execution", output: "completed 需要存在本次 world_entry 的 content 描述历史" }
            }
            resultRefId = history.id
          } else {
            const version = await db
              .select({ id: ChapterVersionTable.id })
              .from(ChapterVersionTable)
              .where(eq(ChapterVersionTable.chapter_id, targetId))
              .orderBy(desc(ChapterVersionTable.version))
              .get()
            resultRefId = version?.id ?? null
          }
        }
        const updated = await updateAnnotationRound(
          args.execution_round_id,
          {
            status: args.status,
            resultSummary: args.result_summary,
            resultRefId,
          },
          ctx.directory,
        )
        return {
          title: "report_annotation_execution",
          output: `批注执行结果已记录：${updated.status}`,
          metadata: {
            execution_round_id: updated.id,
            status: updated.status,
            result_ref_id: updated.result_ref_id,
          },
        }
      },
    }),
  }
}
