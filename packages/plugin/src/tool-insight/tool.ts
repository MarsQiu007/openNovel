/**
 * 独立 `tool_insight` 插件工具（任务 3.4）：用户主动记录、补充反馈与重新整理入口。
 *
 * 用户反馈与正文例外是不同输入字段：普通反馈经白名单脱敏截断后保存，正文片段
 * 只能经 `content_exception` 字段显式提交（本地保留授权），不能把正文塞进反馈
 * 绕过白名单。新一次发生使用独立 ULID；补充既有问题沿用被补充的发生实例 ID，
 * 只有 `new_occurrence` 明确为 true 才创建新实例——补充反馈不增加出现次数。
 *
 * 动作分发（自然语言入口经 /evaluate 模板映射到这里）：
 * - record：记录一个新问题（无工具失败也可以，覆盖体验/流程问题）
 * - supplement：向既有问题追加反馈证据（按指纹定位，沿用原发生实例）
 * - reorganize：把既有问题全部证据放回 pending，交后台整理重新生成假设段落
 *
 * 开关未启用时显式拒绝，不静默落盘。全部写入走跨进程锁与既有非阻断纪律。
 */
import { Schema } from "effect"
import {
  appendEvidenceUnderLock,
} from "./evidence-store.js"
import {
  createContentException,
  createUlid,
  deriveEvidenceID,
  redactSummary,
  type ToolInsightEvidence,
} from "./evidence.js"
import { openToolInsightGate } from "./gate.js"
import { issueFingerprint } from "./issue-doc.js"
import { ingestEvidenceIssue, readIssueMeta, requestReorganize } from "./issue-store.js"
import type { FileDomain } from "../v2/effect/file.js"
import { defineTool } from "../v2/effect/tool.js"

/** 用户报告类问题的稳定指纹：无工具、用户报告场景；反馈文本不进入指纹 */
const USER_REPORT_FACTS = { tool: "", scenario: "user_report", errorCategory: "user_report" } as const

