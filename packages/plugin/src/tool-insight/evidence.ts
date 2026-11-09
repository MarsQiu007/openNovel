/**
 * 工具改进日志证据层 — 稳定 ID、字段白名单脱敏与独立正文例外。
 *
 * 本模块是事件到 JSONL 记录之间的唯一过滤层：调用方（事件采集器、用户入口）只传
 * 原始事实，落盘条目一律经过这里。默认不落任何正文、完整工具参数、工具输出原文
 * 或密钥形状值；正文片段只能经 content_exception 单独保存，本地保留与模型使用是
 * 两项独立授权，缺省对模型不可见。
 */

import { createHash } from "node:crypto"

/** 脱敏摘要的长度上限：证据是事实索引，不是输出转储 */
export const TOOL_INSIGHT_SUMMARY_MAX_CHARS = 200

/** 用户主动记录/新发生实例使用的 ULID（跨重启不重复、时间可排序） */
const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function createUlid(time = Date.now()): string {
  let remaining = time
  let id = ""
  for (let index = 0; index < 10; index++) {
    id = ULID_ENCODING[remaining % 32] + id
    remaining = Math.floor(remaining / 32)
  }
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let buffer = 0
  let bitsLeft = 0
  let byteIndex = 0
  for (let index = 0; index < 16; index++) {
    if (bitsLeft < 5) {
      buffer = (buffer << 8) | bytes[byteIndex++]
      bitsLeft += 8
    }
    id += ULID_ENCODING[(buffer >> (bitsLeft - 5)) & 31]
    bitsLeft -= 5
  }
  return id
}

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

export interface DerivedEvidenceIDInput {
  projectID: string
  /** 事件信封 ID（跨重启不重用，派生 ID 因此不随重启重复） */
  eventID: string
  kind: ToolInsightEvidenceKind
}

/** 自动证据 ID：由项目、事件信封 ID 和证据种类确定性派生 */
export function deriveEvidenceID(input: DerivedEvidenceIDInput): string {
  return `evi_${stableHash(`${input.projectID}\u0000${input.eventID}\u0000${input.kind}`).slice(0, 16)}`
}

/** 单次调用问题的发生实例 ID：项目 + 会话 + callID + 指纹派生 */
export function deriveCallOccurrenceID(input: {
  projectID: string
  sessionID: string
  callID: string
  fingerprint: string
}): string {
  return `oci_${stableHash(`${input.projectID}\u0000${input.sessionID}\u0000${input.callID}\u0000${input.fingerprint}`).slice(0, 16)}`
}

/** turn 轨迹问题的发生实例 ID：项目 + 会话 + assistantMessageID + 稳定目标 + 指纹派生 */
export function deriveTurnOccurrenceID(input: {
  projectID: string
  sessionID: string
  assistantMessageID: string
  goal: string
  fingerprint: string
}): string {
  return `oci_${stableHash(
    `${input.projectID}\u0000${input.sessionID}\u0000${input.assistantMessageID}\u0000${input.goal}\u0000${input.fingerprint}`,
  ).slice(0, 16)}`
}

export type ToolInsightEvidenceKind =
  | "tool_called"
  | "tool_failed"
  | "tool_success"
  | "trajectory"
  | "user_report"
  | "content_exception"
  | "real_state"

export interface ToolInsightEvidence {
  id: string
  ts: number
  kind: ToolInsightEvidenceKind
  projectID: string
  sessionID?: string
  /** callID 只在同项目、同会话内关联 */
  callID?: string
  /** provider turn 边界（assistantMessageID） */
  turnID?: string
  agent?: string
  model?: string
  appVersion?: string
  trigger: "auto" | "user"
  occurrenceID?: string
  /** 白名单化脱敏字段；实现保证不含正文/密钥/绝对路径/完整参数 */
  fields: Record<string, unknown>
}

/** 密钥形状的参数/字段名：命中即整体丢弃该键，不做值级转写 */
const SECRET_KEY_PATTERN =
  /pass(?:word)?|secret|token|authorization|auth|api[-_]?key|apikey|credential|private[-_]?key|cookie|bearer/i

/** 允许保留标量枚举值的非内容参数键：工具模式/格式类选择，不含自由文本 */
const SAFE_ENUM_KEYS = new Set(["mode", "type", "format", "kind", "style", "language", "level", "status"])

/**
 * 路径脱敏：绝对路径（Windows 盘符或 POSIX 根）替换为「相对锚点或扩展名」，
 * 不保留任何可定位原书/用户目录的完整路径。
 */
