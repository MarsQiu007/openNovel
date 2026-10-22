import { Schema } from "effect"
import type { Hooks } from "./registration.js"

/** Permission prompt requested from inside a plugin tool execution. */
export interface AskInput {
  readonly permission: string
  readonly patterns: readonly string[]
  readonly always: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/** Per-invocation context handed to a plugin tool. */
export interface ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly directory: string
  readonly ask: (input: AskInput) => Promise<void>
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