export function createToolInsightTool(deps: { configDir: string; file: Pick<FileDomain, "withLock"> }) {
  return defineTool({
    description:
      "记录、补充或重新整理工具改进问题（工具改进日志）。action=record 记录新问题：无报错的繁琐操作、理解偏差、写作之外的交互问题都可以，feedback 描述用户目标与实际体验；正文片段必须用 content_exception 字段单独提交（显式同意本地保留），不能混入 feedback。action=supplement 按 fingerprint 向既有问题补充反馈，沿用原发生实例不增加出现次数，只有明确报告新一次发生时才传 new_occurrence=true。action=reorganize 按 fingerprint 触发重新整理：全部证据重新生成原因假设与改进建议。三个动作都不修改任何写作数据。",
    args: Schema.Struct({
      action: Schema.Literals(["record", "supplement", "reorganize"]).annotate({
        description: "record=记录新问题/supplement=补充既有问题/reorganize=重新整理既有问题",
      }),
      feedback: Schema.optional(
        Schema.String.annotate({ description: "普通反馈文本（会被脱敏截断保存）；正文片段禁止放这里" }),
      ),
      content_exception: Schema.optional(
        Schema.String.annotate({
          description: "必要正文片段，独立于普通反馈的字段：显式同意本地保留该片段；模型使用需另行授权",
        }),
      ),
      fingerprint: Schema.optional(
        Schema.String.annotate({ description: "action=supplement/reorganize 时的问题指纹（index.md 或问题文档可查）" }),
      ),
      new_occurrence: Schema.optional(
        Schema.Boolean.annotate({ description: "supplement 专用：仅当明确是又一次新发生时才传 true（会新增出现次数）" }),
      ),
    }),
    async execute(args, ctx) {
      if (args.action !== "record" && args.fingerprint === undefined) {
        return { title: "tool_insight", output: `action=${args.action} 需要提供 fingerprint（可在问题索引 index.md 查到）。` }
      }
      const opened = openToolInsightGate({
        configDir: deps.configDir,
        projectDirectory: ctx.directory,
        warnOnce: (message) => console.warn(`[tool-insight] ${message}`),
      })
      if (opened === undefined) {
        return {
          title: "tool_insight",
          output: "工具改进日志未启用：请在设置中开启后使用。本次未记录任何内容。",
        }
      }
      const paths = opened.paths
      const file = deps.file
      const ts = Date.now()

      if (args.action === "reorganize") {
        const result = await requestReorganize(file, paths, { fingerprint: args.fingerprint! })
        if (!result.queued) {
          return {
            title: "tool_insight",
            output: `重新整理未完成（${result.reason === "missing" ? "问题不存在" : result.reason}），未做任何修改。`,
          }
        }
        return {
          title: "tool_insight",
          output: `问题 ${args.fingerprint} 已回到待整理状态：全部证据将在后台重新生成原因假设与改进建议，原有内容保留到新结论写入为止。`,
          metadata: { fingerprint: args.fingerprint, action: "reorganize" },
        }
      }

      if (args.feedback === undefined && args.content_exception === undefined) {
        return {
          title: "tool_insight",
          output: "请至少提供 feedback（普通反馈）或 content_exception（明确同意本地保留的正文片段）之一。",
        }
      }

      // 定位发生实例：record 恒新 ULID；supplement 默认沿用文档最后一个发生实例
      let fingerprintHash = issueFingerprint(USER_REPORT_FACTS)
      let occurrenceID = `oci_${createUlid(ts)}`
      if (args.action === "supplement") {
        const meta = readIssueMeta(paths, args.fingerprint!)
        if (meta.error !== undefined) {
          return {
            title: "tool_insight",
            output: `问题 ${args.fingerprint} ${meta.error === "missing" ? "不存在" : "文档损坏"}，无法补充；请确认指纹后重试或用 record 记录新问题。`,
          }
        }
        fingerprintHash = args.fingerprint!
        if (args.new_occurrence !== true) {
          const last = meta.meta.occurrence_ids[meta.meta.occurrence_ids.length - 1]
          if (last !== undefined) occurrenceID = last
        }
      }

      const records: ToolInsightEvidence[] = []
      if (args.feedback !== undefined) {
        records.push({
          id: deriveEvidenceID({ projectID: opened.projectID, eventID: `user:${ts}:${occurrenceID}:feedback`, kind: "user_report" }),
          ts,
          kind: "user_report",
          projectID: opened.projectID,
          sessionID: ctx.sessionID,
          trigger: "user",
          occurrenceID,
          fields: { userFeedback: redactSummary(args.feedback) },
        })
      }
      // 正文例外独立证据：显式提交字段才会保存片段本体（本地保留授权）
      if (args.content_exception !== undefined) {
        const exception = createContentException({ text: args.content_exception, retainedAt: ts })
        records.push({
          id: deriveEvidenceID({ projectID: opened.projectID, eventID: `user:${ts}:${occurrenceID}:exception`, kind: "content_exception" }),
          ts,
          kind: "content_exception",
          projectID: opened.projectID,
          sessionID: ctx.sessionID,
          trigger: "user",
          occurrenceID,
          fields: {
            exceptionID: exception.id,
            length: exception.length,
            retainedAt: exception.retainedAt,
            shareWarning: exception.shareWarning,
            text: exception.text,
          },
        })
      }

      const appended = await appendEvidenceUnderLock(file, paths, records)
      if (!appended.appended) {
        return {
          title: "tool_insight",
          output: `证据落盘未完成（${appended.reason}），本次未记录；日志目录或文件锁可能不可用，请稍后重试。`,
        }
      }
      const primary = records[0]
      let ingestNote = ""
      if (primary !== undefined) {
        const ingested = await ingestEvidenceIssue(file, paths, {
          fingerprint: fingerprintHash,
          evidenceID: primary.id,
          occurrenceID,
          evidenceKind: primary.kind,
          occurredAt: ts,
          facts:
            args.action === "supplement" && args.new_occurrence !== true
              ? { ...USER_REPORT_FACTS, fact: "supplement" }
              : USER_REPORT_FACTS,
        })
        ingestNote = ingested.documented
          ? ingested.newOccurrence
            ? `问题文档已更新（出现次数 +1，指纹 ${fingerprintHash}）。`
            : `反馈已追加到既有问题（指纹 ${fingerprintHash}），出现次数不变。`
          : `问题文档未更新（${ingested.reason}），证据本身已保存。`
      }
      const summary =
        args.action === "record"
          ? "已记录为新的一次发生。"
          : args.new_occurrence === true
            ? "已按新一次发生记录。"
            : "已作为补充反馈追加，沿用原发生实例。"
      return {
        title: "tool_insight",
        output: `${summary}${ingestNote}\n证据 ${records.map((record) => record.id).join("、")} 已保存到本地日志（${paths.root}）。`,
        metadata: {
          action: args.action,
          occurrence_id: occurrenceID,
          fingerprint: fingerprintHash,
          evidence_ids: records.map((record) => record.id),
        },
      }
    },
  })
}
