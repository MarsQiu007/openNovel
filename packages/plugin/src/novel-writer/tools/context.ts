/**
 * context 域写作工具（V2 版）。从 novel-writer.ts 机械转换，窗口期 V1 入口保留同名 zod 版；execute 函数体与 V1 逐字一致。
 */
import { Schema } from "effect"
import { lookupClosedThreads, lookupDormantCharacters, lookupPastVolumes, memoryLookup, memorySearch } from "../archive.js"
import { getHookStats } from "../hook-rotation.js"
import { assembleWriterSnapshot, recallByQuery } from "../recall.js"
import { performVolumeRollup } from "../rollup.js"
import { buildMaintenanceReport, getDb, PLANNED_STALL_CHAPTER_THRESHOLD } from "../session-store.js"
import { defineTool } from "../../v2/effect/tool.js"
import { resolveNovelId } from "./shared.js"

export const contextTools = {
  assemble_context_snapshot: defineTool({
    description:
      "组装上下文快照。查询小说蓝图、活跃角色、最近3章摘要、剧情线索、伏笔、风格指南等。流水线步骤2（compose）。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      chapter_number: Schema.Number.annotate({ description: "当前章节序号" }),
      focus: Schema.optional(
        Schema.String.annotate({ description: "查询焦点关键词，传入时召回围绕该焦点检索而非使用章纲" }),
      ),
      content_nature: Schema.optional(
        Schema.Literals(["adult", "general"]).annotate({
          description:
            "本章内容性质判断：仅当本书为成人内容书且本章将写作成人内容时才传 adult；缺省不传或传 general，成人技法候选不会出现",
        }),
      ),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const snapshot = await assembleWriterSnapshot(
        novelId,
        args.chapter_number,
        ctx.directory,
        args.focus,
        args.content_nature,
      )
      if (!snapshot) {
        return { title: "assemble_context_snapshot", output: `无法组装上下文快照，小说 ${novelId} 不存在` }
      }
      const hookStats = await getHookStats(novelId, 10, ctx.directory)
      const { formatSnapshotToolOutput } = await import("../context.js")
      // 技法一律 shadow 候选输出；注入由 pipeline 评估后调 confirm_techniques 计数
      const { output, metadata } = formatSnapshotToolOutput(snapshot, hookStats)
      return { title: "assemble_context_snapshot", output, metadata }
    },
  }),
  recall_history: defineTool({
    description:
      "按关键词召回历史章节。用于查询前文发生过的事件、承诺、数字、对话等细节。summary 模式返回章节摘要，snippet 模式返回正文中匹配位置前后各200字的片段。写当前章需要回忆前文细节时使用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      query: Schema.String.annotate({ description: "查询关键词（角色名、事件、物品、地名等，3字以上效果最佳）" }),
      scope: Schema.optional(
        Schema.Literals(["summary", "snippet"]).annotate({
          description: "返回模式：summary（默认）返回摘要，snippet 返回正文片段",
        }),
      ),
      limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 5" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const results = await recallByQuery(db, novelId, args.query, args.limit ?? 5, args.scope ?? "summary")
      if (results.length === 0) {
        return { title: "recall_history", output: `未找到与「${args.query}」相关的章节` }
      }
      const lines = [`找到 ${results.length} 条与「${args.query}」相关的章节：`]
      for (const r of results) {
        lines.push(`- 第${r.chapterNumber}章 ${r.chapterTitle}（${r.matchedBy}）`)
        if (r.snippet) lines.push(`  ${r.snippet}`)
      }
      return { title: "recall_history", output: lines.join("\n"), metadata: { count: results.length } }
    },
  }),
  lookup_dormant_characters: defineTool({
    description:
      "查询休眠角色。查找小说中处于休眠状态（不再活跃出场）的角色，按角色名模糊匹配，最多返回 3 条摘要。供 librarian 查询世界百科使用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      query: Schema.String.annotate({ description: "搜索关键词（匹配角色名）" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const results = await lookupDormantCharacters(novelId, args.query, ctx.directory)
      if (results.length === 0) {
        return { title: "lookup_dormant_characters", output: `未找到匹配「${args.query}」的休眠角色` }
      }
      return {
        title: "lookup_dormant_characters",
        output: results.map((r) => `- ${r.name}：${r.summary}`).join("\n"),
        metadata: { count: results.length },
      }
    },
  }),
  lookup_closed_threads: defineTool({
    description:
      "查询已关闭线索。查找小说中已关闭的剧情线索，按线索标题模糊匹配，最多返回 3 条摘要。供 librarian 查询世界百科使用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      query: Schema.String.annotate({ description: "搜索关键词（匹配线索标题）" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const results = await lookupClosedThreads(novelId, args.query, ctx.directory)
      if (results.length === 0) {
        return { title: "lookup_closed_threads", output: `未找到匹配「${args.query}」的已关闭线索` }
      }
      return {
        title: "lookup_closed_threads",
        output: results.map((r) => `- ${r.title}：${r.summary}`).join("\n"),
        metadata: { count: results.length },
      }
    },
  }),
  lookup_past_volumes: defineTool({
    description:
      "查询历史卷摘要。查找指定卷号之前的历史卷摘要，最多返回 3 条（按卷号降序，最近优先）。供 librarian 查询世界百科使用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      volume_number: Schema.Number.annotate({ description: "当前卷号（返回比此卷号小的历史卷）" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const results = await lookupPastVolumes(novelId, args.volume_number, ctx.directory)
      if (results.length === 0) {
        return { title: "lookup_past_volumes", output: `第${args.volume_number}卷之前暂无历史卷摘要` }
      }
      return {
        title: "lookup_past_volumes",
        output: results.map((r) => `- ${r.title}：${r.summary}`).join("\n"),
        metadata: { count: results.length },
      }
    },
  }),
  memory_search: defineTool({
    description:
      "记忆全文检索。对记忆事实库（observer 提取的逐字引句事实）做全文搜索，支持按事实类型/状态/实体提示/章节范围过滤，默认返回 3 条（limit 可放宽）。供 librarian 检索召回使用；章节摘要检索请用 recall_history。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      query: Schema.String.annotate({ description: "全文检索关键词（3 字以上效果最佳）" }),
      fact_type: Schema.optional(Schema.String.annotate({ description: "事实类型过滤（如 timeline）" })),
      status: Schema.optional(Schema.String.annotate({ description: "状态过滤（pending/reviewed/approved/stale/retired）" })),
      entity_hint: Schema.optional(Schema.String.annotate({ description: "关联实体提示过滤" })),
      chapter_from: Schema.optional(Schema.Number.annotate({ description: "章节序号下限（含）" })),
      chapter_to: Schema.optional(Schema.Number.annotate({ description: "章节序号上限（含）" })),
      limit: Schema.optional(Schema.Number.annotate({ description: "最多返回条数，默认 3" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const results = await memorySearch(
        novelId,
        args.query,
        {
          factType: args.fact_type,
          status: args.status,
          entityHint: args.entity_hint,
          chapterFrom: args.chapter_from,
          chapterTo: args.chapter_to,
          limit: args.limit,
        },
        ctx.directory,
      )
      if (results.length === 0) {
        return { title: "memory_search", output: `未找到匹配「${args.query}」的记忆事实` }
      }
      const lines = results.map((r) => {
        const where = r.chapterOrder === null ? "章节未知" : `第${r.chapterOrder}章`
        const quote = r.quote ? `\n  引句：${r.quote}` : ""
        return `- [${r.status}] ${where} ${r.text}${quote}`
      })
      return { title: "memory_search", output: lines.join("\n"), metadata: { count: results.length } }
    },
  }),
  memory_lookup: defineTool({
    description:
      "实体全史查询。回答「某实体在哪几章出现过、关联哪些记忆事实」：合并角色/世界观本体、记忆事实（entity_hint）与章节引用。供 librarian 检索召回使用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      entity_id: Schema.String.annotate({ description: "实体 ID（角色/世界观条目 ID 或 entity_hint 提示串）" }),
      limit: Schema.optional(Schema.Number.annotate({ description: "事实与出现章节各自最多返回条数，默认 10" })),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const history = await memoryLookup(novelId, args.entity_id, args.limit ?? 10, ctx.directory)
      if (!history) {
        return { title: "memory_lookup", output: `未找到实体「${args.entity_id}」的任何记录` }
      }
      const lines = [`实体「${history.title}」（${history.kind}）全史：`]
      if (history.appearances.length > 0) {
        lines.push(`出现章节：${history.appearances.map((a) => `第${a.chapterOrder}章`).join("、")}`)
      }
      for (const fact of history.facts) {
        const where = fact.chapterOrder === null ? "章节未知" : `第${fact.chapterOrder}章`
        lines.push(`- [${fact.status}] ${where} ${fact.text}`)
      }
      return {
        title: "memory_lookup",
        output: lines.join("\n"),
        metadata: { facts: history.facts.length, appearances: history.appearances.length },
      }
    },
  }),
  memory_maintenance: defineTool({
    description:
      "记忆维护报告（agent-memory-system §6 定时兜底，报告制不自动删）。汇总本书的僵尸卡（stale 失效未消化）、planned 设定滞留（创建后新增章数达阈值）与 retired 归档统计，供作者决定后续处理。供 librarian 定期巡检使用。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const report = buildMaintenanceReport(db, novelId)
      const stalled = report.planned.filter((p) => p.stalled)
      const lines = ["记忆维护报告（报告制，不自动删除）："]
      lines.push(`- 僵尸卡（失效未消化）：${report.zombieFacts.length} 张`)
      for (const z of report.zombieFacts.slice(0, 10)) {
        lines.push(`  - ${z.chapterOrder === null ? "章节未知" : `第${z.chapterOrder}章`} ${z.text.slice(0, 60)}`)
      }
      if (report.zombieFacts.length > 10) lines.push(`  … 另有 ${report.zombieFacts.length - 10} 张，可用 memory_search status=stale 检索`)
      lines.push(`- planned 设定滞留（创建后已新增 ≥${PLANNED_STALL_CHAPTER_THRESHOLD} 章）：${stalled.length} 条`)
      for (const p of stalled.slice(0, 10)) {
        lines.push(`  - [${p.kind === "character" ? "角色" : "设定"}] ${p.title}（创建后已写 ${p.chaptersSince} 章仍未落文）`)
      }
      lines.push(`- planned 设定（近期）：${report.planned.length - stalled.length} 条`)
      lines.push(`- retired 归档：记忆事实 ${report.retiredStats.facts} 张 / 技巧 ${report.retiredStats.techniques} 条`)
      return {
        title: "memory_maintenance",
        output: lines.join("\n"),
        metadata: {
          zombie_facts: report.zombieFacts.length,
          planned_stalled: stalled.length,
          planned_total: report.planned.length,
          retired_facts: report.retiredStats.facts,
          retired_techniques: report.retiredStats.techniques,
        },
      }
    },
  }),
  volume_rollup: defineTool({
    description:
      "执行卷级汇总。生成卷摘要、标记角色 active/dormant、归档已关闭线索，写入卷摘要记录。章节归属以 chapters.volume_id 为准（卷长度由剧情决定）。新卷首章生成大纲时会自动对上一卷汇总；本工具用于手动触发（如全书最后一卷完结时）。幂等，可安全重复。",
    args: Schema.Struct({
      novel_id: Schema.String.annotate({ description: "小说 ID" }),
      volume_number: Schema.Number.annotate({ description: "卷号（从 1 开始）" }),
    }),
    async execute(args, ctx) {
      const db = getDb(ctx.directory)
      const novelId = await resolveNovelId(db, args.novel_id)
      const result = await performVolumeRollup(novelId, args.volume_number, ctx.directory)
      if (!result) {
        return { title: "volume_rollup", output: `第${args.volume_number}卷不存在或本卷暂无可汇总的章节` }
      }
      return {
        title: "volume_rollup",
        output: `已完成第${args.volume_number}卷汇总`,
        metadata: { novel_id: novelId, ...result },
      }
    },
  }),
}
