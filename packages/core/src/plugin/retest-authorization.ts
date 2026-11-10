export * as RetestAuthorization from "./retest-authorization"

import { randomUUID } from "node:crypto"

/**
 * 复测执行授权注册表（任务 5.2）。
 *
 * 宿主在用户于原会话确认「执行」后签发随机授权 ID，进程级登记绑定：原会话、
 * 规范化案例摘要、剩余运行次数、模型与精确工具白名单。`startBackground` 对带
 * 工具的 retest 在 create 前逐次消费：任一绑定不符即拒绝；首次消费绑定调用方
 * 插件，之后跨插件复用一律拒绝。注册表只在进程内存活——进程重启后旧授权自然
 * 失效，无需持久化。
 */

export interface IssuedAuthorization {
  readonly id: string
  /** 发起确认的原会话：消费时必须与 originSessionID 一致 */
  readonly sessionID: string
  readonly caseDigest: string
  runsRemaining: number
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly expectedTools: readonly string[]
  /** 首次成功消费时绑定的请求插件；之后跨插件消费被拒绝 */
  pluginID?: string
}

const registry = new Map<string, IssuedAuthorization>()

export interface IssueInput {
  readonly sessionID: string
  readonly caseDigest: string
  readonly runs: number
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly expectedTools: readonly string[]
}

/** 签发随机执行授权 ID 并登记绑定；非法入参由调用方（宿主 confirm）先行校验 */
export function issue(input: IssueInput): IssuedAuthorization {
  const issued: IssuedAuthorization = {
    id: `ret_${randomUUID()}`,
    sessionID: input.sessionID,
    caseDigest: input.caseDigest,
    runsRemaining: input.runs,
    model: input.model,
    expectedTools: [...input.expectedTools],
  }
  registry.set(issued.id, issued)
  return issued
}

export type ConsumeResult =
  | { ok: true; remaining: number }
  | {
      ok: false
      reason: "unknown-authorization" | "session-mismatch" | "case-changed" | "model-changed" | "tools-changed" | "exhausted" | "plugin-mismatch"
    }

export interface ConsumeInput {
  readonly id: string
  /** 调用方插件（来自 per-plugin 宿主视图）；首次消费时绑定 */
  readonly pluginID: string
  readonly sessionID: string
  readonly caseDigest: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly expectedTools: readonly string[]
}

const sameModel = (left: { providerID: string; modelID: string }, right: { providerID: string; modelID: string }): boolean =>
  left.providerID === right.providerID && left.modelID === right.modelID

const sameTools = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((name, index) => name === sortedRight[index])
}

/**
 * 消费一次授权：按绑定逐项核对（未知授权/跨会话/跨案例/换模型/换白名单/超次数/
 * 跨插件均拒绝），全部通过才扣减次数。案例或授权摘要变化会使绑定失配，调用方
 * 必须重新走确认流程。
 */
export function consume(input: ConsumeInput): ConsumeResult {
  const issued = registry.get(input.id)
  if (issued === undefined) return { ok: false, reason: "unknown-authorization" }
  if (issued.sessionID !== input.sessionID) return { ok: false, reason: "session-mismatch" }
  if (issued.caseDigest !== input.caseDigest) return { ok: false, reason: "case-changed" }
  if (!sameModel(issued.model, input.model)) return { ok: false, reason: "model-changed" }
  if (!sameTools(issued.expectedTools, input.expectedTools)) return { ok: false, reason: "tools-changed" }
  if (issued.runsRemaining <= 0) return { ok: false, reason: "exhausted" }
  if (issued.pluginID !== undefined && issued.pluginID !== input.pluginID) return { ok: false, reason: "plugin-mismatch" }
  issued.pluginID = input.pluginID
  issued.runsRemaining -= 1
  return { ok: true, remaining: issued.runsRemaining }
}

/** 只读查询（诊断/测试用） */
export function lookup(id: string): IssuedAuthorization | undefined {
  return registry.get(id)
}

/** 测试隔离：清空注册表（生产路径不调用） */
export function resetForTests(): void {
  registry.clear()
}

export interface ConfirmRetestRequest {
  readonly question: string
  readonly runs: number
  readonly fixVersion: string
  readonly caseDigest: string
  readonly expectedTools: readonly string[]
}

/**
 * 复测确认入参校验（任务 5.2）：运行次数须为 1–20 整数，修复版本、问题与案例
 * 摘要非空，白名单非空且逐项非空。非法输入宿主直接拒绝，不弹确认对话框。
 */
export function validateConfirmInput(input: ConfirmRetestRequest): boolean {
  if (!Number.isInteger(input.runs) || input.runs < 1 || input.runs > 20) return false
  if (input.fixVersion.trim() === "") return false
  if (input.caseDigest.trim() === "") return false
  if (input.question.trim() === "") return false
  if (input.expectedTools.length === 0) return false
  return input.expectedTools.every((name) => name.trim() !== "")
}
