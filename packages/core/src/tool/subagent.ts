export * as SubagentTool from "./subagent"

import { ToolFailure } from "@opennovel-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { Prompt } from "../session/prompt"
import { SessionSchema } from "../session/schema"
import { SessionV2 } from "../session"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "subagent"

export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.",
  "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

export const Input = Schema.Struct({
  agent: Schema.String.annotate({
    description:
      "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
  }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  model: Schema.String.pipe(Schema.optional).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular model or variant. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
  }),
  // 上游靠 execute.before 在校验前剥掉空串参数；fork 无对应 hook 面，schema 层
  // 以 union 放行空串，再由 execute 开头的清洗收敛为未传，保留 branded 精度。
  sessionID: Schema.Union([SessionSchema.ID, Schema.Literal("")])
    .pipe(Schema.optional)
    .annotate({
      description:
        "Continue a specific previous subagent conversation by passing its sessionID. Calls without a sessionID start a new conversation.",
    }),
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const agents = yield* AgentV2.Service
    const catalog = yield* Catalog.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service
    const tools = yield* Tools.Service

    const resolveModel = Effect.fn("SubagentTool.resolveModel")(function* (input: string) {
      const ref = yield* Effect.try({
        try: () => ModelV2.Ref.parse(input),
        catch: () =>
          new ToolFailure({
            message: `Invalid model "${input}". Use "providerID/modelID" or "providerID/modelID#variant".`,
          }),
      })
      const model = (yield* catalog.model.available()).find(
        (candidate) => candidate.providerID === ref.providerID && candidate.id === ref.id,
      )
      if (model === undefined)
        return yield* new ToolFailure({
          message: `Model "${ref.providerID}/${ref.id}" is not available. Use the models tool to see what is available.`,
        })
      if (ref.variant !== undefined && !model.variants.some((variant) => variant.id === ref.variant))
        return yield* new ToolFailure({
          message:
            model.variants.length === 0
              ? `Model "${ref.providerID}/${ref.id}" has no variants. Omit the variant.`
              : `Variant "${ref.variant}" is not available for "${ref.providerID}/${ref.id}". Available: ${model.variants.map((variant) => variant.id).join(", ")}.`,
        })
      return ref
    })

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          describe: (ruleset) =>
            agents.all().pipe(
              Effect.map((all) => {
                const available = all
                  .filter(
                    (agent) =>
                      agent.mode !== "primary" &&
                      !agent.hidden &&
                      PermissionV2.evaluate(name, agent.id, ruleset).effect !== "deny",
                  )
                  .toSorted((a, b) => a.id.localeCompare(b.id))
                if (available.length === 0) return description
                return [
                  description,
                  "",
                  "Available subagents:",
                  ...available.map(
                    (agent) =>
                      `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
                  ),
                ].join("\n")
              }),
            ),
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.status === "completed"
                  ? `<subagent sessionID="${output.sessionID}" state="completed">\n${output.output}\n</subagent>`
                  : output.output,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              // 上游经 execute.before hook 清洗空串参数；fork 无对应 hook 面，等价处理收敛在 execute 开头
              const model = input.model === "" ? undefined : input.model
              const continueID = input.sessionID === "" ? undefined : input.sessionID

              const parent = yield* sessions.get(context.sessionID).pipe(
                Effect.mapError(
                  (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                ),
              )
              let current = parent
              let depth = 0
              while (current.parentID) {
                depth++
                current = yield* sessions.get(current.parentID).pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                  ),
                )
              }
              const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
              if (depth >= limit)
                return yield* new ToolFailure({
                  message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                })

              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })

              yield* permission
                .assert({
                  action: name,
                  resources: [agent.id],
                  save: [agent.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })),
                )

              const existing =
                continueID === undefined
                  ? undefined
                  : yield* sessions.get(continueID).pipe(
                      Effect.mapError(
                        (error) => new ToolFailure({ message: `Subagent session not found: ${continueID}`, error }),
                      ),
                    )
              if (existing !== undefined && existing.parentID !== context.sessionID)
                return yield* new ToolFailure({
                  message: `Session ${existing.id} is not a child of the current session`,
                })

              const override = model === undefined ? undefined : yield* resolveModel(model)
              // Continuing with a different agent switches the child, mirroring create semantics
              // where an explicit model wins over the agent's configured model, which wins over the inherited one.
              if (existing !== undefined) {
                const switched = existing.agent !== agent.id
                const nextModel = override ?? (switched ? agent.model : undefined)
                yield* Effect.all([
                  switched ? sessions.switchAgent({ sessionID: existing.id, agent: agent.id }) : Effect.void,
                  nextModel === undefined
                    ? Effect.void
                    : sessions.switchModel({ sessionID: existing.id, model: nextModel }),
                ]).pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to switch subagent session: ${existing.id}`, error }),
                  ),
                )
              }

              const childModel = override ?? agent.model ?? parent.model
              const child =
                existing ??
                (yield* sessions
                  .create({
                    parentID: context.sessionID,
                    title: input.description,
                    agent: agent.id,
                    ...(childModel === undefined ? {} : { model: childModel }),
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                    ),
                  ))

              // 本步只落 admission 序列：前台完成等待、onInterrupt 与后台分支随 SubagentJob（步骤 5）接入
              yield* sessions
                .prompt({
                  sessionID: child.id,
                  prompt: Prompt.fromUserMessage({
                    text:
                      existing === undefined
                        ? ["You are a subagent spawned by another session.", input.prompt].join("\n")
                        : input.prompt,
                  }),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                  ),
                )

              return {
                sessionID: child.id,
                status: "running" as const,
                output: `The subagent is working in session ${child.id}.`,
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/subagent",
  layer,
  deps: [
    ToolRegistry.node,
    PermissionV2.node,
    AgentV2.node,
    SessionV2.node,
    Catalog.node,
    Config.node,
  ],
})
