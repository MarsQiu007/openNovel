/**
 * pending 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import {
  acceptPendingSetting,
  listPendingSettingRows,
  mergePendingSettings,
  rejectPendingSetting,
} from "../setting-review-candidates.js"
import { listConflicts, resolveConflict } from "../setting-review-conflicts.js"
import { SETTING_TEXT_FORMAT_RULE } from "../setting-text.js"
import { getDb } from "../session-store.js"
import { WORLD_ENTRY_CATEGORY_HINT } from "../world-category.js"
import { resolveNovelId } from "./shared.js"

export const pendingTools = {
  list_pending_settings: defineTool({
    description:
      "列出 pending_settings 候选区。observer 提的 importance=1 设定或 type_strength=weak 关系都先入这里，等用户审阅。director 每章写完后会用本工具列出本章新增的候选，引导用户决定入库 / 拒绝 / 合并。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      status: Schema.optional(
        Schema.Literals(["pending", "accepted", "rejected", "merged"]).annotate({
          description: "状态过滤（默认 pending）",
        }),
      ),
      candidate_type: Schema.optional(
        Schema.Literals(["character", "world_entry", "relationship", "location"]).annotate({
          description: "候选类型过滤（可选）",
        }),
      ),
      source_chapter_id: Schema.optional(Schema.String.annotate({ description: "只列来自某章节的候选（可选）" })),
      limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 20" })),
      offset: Schema.optional(Schema.Number.annotate({ description: "跳过前 N 条，默认 0" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const status = args.status ?? "pending"
      const { total: totalCount, rows } = await listPendingSettingRows(db, {
        novelId,
        status: args.status,
        candidateType: args.candidate_type,
        sourceChapterId: args.source_chapter_id,
        limit: args.limit,
        offset: args.offset,
      })
      if (rows.length === 0) {
        return {
          title: "list_pending_settings",
          output: `无 ${status} 候选${args.candidate_type ? `（类型=${args.candidate_type}）` : ""}`,
          metadata: { total: totalCount, returned: 0, items: [] },
        }
      }
      const lines: string[] = [`共 ${totalCount} 条 ${status} 候选，显示 ${rows.length} 条：`]
      for (const r of rows) {
        const tag = r.type_strength ? ` [${r.type_strength}]` : ` [imp=${r.importance}]`
        const time = new Date(r.created_at).toLocaleString("zh-CN")
        const payloadPreview = r.payload_json.length > 60 ? r.payload_json.slice(0, 60) + "…" : r.payload_json
        lines.push(
          `\n[${r.id.slice(0, 8)}] ${time} | ${r.candidate_type}${tag} | ${r.display_title}\n  payload: ${payloadPreview}`,
        )
      }
      return {
        title: "list_pending_settings",
        output: lines.join("\n"),
        metadata: {
          total: totalCount,
          returned: rows.length,
          items: rows.map((r) => ({
            id: r.id,
            candidate_type: r.candidate_type,
            display_title: r.display_title,
            importance: r.importance,
            type_strength: r.type_strength,
            source_chapter_id: r.source_chapter_id,
            created_at: r.created_at,
            payload_json: r.payload_json,
          })),
        },
      }
    },
  }),

  accept_pending_setting: defineTool({
    description:
      "把候选区的一条 pending 设定正式入库到对应正式表（CharacterTable / WorldEntryTable / RelationshipTable），并把 status 标为 accepted。\n\n**跨 category 同义检测**：accept world_entry 前自动查同 title 的已有 world_entry（任意 category），有则提示合并（仍会执行入库，但 output 会警告「同标题已存在 X 条」）。\n\n" +
      SETTING_TEXT_FORMAT_RULE,
    args: Schema.Struct({
      pending_id: Schema.String.annotate({ description: "候选 ID（list_pending_settings 拿）" }),
      allow_new_category: Schema.optional(
        Schema.Boolean.annotate({
          description: `world_entry 专用：允许使用标准列表之外的分类。${WORLD_ENTRY_CATEGORY_HINT}`,
        }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const result = await acceptPendingSetting(db, args.pending_id, { allowNewCategory: args.allow_new_category })
      if (!result.ok) {
        const response: { title: string; output: string; metadata?: Record<string, unknown> } = {
          title: "accept_pending_setting",
          output: result.error,
        }
        if (result.format_errors) {
          response.metadata = {
            pending_id: args.pending_id,
            candidate_type: result.candidate_type ?? "",
            errors: result.format_errors,
          }
        }
        return response
      }
      const impactLine =
        result.impact.task_count > 0 ? `\n⚠ 已生成 ${result.impact.task_count} 个联动任务（待处理 ${result.impact.pending_count} 个）` : ""
      return {
        title: "accept_pending_setting",
        output: `已接受 ${result.candidate_type} 候选「${result.display_title}」，入库到正式表（id=${result.created_id.slice(0, 8)}）${impactLine}`,
        metadata: {
          pending_id: result.pending_id,
          created_id: result.created_id,
          candidate_type: result.candidate_type,
          impact: result.impact,
        },
      }
    },
  }),

  reject_pending_setting: defineTool({
    description:
      "把候选区的一条 pending 设定标记为 rejected（丢弃）。不会删除记录，只是改 status；用户后续可调 list_pending_settings status=rejected 复查。",
    args: Schema.Struct({
      pending_id: Schema.String.annotate({ description: "候选 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const result = await rejectPendingSetting(db, args.pending_id)
      if (!result.ok) {
        return { title: "reject_pending_setting", output: result.error }
      }
      return {
        title: "reject_pending_setting",
        output: `已拒绝 ${result.candidate_type} 候选「${result.display_title}」（id=${result.pending_id.slice(0, 8)}）`,
        metadata: { pending_id: result.pending_id, candidate_type: result.candidate_type, display_title: result.display_title },
      }
    },
  }),

  merge_pending_settings: defineTool({
    description:
      "合并 N 条候选（≥2）到一条新正式条目。常用于：同一章节 observer 提了多个相似候选项，或 accept 时提示同标题已存在。把所有候选的 payload 按字段合并（取最长 content/description 优先），创建新正式条目后把源候选 status 标为 merged, merged_into=新条目 ID。\n\n" +
      SETTING_TEXT_FORMAT_RULE,
    args: Schema.Struct({
      pending_ids: Schema.Array(Schema.String)
        .check(Schema.makeFilter((arr) => arr.length >= 2 || "至少 2 条候选"))
        .annotate({ description: "要合并的候选 ID 列表（≥2 条，必须同 candidate_type）" }),
      new_id: Schema.optional(Schema.String.annotate({ description: "新正式条目的 ID（不传则自动生成 UUID）" })),
      allow_new_category: Schema.optional(
        Schema.Boolean.annotate({
          description: `world_entry 专用：允许使用标准列表之外的分类。${WORLD_ENTRY_CATEGORY_HINT}`,
        }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      // mergePendingSettings 形参为可变 string[]，V2 解码出的数组是 readonly，浅拷贝一层
      const result = await mergePendingSettings(db, [...args.pending_ids], {
        newId: args.new_id,
        allowNewCategory: args.allow_new_category,
      })
      if (!result.ok) {
        const response: { title: string; output: string; metadata?: Record<string, unknown> } = {
          title: "merge_pending_settings",
          output: result.error,
        }
        if (result.format_errors) {
          response.metadata = {
            candidate_type: result.candidate_type ?? "",
            source_pending_ids: args.pending_ids,
            errors: result.format_errors,
          }
        }
        return response
      }
      return {
        title: "merge_pending_settings",
        output: `已合并 ${result.merged_count} 条 ${result.candidate_type} 候选到新正式条目（id=${result.created_id.slice(0, 8)}，display_title=${result.display_title}）`,
        metadata: {
          merged_count: result.merged_count,
          created_id: result.created_id,
          candidate_type: result.candidate_type,
          source_pending_ids: result.source_pending_ids,
          merged_payload: result.merged_payload,
          impact: result.impact,
        },
      }
    },
  }),

  list_conflicts: defineTool({
    description:
      "列出世界观冲突标注（observer 提取的 world_entry 冲突，与设定收件箱同源）。冲突不污染设定正文，处理前先读本工具了解冲突点，再用 resolve_conflict 处理：按正文更新生成暂存草案，或保留现状忽略。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      status: Schema.optional(
        Schema.Literals(["unresolved", "resolved"]).annotate({
          description: "状态过滤（默认 unresolved，只看未解决冲突）",
        }),
      ),
      limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 20" })),
      offset: Schema.optional(Schema.Number.annotate({ description: "跳过前 N 条，默认 0" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const status = args.status ?? "unresolved"
      const { total, rows } = await listConflicts(db, {
        novelId,
        status,
        limit: args.limit,
        offset: args.offset,
      })
      if (rows.length === 0) {
        return {
          title: "list_conflicts",
          output: `无 ${status === "unresolved" ? "未解决" : "已解决"}冲突`,
          metadata: { total, returned: 0, items: [] },
        }
      }
      const lines: string[] = [`共 ${total} 条${status === "unresolved" ? "未解决" : "已解决"}冲突，显示 ${rows.length} 条：`]
      for (const r of rows) {
        const time = new Date(r.created_at).toLocaleString("zh-CN")
        lines.push(
          `\n[${r.id.slice(0, 8)}] ${time} | ${r.conflict_kind} | 条目：${r.entry_title ?? `${r.world_entry_id.slice(0, 8)}（条目缺失）`}\n  冲突说明：${r.conflict_note}`,
        )
        if (r.resolved === 1) {
          lines.push(`  处理留痕：${r.resolution_kind || "已处理"}${r.resolution_note ? `（${r.resolution_note}）` : ""}`)
        }
      }
      return {
        title: "list_conflicts",
        output: lines.join("\n"),
        metadata: {
          total,
          returned: rows.length,
          items: rows.map((r) => ({
            id: r.id,
            world_entry_id: r.world_entry_id,
            entry_title: r.entry_title,
            conflict_kind: r.conflict_kind,
            conflict_note: r.conflict_note,
            resolved: r.resolved,
            resolution_kind: r.resolution_kind,
            resolution_note: r.resolution_note,
            source_chapter_id: r.source_chapter_id,
            created_at: r.created_at,
          })),
        },
      }
    },
  }),

  resolve_conflict: defineTool({
    description:
      "处理一条世界观冲突。action=update_entry 按你提供的草案正文生成暂存变更（进入设定收件箱，用户接受后才写入正式设定）；action=keep_current 保留现状并忽略该冲突（留痕处理方式与备注）。处理语义与设定收件箱一致：按正文更新时草案内容必须通过设定文本格式校验（纯文本、空行分段、无 Markdown）。",
    args: Schema.Struct({
      conflict_id: Schema.String.annotate({ description: "冲突 ID（list_conflicts 拿）" }),
      action: Schema.Literals(["update_entry", "keep_current"]).annotate({
        description: "处理方式：update_entry 按正文更新 / keep_current 保留现状",
      }),
      content: Schema.optional(Schema.String.annotate({ description: "update_entry 必填：修正后的条目正文草案" })),
      note: Schema.optional(Schema.String.annotate({ description: "处理备注（记录处理理由，可追溯）" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const result = await resolveConflict(db, args.conflict_id, {
        action: args.action,
        content: args.content,
        note: args.note,
        source: "agent",
      })
      if (!result.ok) {
        return { title: "resolve_conflict", output: result.error }
      }
      if (result.action === "keep_current") {
        return {
          title: "resolve_conflict",
          output: "已保留现状并忽略该冲突（可在 list_conflicts status=resolved 复查处理留痕）",
          metadata: { conflict_id: result.conflict_id, action: result.action, note: args.note ?? "" },
        }
      }
      return {
        title: "resolve_conflict",
        output:
          "已按正文生成暂存草案并写入设定收件箱，等用户审阅接受后才写入正式设定；向用户说明该冲突的处理方式与草案位置。",
        metadata: {
          conflict_id: result.conflict_id,
          action: result.action,
          staged_change_id: result.staged_change_id,
          note: args.note ?? "",
        },
      }
    },
  }),
}
