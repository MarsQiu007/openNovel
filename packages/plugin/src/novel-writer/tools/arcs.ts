/**
 * arcs 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { and, eq } from "drizzle-orm"
import { Schema } from "effect"
import type { SessionDomain } from "../../v2/effect/session.js"
import { defineTool } from "../../v2/effect/tool.js"
import { backfillStoryArcs, resolveArcsToDelete } from "../arc-backfill.js"
import {
  CharacterTable,
  StoryArcTable,
  createArcBeat,
  createStoryArc,
  deleteArcBeat,
  getDb,
  listArcBeats,
  listStoryArcs,
  updateArcBeat,
  updateStoryArc,
} from "../session-store.js"
import { resolveSessionNovel } from "./session-novel.js"

export function createArcsTools(deps: { session: SessionDomain }) {
  return {
    list_story_arcs: defineTool({
      description:
        "列出本书所有结构线/弧光（主线/角色弧/支线）及其节点。写作前用此工具确认当前章节应推进哪些弧光、落在哪些节点。可按 status 或 arc_type 过滤。",
      args: Schema.Struct({
        status: Schema.optional(Schema.Literals(["planned", "active", "completed", "abandoned"]).annotate({
          description: "按状态过滤，默认返回未完成的 planned/active",
        })),
        arc_type: Schema.optional(Schema.Literals(["narrative", "character", "subplot"]).annotate({
          description: "按类型过滤",
        })),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "list_story_arcs", output: "未找到当前小说项目" }
        const allArcs = await listStoryArcs(novelId, ctx.directory)
        const arcs = allArcs.filter(
          (a) =>
            (!args.status ? a.status !== "completed" && a.status !== "abandoned" : a.status === args.status) &&
            (!args.arc_type || a.arc_type === args.arc_type),
        )
        const typeLabel: Record<string, string> = { narrative: "主线", character: "角色弧", subplot: "支线" }
        const statusLabel: Record<string, string> = {
          planned: "规划中", active: "进行中", completed: "已完成", abandoned: "已弃用",
        }
        const lines: string[] = [`共 ${arcs.length} 条结构线：`]
        for (const arc of arcs) {
          const range =
            arc.planned_start_chapter != null || arc.planned_end_chapter != null
              ? `（规划 ${arc.planned_start_chapter ?? "?"}-${arc.planned_end_chapter ?? "?"} 章）`
              : ""
          lines.push(
            `- [${typeLabel[arc.arc_type] ?? arc.arc_type}] ${arc.title}（${statusLabel[arc.status] ?? arc.status}）${range}：${arc.summary || "（无摘要）"}`,
          )
          const beats = await listArcBeats(arc.id, ctx.directory)
          for (const b of beats) {
            const ch = b.chapter_order != null ? `第${b.chapter_order}章` : "未锚定"
            lines.push(`    · [${b.kind}/${b.status}] ${ch} ${b.label}${b.summary ? `：${b.summary}` : ""}`)
          }
        }
        return {
          title: "list_story_arcs",
          output: lines.join("\n"),
          metadata: { count: arcs.length, arcs: arcs.map((a) => ({ id: a.id, title: a.title, status: a.status })) },
        }
      },
    }),

    plan_story_arc: defineTool({
      description:
        "创建或更新叙事弧/角色弧/支线。arc_type=narrative 主线、character 角色弧光、subplot 支线。可规划起止章节，也可记录实际章节。",
      args: Schema.Struct({
        action: Schema.Literals(["create", "update"]).annotate({ description: "创建或更新" }),
        arc_id: Schema.optional(Schema.String.annotate({ description: "更新时必填" })),
        arc_type: Schema.Literals(["narrative", "character", "subplot"]).annotate({ description: "结构线类型" }),
        title: Schema.String.annotate({ description: "结构线标题" }),
        summary: Schema.optional(Schema.String.annotate({ description: "结构线摘要" })),
        status: Schema.optional(Schema.Literals(["planned", "active", "completed", "abandoned"])),
        target_character_id: Schema.optional(Schema.String.annotate({
          description: "角色弧关联的角色 ID 或角色名（传名字时自动解析为 ID）",
        })),
        planned_start_chapter: Schema.optional(Schema.Number),
        planned_end_chapter: Schema.optional(Schema.Number),
        actual_start_chapter: Schema.optional(Schema.Number),
        actual_end_chapter: Schema.optional(Schema.Number),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "plan_story_arc", output: "未找到当前小说项目" }
        // target_character_id 接受角色 ID 或角色名：architect/observer 手里通常只有名字，
        // 这里解析到真实 UUID，避免把名字直接写入外键触发 FOREIGN KEY constraint failed
        let resolvedCharacterId: string | null | undefined
        if (args.target_character_id) {
          const db = getDb(ctx.directory)
          const ref = args.target_character_id.trim()
          const [byId] = await db
            .select({ id: CharacterTable.id })
            .from(CharacterTable)
            .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.id, ref)))
            .limit(1)
            .all()
          if (byId) {
            resolvedCharacterId = byId.id
          } else {
            const [byName] = await db
              .select({ id: CharacterTable.id })
              .from(CharacterTable)
              .where(and(eq(CharacterTable.novel_id, novelId), eq(CharacterTable.name, ref)))
              .limit(1)
              .all()
            if (!byName) {
              return {
                title: "plan_story_arc",
                output: `未找到角色「${ref}」，请先用 save_novel_settings 创建该角色，或传入正确的角色 ID`,
              }
            }
            resolvedCharacterId = byName.id
          }
        }
        if (args.action === "update" && args.arc_id) {
          const updated = await updateStoryArc(
            args.arc_id,
            {
              title: args.title,
              summary: args.summary,
              status: args.status,
              targetCharacterId: resolvedCharacterId,
              plannedStartChapter: args.planned_start_chapter,
              plannedEndChapter: args.planned_end_chapter,
              actualStartChapter: args.actual_start_chapter,
              actualEndChapter: args.actual_end_chapter,
            },
            ctx.directory,
          )
          return {
            title: "plan_story_arc",
            output: `已更新结构线「${updated.title}」状态为 ${updated.status}`,
            metadata: { arc_id: updated.id, arc_type: updated.arc_type, status: updated.status },
          }
        }
        const arc = await createStoryArc(
          novelId,
          {
            arcType: args.arc_type,
            title: args.title,
            summary: args.summary ?? "",
            status: args.status ?? "planned",
            targetCharacterId: resolvedCharacterId ?? null,
            plannedStartChapter: args.planned_start_chapter ?? null,
            plannedEndChapter: args.planned_end_chapter ?? null,
          },
          ctx.directory,
        )
        return {
          title: "plan_story_arc",
          output: `已创建结构线「${arc.title}」(${arc.arc_type})`,
          metadata: { arc_id: arc.id, arc_type: arc.arc_type, title: arc.title, status: arc.status },
        }
      },
    }),
    record_arc_beat: defineTool({
      description:
        "在结构线上记录关键节点（开场/升温/转折/中点/危机/高潮/结局）。可锚定已写章节或仅记录规划章节序号。",
      args: Schema.Struct({
        action: Schema.Literals(["create", "update", "delete"]).annotate({ description: "操作类型" }),
        arc_id: Schema.String.annotate({ description: "所属结构线 ID" }),
        beat_id: Schema.optional(Schema.String.annotate({ description: "更新/删除时必填" })),
        chapter_id: Schema.optional(Schema.String.annotate({ description: "锚定的章节 ID" })),
        chapter_order: Schema.optional(Schema.Number.annotate({ description: "规划章节序号" })),
        label: Schema.String.annotate({ description: "节点标题" }),
        kind: Schema.optional(
          Schema.Literals(["setup", "rising", "turn", "midpoint", "crisis", "climax", "resolution", "note"]),
        ),
        summary: Schema.optional(Schema.String.annotate({ description: "节点描述" })),
        status: Schema.optional(Schema.Literals(["planned", "drafted", "reviewed"])),
      }),
      async execute(args, ctx) {
        if (args.action === "delete" && args.beat_id) {
          await deleteArcBeat(args.beat_id, ctx.directory)
          return { title: "record_arc_beat", output: "已删除节点", metadata: { beat_id: args.beat_id } }
        }
        if (args.action === "update" && args.beat_id) {
          const updated = await updateArcBeat(
            args.beat_id,
            {
              label: args.label,
              kind: args.kind,
              summary: args.summary,
              status: args.status,
              chapterId: args.chapter_id,
              chapterOrder: args.chapter_order,
            },
            ctx.directory,
          )
          return {
            title: "record_arc_beat",
            output: `已更新节点「${updated.label}」`,
            metadata: { beat_id: updated.id, status: updated.status },
          }
        }
        const beat = await createArcBeat(
          args.arc_id,
          {
            chapterId: args.chapter_id ?? null,
            chapterOrder: args.chapter_order ?? null,
            label: args.label,
            kind: args.kind ?? "note",
            summary: args.summary ?? "",
            ...(args.status ? { status: args.status } : {}),
          },
          ctx.directory,
        )
        return {
          title: "record_arc_beat",
          output: `已记录节点「${beat.label}」(${beat.kind})`,
          metadata: { beat_id: beat.id, arc_id: beat.arc_id, kind: beat.kind, chapter_order: beat.chapter_order },
        }
      },
    }),
    backfill_story_arcs: defineTool({
      description:
        "批量补建或重建结构线/弧光与节点。architect 反推弧光结构后一次性调用本工具落库。" +
        " mode=create_only（默认）：增量补建，同标题+类型已存在则跳过；" +
        " mode=replace_all：删除项目全部弧光与节点后重建（全局重建）；" +
        " mode=replace_matching：删除 replace_match 指定类型/角色的弧光后重建（重建主线/某角色弧）。" +
        " 工具自动处理状态推导、actual_start/end 回填、角色名->ID 解析、chapter_id 回填、事务原子提交。",
      args: Schema.Struct({
        arcs: Schema.mutable(
          Schema.Array(
            Schema.Struct({
              arc_type: Schema.Literals(["narrative", "character", "subplot"]).annotate({ description: "主线/角色弧/支线" }),
              title: Schema.String.annotate({ description: "弧光标题" }),
              summary: Schema.optional(Schema.String.annotate({ description: "弧光摘要：起点状态、走向、预期终点" })),
              target_character_name: Schema.optional(
                Schema.String.annotate({ description: "角色弧必填：角色名，工具自动解析为角色 ID" }),
              ),
              beats: Schema.mutable(
                Schema.Array(
                  Schema.Struct({
                    label: Schema.String.annotate({ description: "节点标题" }),
                    kind: Schema.Literals(["setup", "rising", "turn", "midpoint", "crisis", "climax", "resolution", "note"]).annotate({
                      description: "节点类型",
                    }),
                    summary: Schema.optional(Schema.String.annotate({ description: "节点描述" })),
                    chapter_order: Schema.optional(
                      Schema.Number.check(Schema.isMultipleOf(1)).annotate({
                        description: "章节序号：已发生节点填实际序号，未来节点填预计序号",
                      }),
                    ),
                    chapter_id: Schema.optional(
                      Schema.String.annotate({ description: "已发生节点的章节 ID；未填时按 chapter_order 自动回填" }),
                    ),
                    drafted: Schema.optional(
                      Schema.Boolean.annotate({ description: "true=该节点已在正文中发生(drafted)，false/省略=规划中(planned)" }),
                    ),
                  }),
                ),
              )
                .check(Schema.makeFilter((arr) => arr.length >= 1 || "至少 1 条"))
                .annotate({ description: "该弧光的关键节点列表" }),
            }),
          ),
        )
          .check(Schema.makeFilter((arr) => arr.length >= 1 || "至少 1 条"))
          .annotate({ description: "要补建的弧光列表" }),
        mode: Schema.optional(
          Schema.Literals(["create_only", "replace_all", "replace_matching"]).annotate({
            description: "create_only=增量补建(默认)；replace_all=删除全部后重建；replace_matching=按 replace_match 删除匹配弧光后重建",
          }),
        ),
        replace_match: Schema.optional(
          Schema.Struct({
            arc_type: Schema.optional(
              Schema.Literals(["narrative", "character", "subplot"]).annotate({ description: "按弧光类型匹配（如重建主线传 narrative）" }),
            ),
            target_character_name: Schema.optional(
              Schema.String.annotate({ description: "按角色名匹配（重建某角色弧时传角色名，自动配合 arc_type=character）" }),
            ),
          }).annotate({ description: "mode=replace_matching 时必填，指定要替换哪些弧光" }),
        ),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) return { title: "backfill_story_arcs", output: "未找到当前小说项目" }
        const mode = args.mode ?? "create_only"
        if (mode === "replace_matching" && !args.replace_match?.arc_type && !args.replace_match?.target_character_name) {
          return { title: "backfill_story_arcs", output: "replace_matching 模式需要提供 replace_match（arc_type 和/或 target_character_name）" }
        }
        // replace 模式删除前请求确认：独立权限键 arc_rebuild 避开 agent 规则表对
        // 工具 ID 的通配 allow，审批记忆按模式粒度生效（openspec/changes/safe-delete-gates）
        if (mode !== "create_only") {
          const db = getDb(ctx.directory)
          const existingArcs = await db
            .select()
            .from(StoryArcTable)
            .where(eq(StoryArcTable.novel_id, novelId))
            .all()
          const characters = await db
            .select({ id: CharacterTable.id, name: CharacterTable.name })
            .from(CharacterTable)
            .where(eq(CharacterTable.novel_id, novelId))
            .all()
          const arcsToDelete = resolveArcsToDelete(
            existingArcs,
            mode,
            args.replace_match,
            new Map(characters.map((c) => [c.name, c.id])),
          )
          await ctx.ask({
            permission: "arc_rebuild",
            patterns: [mode],
            always: [mode],
            metadata: {
              toolId: "backfill_story_arcs",
              mode,
              arcs_to_delete: arcsToDelete.length,
              replace_match: args.replace_match ?? null,
            },
          })
        }
        try {
          const result = await backfillStoryArcs(
            ctx.directory,
            novelId,
            args.arcs,
            mode,
            args.replace_match,
          )
          if (result.skipped) {
            return {
              title: "backfill_story_arcs",
              output: result.reason ?? "已跳过",
              metadata: result,
            }
          }
          const typeLabel: Record<string, string> = {
            narrative: "主线",
            character: "角色弧",
            subplot: "支线",
          }
          const modeLabel: Record<string, string> = {
            create_only: "补建",
            replace_all: "全局重建",
            replace_matching: "定向重建",
          }
          const action = modeLabel[result.mode] ?? "操作"
          const lines: string[] = [
            "弧光" + action + "完成：新建 " + result.arcs_created + " 条、跳过 " + result.arcs_skipped + " 条、删除旧弧光 " + result.arcs_deleted + " 条、节点 " + result.beats_created + " 个",
          ]
          for (const arc of result.arcs) {
            let range = ""
            if (arc.actual_start_chapter != null) {
              range = "（已写至第" + arc.actual_start_chapter + "章"
              if (arc.actual_end_chapter != null) range += "-" + arc.actual_end_chapter + "章"
              range += "）"
            }
            lines.push(
              "- [" + (typeLabel[arc.arc_type] ?? arc.arc_type) + "] " + arc.title + " [" + arc.status + "]" + range + "：" + arc.drafted_beats + " 个已落地节点，" + arc.planned_beats + " 个规划节点",
            )
          }
          return {
            title: "backfill_story_arcs",
            output: lines.join("\n"),
            metadata: result,
          }
        } catch (err) {
          return {
            title: "backfill_story_arcs",
            output: "弧光操作失败：" + (err instanceof Error ? err.message : String(err)),
          }
        }
      },
    }),
  }
}
