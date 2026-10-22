/**
 * state 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { syncArcProgress } from "../arc-progress.js"
import { loadFullCharacterBindingView } from "../drift-guards.js"
import { persistStateDelta, validateStateDelta } from "../pipeline.js"
import { commitStateWithReport, StateDeltaSchema } from "../state-commit.js"
import { getDb } from "../session-store.js"
import { defineTool } from "../../v2/effect/tool.js"
import { resolveNovelId } from "./shared.js"

export const stateTools = {
  validate_state_delta: defineTool({
    description: "验证状态变更。检查当前章节是否有有效的状态变更需要提交。流水线步骤6（reflect）。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await validateStateDelta(novelId, args.chapter_id, ctx.directory)
      return { title: "validate_state_delta", output: result.message, metadata: { status: result.status } }
    },
  }),
  commit_state_delta: defineTool({
    description:
      "提交状态变更到持久层（仅章节元数据）。注意：此工具只写入 chapter_summary 条目（标题/字数/状态/序号），不提取角色状态、剧情线索、伏笔等变更。完整状态提交请使用 commit_observer_delta 工具传入 observer/reflector 校验的 delta JSON。流水线步骤7（sync）应使用 commit_observer_delta，非此工具。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await persistStateDelta(novelId, args.chapter_id, ctx.directory)
      return { title: "commit_state_delta", output: result.message, metadata: { status: result.status } }
    },
  }),
  commit_observer_delta: defineTool({
    description:
      "提交 observer 提取并经 reflector 校验的状态变更 delta。接收 delta JSON 字符串，解析后调用 commitState 写入数据库日志和物化视图。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      chapter_id: Schema.String.annotate({ description: "章节 ID" }),
      delta_json: Schema.String.annotate({ description: "reflector 校验通过的 delta JSON 字符串" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      let delta
      try {
        delta = StateDeltaSchema.parse(JSON.parse(args.delta_json))
      } catch (err) {
        return {
          title: "commit_observer_delta",
          output: `delta JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
        }
      }
      try {
        const bindingView = await loadFullCharacterBindingView(db, novelId)
        const report = await commitStateWithReport(novelId, args.chapter_id, delta, db, bindingView)
        const lines: string[] = [`状态变更已提交，共 ${report.count} 条日志`]
        if (report.pending.length > 0) {
          lines.push(`\n📋 候选区新增 ${report.pending.length} 条（importance=1 或 type_strength=weak，待用户审阅）：`)
          for (const p of report.pending.slice(0, 5)) {
            const tag = p.type_strength ? ` [${p.type_strength}]` : ` [imp=${p.importance}]`
            lines.push(`  - [${p.candidate_type}${tag}] ${p.display_title} (id=${p.id.slice(0, 8)})`)
          }
          if (report.pending.length > 5) lines.push(`  …还有 ${report.pending.length - 5} 条`)
          lines.push(`  → 用 list_pending_settings 查看，accept_pending_setting / reject_pending_setting / merge_pending_settings 管理`)
        }
        if (report.conflicts.length > 0) {
          lines.push(`\n⚠️ 冲突标注 ${report.conflicts.length} 条（不污染 WorldEntryTable.content，已分离到 WorldEntryConflictTable）：`)
          for (const c of report.conflicts.slice(0, 5)) {
            lines.push(`  - [${c.conflict_kind}] ${c.conflict_note.slice(0, 80)}`)
          }
        }
        if (report.discarded > 0) {
          lines.push(`\n🗑️ 临时提及 ${report.discarded} 条（importance=0，不入库）`)
        }
        // 结构线/弧光进度同步：把锚定本章的节点标记为已写，更新弧光实际区间/状态
        const arcProgress = await syncArcProgress(db, novelId, args.chapter_id)
        if (arcProgress.beatsDrafted > 0) {
          lines.push(`\n🎬 弧光进度：${arcProgress.beatsDrafted} 个节点已落地`)
          if (arcProgress.arcsStarted.length > 0)
            lines.push(`  启动：${arcProgress.arcsStarted.join("、")}`)
          if (arcProgress.arcsCompleted.length > 0)
            lines.push(`  完结：${arcProgress.arcsCompleted.join("、")}`)
        }
        return {
          title: "commit_observer_delta",
          output: lines.join("\n"),
          metadata: { ...report, arcProgress },
        }
      } catch (err) {
        return {
          title: "commit_observer_delta",
          output: `状态提交失败：${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  }),
}
