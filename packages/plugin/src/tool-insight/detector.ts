/**
 * 完整轨迹检测与六类失败分类（任务 3.2）— 纯函数，无 IO。
 *
 * 输入触发事实与按发生顺序排列的调用轨迹，输出稳定指纹输入与分类候选。
 * 自动检测阶段不确认主分类（spec：证据不足标「未确认」，可保留多个候选假设，
 * 不强行选择也不把推测写成已确认根因）；确认归因是后台模型整理（任务 4.1）的职责。
 *
 * 指纹只由稳定事实派生：规范化工具名、检测类别、稳定错误码或类别、调用形状签名。
 * 模型自由文本、时间、Session、章节名和绝对路径不进入任何指纹输入。
 */
import type { ToolInsightClassification, ToolInsightFingerprintInput } from "./issue-doc.js"

/** 六类检测类别：检测维度与工具问题分类是两层——检测事实归类为分类候选 */
export type DetectionKind =
  | "missing_call"
  | "wrong_tool"
  | "bad_params"
  | "redundant_repeat"
  | "recovery_failed"
  | "surface_success"

/**
 * 检测类别到工具问题分类的候选映射：一个检测事实通常支持多种解释
 * （如先选错工具既可能误用也可能描述不清），候选全部保留供归因裁定。
 */
export const DETECTION_CANDIDATES: Record<DetectionKind, readonly ToolInsightClassification[]> = {
  missing_call: ["agent_misuse", "product_flow"],
  wrong_tool: ["agent_misuse", "tool_description_or_params"],
  bad_params: ["tool_description_or_params", "agent_misuse"],
  redundant_repeat: ["agent_misuse"],
  recovery_failed: ["tool_impl_defect", "agent_misuse"],
  surface_success: ["tool_result_misread", "tool_impl_defect"],
}

export interface TrajectoryCall {
  callID: string
  tool: string
  status: "called" | "success" | "failed"
  /** 参数键集合（脱敏后的键名列表，排序稳定） */
  paramKeys?: readonly string[]
  /** 稳定错误类别（errorType/errorCode，不含错误文案） */
  errorCategory?: string
}

export interface DetectInput {
  trigger: {
    kind: DetectionKind
    /** 触发调用的工具名；missing_call 时为空串 */
    tool: string
    errorCategory?: string
  }
  /** 完整轨迹窗口（按发生顺序）；missing_call 时可为空 */
  calls?: readonly TrajectoryCall[]
  /** missing_call 专用：用户目标对应的应有工具（稳定工具名） */
  expectedTool?: string
}

export interface DetectResult {
  kind: DetectionKind
  /** 自动检测恒不确认主分类；归因确认是后台整理的职责 */
  confirmed: false
  classification: "unconfirmed"
  candidates: readonly ToolInsightClassification[]
  fingerprint: ToolInsightFingerprintInput
  /** 支持本次检测的轨迹事实摘要（工具名与状态序列，稳定无自由文本） */
  factDetail: string
}

const paramSignature = (call: TrajectoryCall): string => (call.paramKeys ?? []).join(",")

/** 调用形状签名：工具名+状态序列，无时间无自由文本，同轨迹恒同串 */
function shapeSignature(calls: readonly TrajectoryCall[]): string {
  return calls.map((call) => `${call.tool}:${call.status}`).join(">")
}

export function detect(input: DetectInput): DetectResult {
  const calls = input.calls ?? []
  const kind = input.trigger.kind
  const candidates = DETECTION_CANDIDATES[kind]

  if (kind === "missing_call") {
    const expected = input.expectedTool ?? ""
    return {
      kind,
      confirmed: false,
      classification: "unconfirmed",
      candidates,
      fingerprint: {
        tool: expected,
        scenario: kind,
        errorCategory: "user_report",
        fact: expected === "" ? undefined : "declared-without-call",
      },
      factDetail: calls.length > 0 ? shapeSignature(calls) : "无对应工具调用记录",
    }
  }

  const tool = input.trigger.tool

  if (kind === "wrong_tool") {
    // 轨迹证据：另一个工具失败后本工具完成同类目标
    const failedBefore = calls.find((call) => call.tool !== tool && call.status === "failed")
    const fact =
      failedBefore !== undefined
        ? `switch:${failedBefore.tool}->${tool}`
        : undefined
    return {
      kind,
      confirmed: false,
      classification: "unconfirmed",
      candidates,
      fingerprint: { tool, scenario: kind, errorCategory: input.trigger.errorCategory ?? "unknown", fact },
      factDetail: shapeSignature(calls),
    }
  }

  if (kind === "bad_params") {
    // 轨迹证据：同工具失败后改参数成功（参数键集合变化）
    const failedCalls = calls.filter((call) => call.tool === tool && call.status === "failed")
    const successAfter = [...calls].reverse().find((call) => call.tool === tool && call.status === "success")
    const changed =
      successAfter !== undefined &&
      failedCalls.some((call) => paramSignature(call) !== paramSignature(successAfter))
    return {
      kind,
      confirmed: false,
      classification: "unconfirmed",
      candidates,
      fingerprint: {
        tool,
        scenario: kind,
        errorCategory: input.trigger.errorCategory ?? failedCalls[0]?.errorCategory ?? "unknown",
        fact: changed ? "params-changed-then-success" : undefined,
      },
      factDetail: shapeSignature(calls),
    }
  }

  if (kind === "redundant_repeat") {
    // 轨迹证据：完全相同 tool+paramKeys 的调用连续重复（次数不进指纹，避免次数增长分裂文档）
    let longest = 1
    let current = 1
    for (let index = 1; index < calls.length; index++) {
      const previous = calls[index - 1]
      const call = calls[index]
      if (previous && call && previous.tool === call.tool && paramSignature(previous) === paramSignature(call)) {
        current++
        if (current > longest) longest = current
      } else {
        current = 1
      }
    }
    return {
      kind,
      confirmed: false,
      classification: "unconfirmed",
      candidates,
      fingerprint: { tool, scenario: kind, errorCategory: input.trigger.errorCategory ?? "unknown", fact: longest >= 2 ? "same-call-repeated" : undefined },
      factDetail: shapeSignature(calls),
    }
  }

  if (kind === "recovery_failed") {
    // 轨迹证据：失败后同工具重试仍失败，中间无成功
    let sawFailure = false
    let retried = false
    for (const call of calls) {
      if (call.tool !== tool) continue
      if (call.status === "failed") {
        if (sawFailure) retried = true
        sawFailure = true
      } else if (call.status === "success") {
        sawFailure = false
      }
    }
    return {
      kind,
      confirmed: false,
      classification: "unconfirmed",
      candidates,
      fingerprint: {
        tool,
        scenario: kind,
        errorCategory: input.trigger.errorCategory ?? "unknown",
        fact: retried ? "retry-still-failed" : undefined,
      },
      factDetail: shapeSignature(calls),
    }
  }

  // surface_success：工具返回成功但真实结果核验失败
  return {
    kind,
    confirmed: false,
    classification: "unconfirmed",
    candidates,
    fingerprint: { tool, scenario: kind, errorCategory: "unknown", fact: "verify-failed-after-success" },
    factDetail: shapeSignature(calls),
  }
}
