/**
 * cascade 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；
 * execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import {
  cascadeCheck,
  cascadeCreateTasks,
  cascadeExecute,
  cascadeGetStatus,
  cascadeListPending,
  cascadeRebuildRefs,
  cascadeResolve,
} from "../state-commit.js"
import { confirmSemanticSuggestion, ignoreSemanticSuggestion, planImpact } from "../setting-impact.js"
import { getDb } from "../session-store.js"
import { resolveNovelId } from "./shared.js"

export const cascadeTools = {
  cascade_check: defineTool({
    description:
      "查询实体变更的影响范围。输入实体类型和 ID，返回所有引用该实体的内容列表（章节/角色/卷纲等）。用于修改设定前评估影响。零 LLM 依赖，纯 DB 查询。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      entity_type: Schema.String.annotate({
        description: "被修改的实体类型：character/world_entry/plot_thread/foreshadowing/style_guide/volume",
      }),
      entity_id: Schema.String.annotate({ description: "被修改的实体 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const refs = await cascadeCheck(db, novelId, args.entity_type, args.entity_id)
      if (refs.length === 0) {
        return { title: "cascade_check", output: `没有内容引用该实体（${args.entity_type}: ${args.entity_id}）` }
      }
      const lines = refs.map((r) => `- ${r.source_type} ${r.source_id} [${r.ref_field}]：${r.ref_text}`)
      return {
        title: `cascade_check（${refs.length} 处受影响）`,
        output: lines.join("\n"),
        metadata: { count: refs.length, refs },
      }
    },
  }),
  cascade_create_tasks: defineTool({
    description:
      "为受影响的内容创建统改任务。在修改设定后调用，自动查询所有引用方并创建 pending_updates 记录。每个任务包含触发原因、旧值、新值和优先级。零 LLM 依赖。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      trigger_type: Schema.String.annotate({ description: "触发变更的实体类型" }),
      trigger_id: Schema.String.annotate({ description: "触发变更的实体 ID" }),
      trigger_field: Schema.String.annotate({ description: "哪个字段变了（如 content/description/title）" }),
      old_value: Schema.String.annotate({ description: "旧值" }),
      new_value: Schema.String.annotate({ description: "新值" }),
      reason: Schema.String.annotate({ description: "人可读的变更原因" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const count = await cascadeCreateTasks(
        db,
        novelId,
        args.trigger_type,
        args.trigger_id,
        args.trigger_field,
        args.old_value,
        args.new_value,
        args.reason,
      )
      return {
        title: "cascade_create_tasks",
        output: count > 0 ? `已创建 ${count} 个统改任务，使用 cascade_list_pending 查看` : "没有需要统改的内容",
        metadata: { count },
      }
    },
  }),
  cascade_list_pending: defineTool({
    description: "列出待统改任务。返回所有 pending 状态的任务，包含受影响实体、触发原因、优先级。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      status: Schema.optional(
        Schema.String.annotate({ description: "任务状态过滤（默认 pending，可选 done/skipped/in_progress）" }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const tasks = await cascadeListPending(db, novelId, args.status ?? "pending")
      if (tasks.length === 0) {
        return { title: "cascade_list_pending", output: "没有待统改任务" }
      }
      const lines = tasks.map(
        (t) =>
          `- [${t.priority}] ${t.source_type} ${t.source_id}：${t.reason}（触发：${t.trigger_type} ${t.trigger_id}）`,
      )
      return {
        title: `cascade_list_pending（${tasks.length} 个任务）`,
        output: lines.join("\n"),
        metadata: { count: tasks.length, tasks },
      }
    },
  }),
  cascade_resolve: defineTool({
    description: "标记统改任务完成或跳过。",
    args: Schema.Struct({
      task_id: Schema.String.annotate({ description: "任务 ID" }),
      status: Schema.String.annotate({ description: "新状态：done 或 skipped" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      if (args.status !== "done" && args.status !== "skipped") {
        return { title: "cascade_resolve", output: "status 必须是 done 或 skipped" }
      }
      const ok = await cascadeResolve(db, args.task_id, args.status)
      return {
        title: "cascade_resolve",
        output: ok ? `任务 ${args.task_id} 已标记为 ${args.status}` : `任务 ${args.task_id} 不存在`,
        metadata: { resolved: ok },
      }
    },
  }),
  impact_plan: defineTool({
    description:
      "查询一次设定变更的影响计划（只读，不修改数据库）。修改设定前调用：返回确定性引用影响（章节正文/摘要/设定描述中的名字命中）与结构性依赖（关系端点、伏笔章节、剧情线），每条包含证据与优先级。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      entity_type: Schema.String.annotate({
        description: "变更实体类型（character/world_entry/plot_thread/foreshadow/relationship）",
      }),
      entity_id: Schema.String.annotate({ description: "变更实体 ID" }),
      field: Schema.String.annotate({ description: "要修改的字段（如 name/title/content/description）" }),
      old_value: Schema.String.annotate({ description: "旧值" }),
      new_value: Schema.String.annotate({ description: "新值" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const intent = {
        novelId,
        entityType: args.entity_type,
        entityId: args.entity_id,
        field: args.field,
        oldValue: args.old_value,
        newValue: args.new_value,
        reason: "影响计划查询",
      }
      const findings = await planImpact(db, intent)
      if (findings.length === 0) {
        return { title: "impact_plan", output: `没有发现确定性或结构性影响（${args.entity_type}: ${args.entity_id}）`, metadata: { impact_plan: { entity_type: args.entity_type, entity_id: args.entity_id, field: args.field, old_value: args.old_value, new_value: args.new_value }, findings: [], count: 0 } }
      }
      const lines = findings.map(
        (f) => `- [${f.kind}/${f.priority}] ${f.sourceType} ${f.sourceId}（${f.refField}）：${f.refText}`,
      )
      return {
        title: `impact_plan（${findings.length} 项影响）`,
        output: lines.join("\n"),
        metadata: { impact_plan: { entity_type: args.entity_type, entity_id: args.entity_id, field: args.field, old_value: args.old_value, new_value: args.new_value }, findings, count: findings.length },
      }
    },
  }),
  impact_semantic_review: defineTool({
    description:
      "处理语义影响建议（requires_confirmation 状态）。action=confirm 把建议转成正式待处理任务进入执行队列；action=ignore 标记已忽略（系统不会据此自动修改任何内容）。确认或忽略都不会直接改写章节。",
    args: Schema.Struct({
      task_id: Schema.String.annotate({ description: "语义建议的任务 ID（cascade_list_pending 输出中可见）" }),
      action: Schema.String.annotate({ description: "confirm 或 ignore" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      if (args.action === "confirm") {
        const ok = await confirmSemanticSuggestion(db, args.task_id)
        return {
          title: "impact_semantic_review",
          output: ok ? `语义建议 ${args.task_id} 已确认，进入待处理队列` : `任务 ${args.task_id} 不是待确认语义建议`,
          metadata: { confirmed: ok },
        }
      }
      if (args.action === "ignore") {
        const ok = await ignoreSemanticSuggestion(db, args.task_id)
        return {
          title: "impact_semantic_review",
          output: ok ? `语义建议 ${args.task_id} 已忽略` : `任务 ${args.task_id} 不是待确认语义建议`,
          metadata: { ignored: ok },
        }
      }
      return { title: "impact_semantic_review", output: "action 必须是 confirm 或 ignore" }
    },
  }),
  cascade_rebuild_refs: defineTool({
    description:
      "全量重建依赖关系图。扫描所有章节正文、角色描述、卷纲摘要，重新建立 entity_refs 记录。用于首次启用级联系统或批量导入数据后补建依赖。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await cascadeRebuildRefs(db, novelId)
      return {
        title: "cascade_rebuild_refs",
        output: `已重建依赖关系：${result.chapters} 章正文 + ${result.characters} 角色描述 + ${result.volumes} 卷纲摘要`,
        metadata: result,
      }
    },
  }),
  cascade_execute: defineTool({
    description:
      "批量执行所有待统改任务（Saga 模式）。创建持久化 saga_session，按优先级逐个处理 pending_updates。character/volume 类型自动替换描述中的旧值，chapter 类型标记为需 @reviser 处理。处理完后自动重扫依赖。这是唯一能清除门禁阻断的方式。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      trigger_type: Schema.optional(Schema.String.annotate({ description: "可选：只处理特定触发类型的任务" })),
      trigger_id: Schema.optional(Schema.String.annotate({ description: "可选：只处理特定触发实体的任务" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await cascadeExecute(db, novelId, args.trigger_type, args.trigger_id)

      if (result.status === "no_tasks") {
        return {
          title: "cascade_execute（无任务）",
          output: "没有待统改任务，门禁已解除。",
          // SagaExecuteResult 是 interface，无隐式索引签名，展开为普通对象以满足 metadata 的 Record 类型
          metadata: { ...result },
        }
      }

      const chapterTasks = result.steps.filter((s) => s.source_type === "chapter" && s.action === "skipped")
      const lines = [
        `Saga ${result.saga_id.slice(0, 8)} ${result.status}`,
        `总计 ${result.total}：完成 ${result.completed}，跳过 ${result.skipped}，失败 ${result.failed}`,
      ]
      if (chapterTasks.length > 0) {
        lines.push(`待 @reviser 处理的章节任务：${chapterTasks.length} 个`)
        for (const t of chapterTasks.slice(0, 5)) {
          lines.push(`  - 章节 ${t.source_id}：${t.detail}`)
        }
      }
      if (result.failed > 0) {
        const failedSteps = result.steps.filter((s) => s.action === "failed")
        for (const s of failedSteps) {
          lines.push(`  [失败] ${s.source_type} ${s.source_id}：${s.detail}`)
        }
      }

      return {
        title: `cascade_execute（${result.status}）`,
        output: lines.join("\n"),
        metadata: { ...result },
      }
    },
  }),
  cascade_status: defineTool({
    description: "查询统改状态：pending 任务数、活跃 saga、最近 saga 记录。用于检查门禁是否激活或 saga 进度。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const status = await cascadeGetStatus(db, novelId)

      const lines: string[] = []
      if (status.pending_count > 0) {
        lines.push(`⚠ 门禁激活：${status.pending_count} 个待统改任务，write_chapter/revise_chapter 被拦截`)
      } else {
        lines.push("门禁未激活，可正常写作")
      }
      if (status.has_active_saga && status.active_saga) {
        const s = status.active_saga
        lines.push(
          `活跃 saga ${s.id.slice(0, 8)}：${s.completed_tasks}/${s.total_tasks} 完成，${s.failed_tasks} 失败`,
        )
      }
      if (status.recent_sagas.length > 0) {
        lines.push("最近 saga 记录：")
        for (const s of status.recent_sagas.slice(0, 3)) {
          lines.push(
            `  ${s.id.slice(0, 8)} [${s.status}] ${s.completed_tasks}/${s.total_tasks} -- ${s.trigger_type}:${s.trigger_id}`,
          )
        }
      }

      return {
        title: "cascade_status",
        output: lines.join("\n"),
        metadata: status,
      }
    },
  }),
}
