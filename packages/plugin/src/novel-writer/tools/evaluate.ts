/**
 * evaluate 域工具（V2 版）：自评价报告生成与诊断包导出入口。
 *
 * 手动 /evaluate 命令（D4.1 模板命令）与自动触发（3.1）共同的执行落点：
 * action=report 读指标桶聚合生成三分部规则模板报告；action=export 导出分级
 * 诊断包（D5）。产物均落盘 .novel/evaluate/ 并回贴；只读指标桶，不触碰写作数据。
 */
import { Schema } from "effect"
import { defineTool } from "../../v2/effect/tool.js"
import { exportDiagnostics } from "../evaluate/export.js"
import { generateReport, type ReportScope } from "../evaluate/report.js"
import { projectDirFromCtx } from "./shared.js"

function resolveScope(args: { scope?: "since-last" | "volume" | "sessions" | "all"; count?: number }): ReportScope {
  if (args.scope === "sessions") return { kind: "sessions", count: args.count ?? 5 }
  if (args.scope === "volume") return { kind: "volume" }
  if (args.scope === "all") return { kind: "all" }
  return { kind: "since-last" }
}

function exportOutput(result: ReturnType<typeof exportDiagnostics>): string {
  const base = `诊断包（${result.level}）已落盘：${result.path}\n指标条目 ${result.entryCount} 条`
  if (result.level === "L0") return `${base}（纯计数）`
  const withSamples = `${base}\n- 错误分类样本 ${result.sampleCount} 条（已脱敏截断，不含小说正文与题材值）`
  if (result.level === "L1") return withSamples
  return `${withSamples}\n- 复现事件序列 ${result.reproCount} 条\n注意：L2 诊断包含事件序列，可能含题材相关信息，分享前请自行检查。`
}

export const evaluateTools = {
  evaluate: defineTool({
    description:
      "生成创作自评价报告并落盘。三分部固定结构：A 创作复盘（卡壳地图/结构断更风险/批注密度）、B 配置优化建议（规则映射表逐条求值，只输出命中项）、C 产品信号（七域计数表+失败分类法+Top 复现）。读取 .novel/evaluate/metrics.jsonl 指标桶聚合，本工具只读不写写作数据，报告正文落盘 .novel/evaluate/<日期>-<范围>.md 后返回全文，供贴回会话。action=export 时改为导出分级诊断包（L0 纯计数/L1 脱敏错误样本/L2 复现序列），产物落盘 diagnostics-<日期>-<级别>.json。",
    args: Schema.Struct({
      action: Schema.optional(
        Schema.Literals(["report", "export"]).annotate({
          description: "report=生成报告（默认）/export=导出分级诊断包",
        }),
      ),
      level: Schema.optional(
        Schema.Literals(["L0", "L1", "L2"]).annotate({
          description: "action=export 时生效：L0 纯计数/L1 +脱敏错误样本（默认）/L2 +复现事件序列（可能含题材信息）",
        }),
      ),
      scope: Schema.optional(
        Schema.Literals(["since-last", "volume", "sessions", "all"]).annotate({
          description: "action=report 的统计范围：since-last=上次报告以来（默认）/volume=当前卷/sessions=最近 N 个会话/all=全部历史",
        }),
      ),
      count: Schema.optional(Schema.Number.annotate({ description: "action=report 且 scope=sessions 时的会话数 N，默认 5" })),
    }),
    async execute(args, ctx) {
      const projectDir = projectDirFromCtx(ctx.directory)
      if (args.action === "export") {
        const result = exportDiagnostics(projectDir, args.level ?? "L1")
        return {
          title: "evaluate export",
          output: exportOutput(result),
          metadata: {
            path: result.path,
            level: result.level,
            entry_count: result.entryCount,
            generated_at: result.generatedAt,
          },
        }
      }
      const result = generateReport(projectDir, resolveScope(args))
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
