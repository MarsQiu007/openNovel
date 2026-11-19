/**
 * 用户负反馈信号层：只保存稳定枚举与可追溯引用。
 *
 * 信号是低噪声原始 sink，不等同工具问题证据；只有用户确认后才升级为 user_report。
 * 检测完全本地确定性，不调用模型，也不把提示文本、对话、正文或附件写入 JSONL。
 */
import { createHash } from "node:crypto"
import { readToolInsightJsonl, type ToolInsightPaths } from "@opennovel-ai/novel-store"
import { isRecord } from "./evidence.js"

export const TOOL_INSIGHT_TARGET_SCOPES = ["writing", "tool", "process", "unknown"] as const
export const TOOL_INSIGHT_FEEDBACK_CATEGORIES = ["result_rejected", "tool_misuse", "flow_issue", "other"] as const

export type ToolInsightTargetScope = (typeof TOOL_INSIGHT_TARGET_SCOPES)[number]
export type ToolInsightFeedbackCategory = (typeof TOOL_INSIGHT_FEEDBACK_CATEGORIES)[number]

export interface ToolInsightSignal {
  id: string
  ts: number
  projectID: string
  sessionID: string
  promptMessageID: string
  targetScope: ToolInsightTargetScope
  feedbackCategory: ToolInsightFeedbackCategory
  occurrenceID: string
}

interface NegativeClassification {
  targetScope: ToolInsightTargetScope
  feedbackCategory: ToolInsightFeedbackCategory
}

const NEGATIVE_WORDS = [/不对/, /错了/, /用错/, /不是这样/, /理解错/, /做错/, /没有生效/, /不合理/, /有问题/]
const TOOL_MISUSE_WORDS = [/工具用错/, /用错工具/, /操作用错/, /用错了/, /不该调用/]
const FLOW_ISSUE_WORDS = [/流程/, /步骤/, /交互/, /操作繁琐/]

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

/** 本地确定性分类：没有明确负反馈词时不产生信号；只返回固定枚举 */
export function classifyNegativePrompt(text: string): NegativeClassification | undefined {
  const normalized = text.trim().toLowerCase()
  if (!NEGATIVE_WORDS.some((pattern) => pattern.test(normalized))) return undefined
  if (TOOL_MISUSE_WORDS.some((pattern) => pattern.test(normalized))) {
    return { targetScope: "tool", feedbackCategory: "tool_misuse" }
  }
  if (FLOW_ISSUE_WORDS.some((pattern) => pattern.test(normalized))) {
    return { targetScope: "process", feedbackCategory: "flow_issue" }
  }
  return { targetScope: "writing", feedbackCategory: "result_rejected" }
}

/** 同一项目内由事件信封派生；多实例观察到同一信封时得到同一 ID */
export function deriveSignalID(input: { projectID: string; eventID: string }): string {
  return `sig_${stableHash(`${input.projectID}\u0000${input.eventID}\u0000negative_feedback`)}`
}

/** 同一次提示只计一个发生实例；分类参与派生以避免不同信号共享跨类实例 */
export function deriveSignalOccurrenceID(input: {
  projectID: string
  sessionID: string
  promptMessageID: string
  targetScope: ToolInsightTargetScope
  feedbackCategory: ToolInsightFeedbackCategory
}): string {
  return `oci_${stableHash(
    [
      input.projectID,
      input.sessionID,
      input.promptMessageID,
      input.targetScope,
      input.feedbackCategory,
    ].join("\u0000"),
  )}`
}

export function signalAggregateKey(signal: Pick<ToolInsightSignal, "targetScope" | "feedbackCategory">): string {
  return `${signal.targetScope}:${signal.feedbackCategory}`
}

function isTargetScope(value: unknown): value is ToolInsightTargetScope {
  return typeof value === "string" && (TOOL_INSIGHT_TARGET_SCOPES as readonly string[]).includes(value)
}

function isFeedbackCategory(value: unknown): value is ToolInsightFeedbackCategory {
  return typeof value === "string" && (TOOL_INSIGHT_FEEDBACK_CATEGORIES as readonly string[]).includes(value)
}

export function parseSignal(value: unknown): ToolInsightSignal | undefined {
  if (!isRecord(value)) return undefined
  const id = value.id
  const ts = value.ts
  const projectID = value.projectID
  const sessionID = value.sessionID
  const promptMessageID = value.promptMessageID
  const targetScope = value.targetScope
  const feedbackCategory = value.feedbackCategory
  const occurrenceID = value.occurrenceID
  return typeof id === "string" &&
    typeof ts === "number" &&
    typeof projectID === "string" &&
    typeof sessionID === "string" &&
    typeof promptMessageID === "string" &&
    isTargetScope(targetScope) &&
    isFeedbackCategory(feedbackCategory) &&
    typeof occurrenceID === "string"
    ? {
        id,
        ts,
        projectID,
        sessionID,
        promptMessageID,
        targetScope,
        feedbackCategory,
        occurrenceID,
      }
    : undefined
}

export function readSignals(paths: ToolInsightPaths): ToolInsightSignal[] {
  return readToolInsightJsonl(paths.signals)
    .entries.map(parseSignal)
    .filter((signal): signal is ToolInsightSignal => signal !== undefined)
}

/** 升级状态以 evidence 白名单字段为账本；signals.jsonl 保持 append-only，不回写状态 */
export function upgradedSignalIDs(paths: ToolInsightPaths): Set<string> {
  const upgraded = new Set<string>()
  for (const entry of readToolInsightJsonl(paths.evidence).entries) {
    if (!isRecord(entry)) continue
    const signalID = Reflect.get(entry, "fields")
    if (!isRecord(signalID)) continue
    const value = Reflect.get(signalID, "signalID")
    if (typeof value === "string") upgraded.add(value)
  }
  return upgraded
}

export type ToolInsightSignalListEntry = ToolInsightSignal & { upgraded: boolean }

export function listSignals(paths: ToolInsightPaths): ToolInsightSignalListEntry[] {
  const upgraded = upgradedSignalIDs(paths)
  return readSignals(paths).map((signal) => ({ ...signal, upgraded: upgraded.has(signal.id) }))
}

/** 升级证据只携带信号 ID 与稳定事实；不复制原文或附件 */
export function toUpgradedEvidenceFields(signal: ToolInsightSignal): Record<string, unknown> {
  return {
    signalID: signal.id,
    signalAggregateKey: signalAggregateKey(signal),
    promptMessageID: signal.promptMessageID,
  }
}
