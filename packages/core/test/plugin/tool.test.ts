import { describe, expect } from "bun:test"
import { Effect, Fiber, Option, Schema } from "effect"
import { define } from "@opennovel-ai/plugin/v2/effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Database } from "@opennovel-ai/core/database/database"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { SystemContext } from "@opennovel-ai/core/system-context/index"
import { SystemContextRegistry } from "@opennovel-ai/core/system-context/registry"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const sessionID = SessionV2.ID.make("ses_plugin_tool")
const agent = AgentV2.ID.make("tester")
const assistantMessageID = SessionMessage.ID.make("msg_plugin_tool")

const insertSession = (id: SessionV2.ID, parentID?: SessionV2.ID) =>
  Effect.gen(function* () {
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
        id,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: "tester",
        ...(parentID ? { parent_id: parentID } : {}),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const settle = (name: string, input: unknown) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const materialized = yield* registry.materialize()
    return yield* materialized.settle({
      sessionID,
      agent,
      assistantMessageID,
      call: { type: "tool-call", id: `call_${name}`, name, input },
    })
  })

describe("PluginHost tool domain", () => {
  it.effect("registers staged tools as canonical tools and settles them", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const seen: Array<{ sessionID: string; agent: string; messageID: string; directory: string }> = []

      yield* plugins.add(
        PluginV2.ID.make("tool-basic"),
        define({
          id: "tool-basic",
          effect: (ctx) =>
            ctx.tool
              .transform((editor) => {
                editor.add("plugin_echo", {
                  description: "echoes input",
                  args: Schema.Struct({ text: Schema.String }),
                  execute: (args, toolCtx) => {
                    seen.push({
                      sessionID: toolCtx.sessionID,
                      agent: toolCtx.agent,
                      messageID: toolCtx.messageID,
                      directory: toolCtx.directory,
                    })
                    return Promise.resolve(`echo:${args.text}`)
                  },
                })
                editor.add("plugin_struct", {
                  description: "structured result",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve({ title: "t", output: "struct-out", metadata: { k: 1 } }),
                })
              })
              .pipe(Effect.asVoid),
        }).effect,
      )

      const registry = yield* ToolRegistry.Service
      const materialized = yield* registry.materialize()
      const names = materialized.definitions.map((definition) => definition.name)
      expect(names).toContain("plugin_echo")
      expect(names).toContain("plugin_struct")
      const echo = materialized.definitions.find((definition) => definition.name === "plugin_echo")
      expect(echo?.inputSchema).toMatchObject({
        type: "object",
        properties: { text: { type: "string" } },
      })

      const text = yield* settle("plugin_echo", { text: "hi" })
      expect(text.result).toEqual({ type: "text", value: "echo:hi" })
      const struct = yield* settle("plugin_struct", {})
      expect(struct.result).toEqual({ type: "text", value: "struct-out" })
      expect(seen).toEqual([
        { sessionID, agent, messageID: assistantMessageID, directory: expect.any(String) },
      ])
    }),
  )

  it.effect("applies staging update/remove only within the current transform", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service

      yield* plugins.add(
        PluginV2.ID.make("tool-staging"),
        define({
          id: "tool-staging",
          effect: (ctx) =>
            ctx.tool
              .transform((editor) => {
                editor.add("staged_tool", {
                  description: "v1",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve("v1"),
                })
                editor.update("staged_tool", {
                  description: "v2",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve("v2"),
                })
                editor.update("absent_tool", {
                  description: "no-op",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve("absent"),
                })
                editor.add("ghost_tool", {
                  description: "removed",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve("ghost"),
                })
                editor.remove("ghost_tool")
                expect(editor.list()).toEqual(["staged_tool"])
                expect(editor.get("staged_tool")?.description).toBe("v2")
              })
              .pipe(Effect.asVoid),
        }).effect,
      )

      const registry = yield* ToolRegistry.Service
      const materialized = yield* registry.materialize()
      const names = materialized.definitions.map((definition) => definition.name)
      expect(names).toContain("staged_tool")
      expect(names).not.toContain("ghost_tool")
      expect(names).not.toContain("absent_tool")

      const result = yield* settle("staged_tool", {})
      expect(result.result).toEqual({ type: "text", value: "v2" })
    }),
  )

  it.effect("dispose removes the batch and reveals the previous registration", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const disposes: Array<Effect.Effect<void>> = []

      yield* plugins.add(
        PluginV2.ID.make("tool-overlay"),
        define({
          id: "tool-overlay",
          effect: (ctx) =>
            Effect.gen(function* () {
              const first = yield* ctx.tool.transform((editor) => {
                editor.add("dup_tool", {
                  description: "first",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve("first"),
                })
              })
              disposes.push(first.dispose)
              const second = yield* ctx.tool.transform((editor) => {
                editor.add("dup_tool", {
                  description: "second",
                  args: Schema.Struct({}),
                  execute: () => Promise.resolve("second"),
                })
              })
              disposes.push(second.dispose)
            }),
        }).effect,
      )

      expect((yield* settle("dup_tool", {})).result).toEqual({ type: "text", value: "second" })
      yield* disposes[1]!
      expect((yield* settle("dup_tool", {})).result).toEqual({ type: "text", value: "first" })
      yield* disposes[0]!
      expect((yield* settle("dup_tool", {})).result).toEqual({ type: "error", value: "Unknown tool: dup_tool" })
    }),
  )

  it.effect("bridges ask into PermissionV2 and blocks until reply", () =>
    Effect.gen(function* () {
      yield* insertSession(sessionID)
      const plugins = yield* PluginV2.Service
      const permission = yield* PermissionV2.Service

      yield* plugins.add(
        PluginV2.ID.make("tool-ask"),
        define({
          id: "tool-ask",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.agent.transform((draft) => {
                draft.update("tester", (info) => {
                  info.permissions = [{ action: "*", resource: "*", effect: "ask" }]
                })
              })
              yield* ctx.tool
                .transform((editor) => {
                  editor.add("ask_tool", {
                    description: "asks then answers",
                    args: Schema.Struct({}),
                    execute: async (args, toolCtx) => {
                      await toolCtx.ask({ permission: "edit", patterns: ["*"], always: ["src/**"] })
                      return "approved"
                    },
                  })
                })
                .pipe(Effect.asVoid)
            }),
        }).effect,
      )

      const pending = yield* settle("ask_tool", {}).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      const requests = yield* permission.list()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        sessionID,
        action: "edit",
        resources: ["*"],
        save: ["src/**"],
        source: { type: "tool", messageID: assistantMessageID, callID: "call_ask_tool" },
      })

      yield* permission.reply({ requestID: requests[0]!.id, reply: "once" })
      expect((yield* Fiber.join(pending)).result).toEqual({ type: "text", value: "approved" })
      expect(yield* permission.list()).toHaveLength(0)
    }),
  )

  it.effect("registers system context sources into the Location registry", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service

      yield* plugins.add(
        PluginV2.ID.make("context-source"),
        define({
          id: "context-source",
          effect: (ctx) =>
            ctx.systemContext
              .register({
                key: "test/plugin-context",
                codec: Schema.String,
                load: () => Effect.succeed(Option.some("test-value")),
                baseline: (value) => `baseline:${value}`,
                update: (_previous, value) => `update:${value}`,
              })
              .pipe(Effect.asVoid),
        }).effect,
      )

      const registry = yield* SystemContextRegistry.Service
      const generation = yield* SystemContext.initialize(yield* registry.load())
      expect(generation.baseline).toContain("baseline:test-value")

      yield* plugins.add(
        PluginV2.ID.make("context-unavailable"),
        define({
          id: "context-unavailable",
          effect: (ctx) =>
            ctx.systemContext
              .register({
                key: "test/unavailable-context",
                codec: Schema.String,
                load: () => Effect.succeed(Option.none()),
                baseline: (value) => `baseline:${value}`,
                update: (_previous, value) => `update:${value}`,
              })
              .pipe(Effect.asVoid),
        }).effect,
      )

      // Option.none 映射 unavailable：初始化按 key 阻塞而非渲染残缺 baseline
      const blocked = yield* SystemContext.initialize(yield* registry.load()).pipe(Effect.flip)
      expect(blocked.keys.map(String)).toContain("test/unavailable-context")

      yield* plugins.remove(PluginV2.ID.make("context-unavailable"))
      const restored = yield* SystemContext.initialize(yield* registry.load())
      expect(restored.baseline).toContain("baseline:test-value")

      yield* plugins.remove(PluginV2.ID.make("context-source"))
      const emptied = yield* SystemContext.initialize(yield* registry.load())
      expect(emptied.baseline).not.toContain("baseline:test-value")
    }),
  )

  it.effect("bridges session.get to the session store", () =>
    Effect.gen(function* () {
      yield* insertSession(SessionV2.ID.make("ses_parent"))
      yield* insertSession(sessionID, SessionV2.ID.make("ses_parent"))
      const plugins = yield* PluginV2.Service
      const seen: Array<unknown> = []

      yield* plugins.add(
        PluginV2.ID.make("session-reader"),
        define({
          id: "session-reader",
          effect: (ctx) =>
            Effect.gen(function* () {
              seen.push(yield* Effect.promise(() => ctx.session.get(sessionID)))
              seen.push(yield* Effect.promise(() => ctx.session.get("ses_missing")))
            }),
        }).effect,
      )

      expect(seen).toEqual([{ id: sessionID, parentID: "ses_parent" }, undefined])
    }),
  )
})
