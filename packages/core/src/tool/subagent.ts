export * as SubagentTool from "./subagent"

import { ToolFailure } from "@opennovel-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { BackgroundJob } from "../background-job"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { SessionV2 } from "../session"
import { SubagentCompletion } from "../session/subagent-completion"
import { SubagentJob } from "../session/subagent-job"
import { Prompt } from "../session/prompt"
import { SessionSchema } from "../session/schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "subagent"

const backgroundResult = (sessionID: SessionSchema.ID) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
  ].join("\n"),
})

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
    const jobs = yield* BackgroundJob.Service
    const subagents = yield* SubagentJob.Service

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

              // 标准入库 admission 在作业之外：Job.start 加入正在运行的 child 时跳过
              // 其 run effect，默认 wake 让 idle child 启动或对运行中的 child steer
              const background = input.background === true
              yield* sessions
                .prompt({
                  sessionID: child.id,
                  prompt: Prompt.fromUserMessage({
                    text:
                      existing === undefined
                        ? ["You are a subagent spawned by another session.", input.prompt].join("\n")
                        : input.prompt,
                  }),
                  ...(background && existing === undefined ? { resume: false } : {}),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                  ),
                )

              // fork 适配：上游取 agent.name 作展示名；fork AgentV2.Info 无 name 字段，以 id 承载
              const recovery = {
                kind: "subagent" as const,
                parentSessionID: context.sessionID,
                childSessionID: child.id,
                agent: agent.id,
                description: input.description,
              }
              yield* subagents.start(recovery)

              if (background) {
                yield* subagents.background(recovery)
                return backgroundResult(child.id)
              }

              const result = yield* jobs.block({ id: child.id, sessionID: context.sessionID }).pipe(
                Effect.onInterrupt(() =>
                  Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], {
                    discard: true,
                  }),
                ),
              )
              if (result?.type === "backgrounded") {
                yield* subagents.notify(recovery, result.info.started_at)
                return backgroundResult(child.id)
              }
              // 失败文案保留 sessionID，模型可续聊子会话
              if (result?.info.status === "error")
                return yield* new ToolFailure({
                  message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                })
              if (result?.info.status === "cancelled")
                return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` })
              return {
                sessionID: child.id,
                status: "completed" as const,
                output: result?.info.output ?? SubagentCompletion.NO_TEXT,
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
    BackgroundJob.node,
    SubagentJob.node,
  ],
})
