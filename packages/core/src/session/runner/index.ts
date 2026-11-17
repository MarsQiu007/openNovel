export * as SessionRunner from "./index"

import type { LLMError } from "@opennovel-ai/llm"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema"
import type { SessionCompaction } from "../compaction"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | SystemContext.InitializationBlocked
  | ToolOutputStore.Error

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
  /**
   * Manually compacts recorded history (Compaction events carry reason "manual").
   * Returns the settlement outcome: completed/failed carry the operation message ID,
   * skipped means no operation was created (unknown window or nothing to compact).
   */
  readonly compact: (input: {
    readonly sessionID: SessionSchema.ID
  }) => Effect.Effect<SessionCompaction.Outcome, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionRunner") {}
