import { describe, expect } from "bun:test"
import { ToolFailure } from "@opennovel-ai/llm"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Config } from "@opennovel-ai/core/config"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { Location } from "@opennovel-ai/core/location"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { PermissionJudge } from "@opennovel-ai/core/permission/judge"
import { PermissionSaved } from "@opennovel-ai/core/permission/saved"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { Tool } from "@opennovel-ai/core/tool/tool"
import { Tools } from "@opennovel-ai/core/tool/tools"
import { ToolOutputStore } from "@opennovel-ai/core/tool-output-store"
import { Permission } from "@opennovel-ai/schema/permission"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)

// 可变桩：provideService 无法穿透已构建的 PermissionV2 层内捕获的配置/裁判实例
const state: {
  mode: "ask" | "judge" | "judge-shadow"
  decision: Permission.Decision
  judgeCalls: number
} = {
  mode: "ask",
  decision: Permission.Decision.make({ effect: "ask" }),
  judgeCalls: 0,
}
const decode = Schema.decodeUnknownSync(Config.Info)
const configNode = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed(
        state.mode === "ask"
          ? []
          : [new Config.Document({ type: "document", info: decode({ permission: { mode: state.mode } }) })],
      ),
  }),
)
const judgeNode = Layer.succeed(
  PermissionJudge.Service,
  PermissionJudge.Service.of({
    judge: () => {
      state.judgeCalls++
      return Effect.succeed({ decision: state.decision, model: "stub" })
    },
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionStore.node,
      PermissionSaved.node,
      AgentV2.node,
      PermissionV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
    ]),
    [
      [Location.node, current],
      [Config.node, configNode],
      [PermissionJudge.node, judgeNode],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

function setup(rules: PermissionV2.Ruleset = []) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: SessionV2.ID.make("ses_test"),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
  })
}

const runProbe = Effect.scoped(
  Effect.gen(function* () {
    const permission = yield* PermissionV2.Service
    const tools = yield* Tools.Service
    // 复刻内置工具的收敛形状：CorrectedError 穿透给结算层，其余错误归工具通用文案
    yield* tools.register({
      probe: Tool.make({
        description: "probe",
        input: Schema.Struct({}),
        output: Schema.String,
        execute: (_, context) =>
          permission
            .assert({
              action: "bash",
              resources: ["pwd"],
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
            })
            .pipe(
              Effect.as("ok"),
              Effect.mapError(
                (error) =>
                  error instanceof PermissionV2.CorrectedError
                    ? error
                    : new ToolFailure({ message: "probe failed" }),
              ),
            ),
      }),
    })
    const registry = yield* ToolRegistry.Service
    return yield* registry.materialize()
  }).pipe(
    Effect.flatMap((materialization) =>
      materialization.settle({
        sessionID: SessionV2.ID.make("ses_test"),
        agent: AgentV2.ID.make("test"),
        assistantMessageID: SessionMessage.ID.make("msg_feedback"),
        call: { type: "tool-call", id: "call-probe", name: "probe", input: {} },
      }),
    ),
  ),
)

describe("ToolRegistry permission feedback", () => {
  it.effect("surfaces a human rejection message to the model through settle", () =>
    Effect.gen(function* () {
      state.mode = "ask"
      yield* setup()
      const events = yield* EventV2.Service
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* runProbe.pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)
      const permission = yield* PermissionV2.Service
      yield* permission.reply({ requestID: request.id, reply: "reject", message: "不要执行这个命令" })
      expect(yield* Fiber.join(fiber)).toEqual({ result: { type: "error", value: "不要执行这个命令" } })
    }),
  )

  it.effect("surfaces the judge denial reason as the tool failure message", () =>
    Effect.gen(function* () {
      state.mode = "judge"
      state.judgeCalls = 0
      state.decision = Permission.Decision.make({ effect: "deny", reason: "会删除工程目录" })
      yield* setup()
      expect(yield* runProbe).toEqual({ result: { type: "error", value: "会删除工程目录" } })
      expect(state.judgeCalls).toBe(1)
    }),
  )

  it.effect("keeps a generic message for blocked configured rules", () =>
    Effect.gen(function* () {
      state.mode = "ask"
      yield* setup([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* runProbe).toEqual({ result: { type: "error", value: "probe failed" } })
    }),
  )
})
