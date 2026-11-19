export * as WorkRunTool from "./workrun"

import { ToolFailure } from "@opennovel-ai/llm"
import { NonNegativeInt, optional } from "@opennovel-ai/schema/schema"
import { Run } from "@opennovel-ai/schema/session-work-run"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SessionSchema } from "../session/schema"
import { SessionWorkRun } from "../session/work-run"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "workrun"

export const Input = Schema.Struct({
  action: Schema.Literals([
    "create",
    "claim",
    "complete_item",
    "skip_item",
    "block_item",
    "reset_item",
    "progress",
    "finish",
  ]),
  goal: optional(Schema.String).annotate({ description: "create: the queue goal" }),
  items: optional(Schema.Array(Schema.String)).annotate({ description: "create: ordered unit titles" }),
  seq: optional(NonNegativeInt).annotate({
    description: "complete_item / skip_item / block_item / reset_item: unit seq",
  }),
  reason: optional(Schema.String).annotate({ description: "block_item: why the unit is blocked" }),
  note: optional(Schema.String).annotate({ description: "progress: latest progress note" }),
})

export const Output = Schema.Struct({ run: Run })
export type Output = typeof Output.Type

// Tool.make 对嵌套 schema 的回调推断丢失 sessionID brand，这里只做序列化，参数放宽
export const toModelOutput = (output: { readonly run: unknown }) => JSON.stringify(output.run, null, 2)

const activeRun = (
  workrun: SessionWorkRun.Interface,
  sessionID: SessionSchema.ID,
): Effect.Effect<Run, SessionWorkRun.NoActiveRun> =>
  Effect.gen(function* () {
    const run = yield* workrun.current(sessionID)
    if (run === undefined || run.status !== "active") return yield* new SessionWorkRun.NoActiveRun()
    return run
  })

const dispatch = (
  workrun: SessionWorkRun.Interface,
  input: typeof Input.Type,
  sessionID: SessionSchema.ID,
): Effect.Effect<Run, SessionWorkRun.InvalidTransition | SessionWorkRun.NoActiveRun> =>
  Effect.gen(function* () {
  if (input.action === "create") {
    if (input.goal === undefined || input.items === undefined || input.items.length === 0)
      return yield* new SessionWorkRun.InvalidTransition({ reason: "create 需要 goal 与至少一个单元标题" })
    return yield* workrun.create({ sessionID, goal: input.goal, items: input.items })
  }
  const run = yield* activeRun(workrun, sessionID)
  if (input.action === "claim") return yield* workrun.claimNext(run.id)
  if (input.action === "progress") {
    if (input.note === undefined) return yield* new SessionWorkRun.InvalidTransition({ reason: "progress 需要 note" })
    yield* workrun.recordProgress(run.id, input.note)
    return yield* activeRun(workrun, sessionID)
  }
  if (input.action === "finish") return yield* workrun.complete(run.id)
  if (input.seq === undefined)
    return yield* new SessionWorkRun.InvalidTransition({ reason: `${input.action} 需要 seq` })
  if (input.action === "complete_item") return yield* workrun.completeItem(run.id, input.seq)
  if (input.action === "skip_item") return yield* workrun.skipItem(run.id, input.seq)
  if (input.action === "block_item") {
    if (input.reason === undefined)
      return yield* new SessionWorkRun.InvalidTransition({ reason: "block_item 需要 reason" })
    return yield* workrun.blockItem(run.id, input.seq, input.reason)
  }
  return yield* workrun.resetItem(run.id, input.seq)
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const workrun = yield* SessionWorkRun.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Create and drive the session's durable work queue. Use 'create' to declare a goal and its ordered units, then repeatedly 'claim' the next unit, work on it, and 'complete_item' (or 'skip_item' / 'block_item' with a reason). Keep 'progress' notes current after each meaningful step so the queue state stays accurate, and use 'finish' once every unit is done or skipped.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const run = yield* dispatch(workrun, input, context.sessionID)
              return { run }
            }).pipe(
              Effect.mapError(
                (error) =>
                  error instanceof PermissionV2.CorrectedError
                    ? error
                    : error instanceof SessionWorkRun.InvalidTransition
                      ? new ToolFailure({ message: error.reason })
                      : error instanceof SessionWorkRun.NoActiveRun
                        ? new ToolFailure({ message: "没有活动的工作队列" })
                        : new ToolFailure({ message: "Unable to update work queue" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/workrun",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, SessionWorkRun.node],
})
