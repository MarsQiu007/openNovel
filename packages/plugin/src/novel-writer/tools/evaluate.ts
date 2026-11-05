/**
 * evaluate 域工具（V2 版）：自评价报告生成入口。
 *
 * 手动 /evaluate 命令（D4.1 模板命令）与后续自动触发（3.1）共同的执行落点：
 * 读指标桶聚合生成三分部规则模板报告，产物落盘 .novel/evaluate/ 并回贴全文。
 * 只读指标桶，不触碰任何写作数据。
 */
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import { generateReport, type ReportScope } from "../evaluate/report.js"
import { projectDirFromCtx } from "./shared.js"

function resolveScope(args: { scope?: "since-last" | "volume" | "sessions" | "all"; count?: number }): ReportScope {
  if (args.scope === "sessions") return { kind: "sessions", count: args.count ?? 5 }
  if (args.scope === "volume") return { kind: "volume" }
  if (args.scope === "all") return { kind: "all" }
  return { kind: "since-last" }
}

export const evaluateTools = {
  evaluate: defineTool({
    description:
      "生成创作自评价报告并落盘。三分部固定结构：A 创作复盘（卡壳地图/结构断更风险/批注密度）、B 配置优化建议（规则映射表逐条求值，只输出命中项）、C 产品信号（七域计数表+失败分类法+Top 复现）。读取 .novel/evaluate/metrics.jsonl 指标桶聚合，本工具只读不写写作数据，报告正文落盘 .novel/evaluate/<日期>-<范围>.md 后返回全文，供贴回会话。",
    args: Schema.Struct({
      scope: Schema.optional(
        Schema.Literals(["since-last", "volume", "sessions", "all"]).annotate({
          description: "统计范围：since-last=上次报告以来（默认）/volume=当前卷/sessions=最近 N 个会话/all=全部历史",
        }),
      ),
      count: Schema.optional(Schema.Number.annotate({ description: "scope=sessions 时的会话数 N，默认 5" })),
    }),
    async execute(args, ctx) {
      const result = generateReport(projectDirFromCtx(ctx.directory), resolveScope(args))
      return {
        title: "evaluate",
        output: `${result.markdown}\n---\n报告已落盘：${result.path}（窗口内指标条目 ${result.entryCount} 条，范围 ${result.scopeSlug}）`,
        metadata: {
          path: result.path,
          scope: result.scopeSlug,
          entry_count: result.entryCount,
          generated_at: result.generatedAt,
        },
      }
    },
  }),
}
