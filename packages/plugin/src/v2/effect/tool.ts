import { Schema } from "effect"
import type { BackgroundSessionAuthorization } from "./session.js"
import type { Hooks } from "./registration.js"

/** Permission prompt requested from inside a plugin tool execution. */
export interface AskInput {
  readonly permission: string
  readonly patterns: readonly string[]
  readonly always: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/**
 * 系统复测确认请求（任务 5.2）：宿主在原会话展示问题、运行次数、修复版本与案例
 * 摘要，只提供执行/取消两个选项且不保存 always 权限。运行次数限 1–20 的整数，
 * 修复版本非空；非法输入由宿主直接拒绝，不弹确认。
 */
export interface ConfirmRetestInput {
  readonly question: string
  readonly runs: number
  readonly fixVersion: string
  /** 规范化案例摘要：案例或授权变化后原确认失效，必须重新确认 */
  readonly caseDigest: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  /** 隔离执行的精确工具白名单：签发后由宿主按此逐次校验 */
  readonly expectedTools: readonly string[]
}

/** Per-invocation context handed to a plugin tool. */
export interface ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly directory: string
  readonly ask: (input: AskInput) => Promise<void>
  /**
   * 系统复测确认（仅宿主注入）：用户执行确认后返回宿主签发的随机执行授权，
   * 取消、拒绝或宿主不支持时返回 undefined。与 `ask` 是两条独立通道：权限
   * `ask` 的结果不产生任何执行授权，不能冒充确认。
   */
  readonly confirm?: (input: ConfirmRetestInput) => Promise<BackgroundSessionAuthorization | undefined>
}

export const ToolResult = Schema.Union([
  Schema.String,
  Schema.Struct({
    title: Schema.optional(Schema.String),
    output: Schema.String,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
])
export type ToolResult = typeof ToolResult.Type

export interface ToolSpec<A = unknown, I = unknown> {
  readonly description: string
  readonly args: Schema.Codec<A, I>
  readonly permission?: string
  readonly execute: (args: A, context: ToolContext) => Promise<ToolResult>
}

/** Heterogeneous staged tool, mirroring core's `Tool.AnyTool`. */
export type AnyToolSpec = ToolSpec<any, any>

/**
 * Identity helper for authoring tool specs: the decoded field types of the
 * `args` effect Schema codec flow into `execute`'s `args` parameter, keeping
 * declarations fully inferred without explicit type annotations.
 */
export function defineTool<A, I>(spec: ToolSpec<A, I>): ToolSpec<A, I> {
  return spec
}

export interface ToolEditor {
  list(): readonly string[]
  get(name: string): AnyToolSpec | undefined
  add(name: string, tool: AnyToolSpec): void
  update(name: string, tool: AnyToolSpec): void
  remove(name: string): void
}

export type ToolHooks = Hooks<{
  transform: ToolEditor
}>
