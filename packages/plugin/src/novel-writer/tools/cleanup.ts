/**
 * 章节清理修订提案工具（chapter-cleanup-review）。
 *
 * 导入整理纠错阶段的落库入口：子代理逐章产出结构化修订项（错字替换 /
 * 无用信息删除 / 重复段落删除 / 格式残留清理），经数据层校验后以待审状态
 * 落库；正文变更只发生在用户于审阅面板接受后的确定性应用中，工具自身
 * MUST NOT 修改章节正文。
 */
import { Schema } from "effect"
import type { SessionDomain } from "../../v2/effect/session.js"
import { defineTool } from "../../v2/effect/tool.js"
import { toolFailure } from "../../v2/effect/tool-failure.js"
import { createCleanupProposals, listCleanupProposals, countCleanupProposals } from "../session-store.js"
import { resolveSessionNovel } from "./session-novel.js"

const proposalSchema = Schema.Struct({
  kind: Schema.Literals(["typo_replace", "noise_remove", "duplicate_remove", "format_clean"]).annotate({
    description: "修订类型：错字替换 / 无用信息删除 / 重复段落删除 / 格式残留清理",
  }),
  paragraph_index: Schema.Number.annotate({ description: "段落索引（从 0 开始）" }),
  start_offset: Schema.Number.annotate({ description: "段内起始偏移" }),
  end_offset: Schema.Number.annotate({ description: "段内结束偏移（不含）" }),
  quote: Schema.String.annotate({ description: "锚点处原文逐字引用（应用时将全等校验）" }),
  replacement: Schema.optional(Schema.String.annotate({ description: "建议文本；删除类必须省略或为空" })),
  reason: Schema.optional(Schema.String.annotate({ description: "修订理由" })),
  confidence: Schema.optional(Schema.Number.annotate({ description: "置信度 0..1；错字替换与格式清理 ≥0.9 视为低风险可批量" })),
})

export function createCleanupTools(deps: { session: SessionDomain }) {
  return {
    propose_cleanup: defineTool({
      description:
        "将导入整理纠错阶段的修订建议批量落库为待审修订提案（不修改正文）。proposals 每条含修订类型、段落锚点、原文逐字引用、建议文本、理由与置信度；删除类（noise_remove/duplicate_remove）不得携带 replacement。任一条非法将整批拒绝，请修正后重新提交全部条目。",
      args: Schema.Struct({
        chapter_id: Schema.String.annotate({ description: "章节 ID（来自 list_chapters / read_chapter 的真实 ID，禁止虚构）" }),
        source_run_id: Schema.optional(Schema.String.annotate({ description: "关联的整理队列 WorkRun ID" })),
        proposals: Schema.Array(proposalSchema).annotate({ description: "修订项数组；建议逐条提交，同一章可合并提交" }),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) {
          throw toolFailure(
            "not_found",
            "未找到当前小说项目。请先在全局对话用 init_novel 初始化书籍，或确认会话已绑定小说后再提交修订提案。",
          )
        }
        let ids: string[]
        try {
          ids = createCleanupProposals(
            {
              novelId,
              chapterId: args.chapter_id,
              sourceRunId: args.source_run_id,
              proposals: args.proposals.map((p) => ({
                kind: p.kind,
                paragraph_index: p.paragraph_index,
                start_offset: p.start_offset,
                end_offset: p.end_offset,
                quote: p.quote,
                replacement: p.replacement,
                reason: p.reason,
                confidence: p.confidence,
              })),
            },
            ctx.directory,
          )
        } catch (error) {
          throw toolFailure("param_error", error instanceof Error ? error.message : String(error))
        }
        return `已落库 ${ids.length} 条修订提案（待审状态，未修改正文）。用户可在设定树的「清理修订」审阅面板逐条或批量接受；汇总汇报请通过 list_cleanup 查询提案计数获取已应用/待审/拒绝实数。`
      },
    }),
    list_cleanup: defineTool({
      description:
        "查询当前小说的章节清理修订提案：可选按状态（pending/applied/rejected/failed/reverted）与章节过滤，返回各状态计数与提案明细（类型、锚点、原文/建议对照、理由、置信度、失败原因）。用于汇总汇报输出已应用/待审/拒绝实数，以及审阅前的现状核对。",
      args: Schema.Struct({
        status: Schema.optional(Schema.String.annotate({ description: "按状态过滤，缺省返回全部" })),
        chapter_id: Schema.optional(Schema.String.annotate({ description: "按章节过滤" })),
      }),
      async execute(args, ctx) {
        const novelId = await resolveSessionNovel(deps.session, ctx.sessionID, ctx.directory)
        if (!novelId) {
          throw toolFailure(
            "not_found",
            "未找到当前小说项目。请先在全局对话用 init_novel 初始化书籍，或确认会话已绑定小说后再查询。",
          )
        }
        const rows = listCleanupProposals(novelId, { status: args.status, chapterId: args.chapter_id }, ctx.directory)
        const counts = countCleanupProposals(novelId, ctx.directory)
        const summary = Object.entries(counts)
          .map(([status, n]) => `${status}=${n}`)
          .join("，")
        if (rows.length === 0) return `无修订提案记录。计数：${summary || "全空"}。`
        const lines = rows
          .slice(0, 50)
          .map(
            (p) =>
              `- [${p.status}] ${p.kind} 章节 ${p.chapter_id} 段${p.paragraph_index}:${p.start_offset}-${p.end_offset} 「${p.quote}」→「${p.replacement}」置信度 ${p.confidence}${p.fail_reason ? ` 失败原因：${p.fail_reason}` : ""}${p.reason ? `（${p.reason}）` : ""}`,
          )
        return `计数：${summary || "全空"}。提案明细（前 ${Math.min(rows.length, 50)} 条，共 ${rows.length} 条）：\n${lines.join("\n")}`
      },
    }),
  }
}