export function redactPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/][^\s"'`,;)）\]]+/g, (match) => `<path:${pathHint(match)}>`)
    .replace(/(?<![\w:])[\\/](?:[^\s"'`,;)）\]][^\s"'`,;)）\]]*){2,}/g, (match) => `<path:${pathHint(match)}>`)
}

function pathHint(path: string): string {
  const base = path.split(/[\\/]/).filter(Boolean).pop() ?? ""
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot + 1).slice(0, 12) : "noext"
}

/** 文本脱敏：密钥形状键值对、绝对路径统一清洗后按上限截断 */
export function redactSummary(text: string, maxChars = TOOL_INSIGHT_SUMMARY_MAX_CHARS): string {
  const scrubbed = redactPaths(
    text
      .replace(/\b([A-Za-z][\w-]*(?:[-_]?key|token|secret|password|credential))\s*[=:]\s*\S+/gi, "$1=<redacted>")
      .replace(/\b(bearer|sk-|ghp_|gho_|xox[bpars]-)[\w.-]+/gi, "<redacted>"),
  )
  if (scrubbed.length <= maxChars) return scrubbed
  return `${scrubbed.slice(0, maxChars)}…(截断)`
}

/** Tool.Called 白名单：工具名、参数键集合、非内容枚举值；完整参数不落盘 */
export function redactToolCalled(tool: string, input: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = { tool }
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const keys = Object.keys(input as Record<string, unknown>)
    fields.paramKeys = keys.sort()
    const enums: Record<string, unknown> = {}
    for (const key of keys) {
      if (!SAFE_ENUM_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) continue
      const value = (input as Record<string, unknown>)[key]
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        enums[key] = typeof value === "string" && value.length <= 32 ? value : `<len:${String(value).length}>`
      }
    }
    if (Object.keys(enums).length > 0) fields.paramEnums = enums
  }
  return fields
}

/** Tool.Failed 白名单：错误类型、稳定错误码与截断脱敏摘要；完整错误不落盘 */
export function redactToolFailed(tool: string, error: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = { tool }
  if (error !== null && typeof error === "object") {
    const record = error as Record<string, unknown>
    if (typeof record.name === "string") fields.errorType = record.name
    else fields.errorType = error.constructor?.name ?? "Error"
    if (typeof record.code === "string" || typeof record.code === "number") fields.errorCode = record.code
    const message = typeof record.message === "string" ? record.message : String(error)
    fields.errorDigest = redactSummary(message)
  } else {
    fields.errorType = "Error"
    fields.errorDigest = redactSummary(String(error))
  }
  return fields
}

/** Tool.Success 白名单：成功标志、输出文件类别与核验标识；不保存 result/content 原文 */
export function redactToolSuccess(
  tool: string,
  outputPaths: readonly string[] | undefined,
  statusKeys: readonly string[] | undefined,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { tool, success: true }
  if (outputPaths?.length) {
    // 路径只保留相对锚点或扩展名
    fields.outputKinds = outputPaths.map((path) => pathHint(path))
  }
  if (statusKeys?.length) fields.statusKeys = [...statusKeys].sort()
  return fields
}

/** 用户正文例外：片段本体只在用户同意本地保留时保存，模型可见性由独立授权控制 */
export interface ToolInsightContentException {
  kind: "content_exception"
  id: string
  ts: number
  /** 片段长度（字符数）；不保存派生摘要，避免旁路泄露 */
  length: number
  /** 用户同意本地保留的授权时间 */
  retainedAt: number
  /** 分享风险标记：含正文的问题文档共享前必须显著提示 */
  shareWarning: true
  /** 绑定该片段的模型使用授权（grants 为空即对模型不可见） */
  grants: ToolInsightContentGrant[]
  /** 片段本体（仅本地保留授权下保存于此，不进入模型构造器输入） */
  text: string
}

export interface ToolInsightContentGrant {
  /** 不可伪造的授权 ID，宿主/插件按此核验 */
  id: string
  /** 授权用途：单次归因或一组复测运行 */
  purpose: "organize" | "retest"
  /** 绑定案例或问题摘要（跨案例复用无效） */
  subjectDigest: string
  providerID?: string
  modelID?: string
  grantedAt: number
}

/**
 * 创建正文例外证据。片段文本必须来自用户显式输入（不能经普通反馈字段绕入）；
 * 创建时只带本地保留授权，模型授权须另行签发。
 */
export function createContentException(input: { text: string; retainedAt?: number }): ToolInsightContentException {
  const ts = input.retainedAt ?? Date.now()
  return {
    kind: "content_exception",
    id: `exc_${createUlid(ts)}`,
    ts,
    length: input.text.length,
    retainedAt: ts,
    shareWarning: true,
    grants: [],
    text: input.text,
  }
}

/** 签发模型使用授权：绑定用途、案例/问题摘要与（可选）目标模型范围 */
export function grantContentModelUse(
  exception: ToolInsightContentException,
  input: { purpose: "organize" | "retest"; subjectDigest: string; providerID?: string; modelID?: string; grantedAt?: number },
): ToolInsightContentGrant {
  const grant: ToolInsightContentGrant = {
    id: `cgr_${createUlid()}`,
    purpose: input.purpose,
    subjectDigest: input.subjectDigest,
    providerID: input.providerID,
    modelID: input.modelID,
    grantedAt: input.grantedAt ?? Date.now(),
  }
  exception.grants.push(grant)
  return grant
}

/** 模型构造器取用片段的唯一入口：无匹配授权时返回 undefined（不可见） */
export function modelVisibleContent(
  exception: ToolInsightContentException,
  input: { purpose: "organize" | "retest"; subjectDigest: string; providerID?: string; modelID?: string },
): string | undefined {
  const matched = exception.grants.find(
    (grant) =>
      grant.purpose === input.purpose &&
      grant.subjectDigest === input.subjectDigest &&
      (input.providerID === undefined || grant.providerID === undefined || grant.providerID === input.providerID) &&
      (input.modelID === undefined || grant.modelID === undefined || grant.modelID === input.modelID),
  )
  return matched?.id ? exception.text : undefined
}
