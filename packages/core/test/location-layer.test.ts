import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { DateTime, Effect, Equal, Hash, Schema } from "effect"
import { Tool } from "@opennovel-ai/core/tool/tool"
import { define } from "@opennovel-ai/plugin/v2/effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Catalog } from "@opennovel-ai/core/catalog"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { Location } from "@opennovel-ai/core/location"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { ModelV2 } from "@opennovel-ai/core/model"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionRunnerModel } from "@opennovel-ai/core/session/runner/model"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolDefinitions } from "./lib/tool"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Flag } from "../src/flag/flag"
import { FSUtil } from "../src/fs-util"
import { Credential } from "../src/credential"
import { Global } from "../src/global"
import { ModelsDev } from "../src/models-dev"
import { Npm } from "../src/npm"
import { Project } from "../src/project"
import { Reference } from "../src/reference"
import { ToolRegistry } from "../src/tool/registry"
import { ApplicationTools } from "../src/tool/application-tools"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ApplicationTools.node, Database.node, EventV2.node, LocationServiceMap.node])),
)

describe("LocationServiceMap", () => {
  it.live("reuses cached services for constructed and decoded location refs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const directory = AbsolutePath.make(dir.path)
            const constructed = Location.Ref.make({ directory })
            const decoded = Schema.decodeUnknownSync(Location.Ref)({ directory })

            expect(constructed).toEqual({ directory, workspaceID: undefined })
            expect(decoded).toEqual(constructed)
            expect(Equal.equals(constructed, decoded)).toBe(true)
            expect(Hash.hash(constructed)).toBe(Hash.hash(decoded))
            expect(yield* locations.contextEffect(constructed)).toBe(yield* locations.contextEffect(decoded))
          }),
        ),
      ),
    ),
  )

  it.live("isolates location state while sharing location policy with catalog", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([blocked, allowed]) =>
        Effect.gen(function* () {
          yield* (yield* ApplicationTools.Service).register({
            application_context: Tool.make({
              description: "Read application context",
              input: Schema.Struct({}),
              output: Schema.Struct({ ok: Schema.Boolean }),
              execute: () => Effect.succeed({ ok: true }),
            }),
          })
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(blocked.path, "opennovel.json"),
              JSON.stringify({
                experimental: { policies: [{ effect: "deny", action: "provider.use", resource: "test" }] },
              }),
            ),
          )

          const update = (directory: string) =>
            Effect.gen(function* () {
              yield* Reference.Service
              const catalog = yield* Catalog.Service
              yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))
              return {
                providers: yield* catalog.provider.all(),
                tools: yield* toolDefinitions(yield* ToolRegistry.Service),
              }
            }).pipe(
              Effect.scoped,
              Effect.provide(
                LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) })),
              ),
            )

          const blockedState = yield* update(blocked.path)
          expect(blockedState.providers.some((provider) => provider.id === ProviderV2.ID.make("test"))).toBe(false)
          expect(blockedState.tools.map((tool) => tool.name).sort()).toEqual([
            "application_context",
            "apply_patch",
            "bash",
            "browser_click",
            "browser_close",
            "browser_extract",
            "browser_navigate",
            "browser_state",
            "browser_type",
            "code_mode",
            "edit",
            "glob",
            "grep",
            "question",
            "read",
            "skill",
            "subagent",
            "todowrite",
            "webfetch",
            "websearch",
            "write",
          ])
          const allowedState = yield* update(allowed.path)
          expect(allowedState.providers.some((provider) => provider.id === ProviderV2.ID.make("test"))).toBe(true)
          expect(allowedState.tools.map((tool) => tool.name).sort()).toEqual([
            "application_context",
            "apply_patch",
            "bash",
            "browser_click",
            "browser_close",
            "browser_extract",
            "browser_navigate",
            "browser_state",
            "browser_type",
            "code_mode",
            "edit",
            "glob",
            "grep",
            "question",
            "read",
            "skill",
            "subagent",
            "todowrite",
            "webfetch",
            "websearch",
            "write",
          ])
        }),
      ),
    ),
  )

  it.live("rejects an unavailable selected model during location model resolution", () =>
    // 固定空目录夹具隔离 models.dev 拉取；回退移除后，即使目录存在其它可用模型，
    // 指定模型不可用仍必须显式失败（changelog-ai-routing）。
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.OPENNOVEL_MODELS_PATH,
          disabled: Flag.OPENNOVEL_DISABLE_MODELS_FETCH,
        }
        Flag.OPENNOVEL_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
        Flag.OPENNOVEL_DISABLE_MODELS_FETCH = true
        return previous
      }),
      () =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((dir) =>
            Effect.gen(function* () {
              const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(dir.path, "opennovel.json"),
                  JSON.stringify({
                    providers: {
                      unavailable: {
                        name: "Unavailable",
                        api: { type: "native", settings: {} },
                        models: { chat: { disabled: true } },
                      },
                    },
                  }),
                ),
              )
              const failure = yield* SessionRunnerModel.Service.use((models) =>
                models.resolve(
                  SessionV2.Info.make({
                    id: SessionV2.ID.make("ses_unavailable_model"),
                    projectID: ProjectV2.ID.global,
                    title: "test",
                    model: {
                      id: ModelV2.ID.make("chat"),
                      providerID: ProviderV2.ID.make("unavailable"),
                    },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                    location,
                  }),
                ),
              ).pipe(Effect.provide(LocationServiceMap.Service.get(location)), Effect.flip)

              expect(failure).toMatchObject({
                _tag: "SessionRunnerModel.ModelUnavailableError",
                providerID: "unavailable",
                modelID: "chat",
              })
            }),
          ),
        ),
      (previous) =>
        Effect.sync(() => {
          Flag.OPENNOVEL_MODELS_PATH = previous.path
          Flag.OPENNOVEL_DISABLE_MODELS_FETCH = previous.disabled
        }),
    ),
  )

  it.live("fails the selected model even when another model is available", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.OPENNOVEL_MODELS_PATH,
          disabled: Flag.OPENNOVEL_DISABLE_MODELS_FETCH,
          auth: process.env.OPENNOVEL_AUTH_CONTENT,
          configDir: process.env.OPENNOVEL_CONFIG_DIR,
        }
        Flag.OPENNOVEL_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
        Flag.OPENNOVEL_DISABLE_MODELS_FETCH = true
        // 隔离本机全局配置（xdg config 目录），保证 catalog 内容可控
        process.env.OPENNOVEL_CONFIG_DIR = path.join(import.meta.dir, "plugin", "fixtures", "empty-config")
        process.env.OPENNOVEL_AUTH_CONTENT = JSON.stringify({
          good: { type: "api", key: "sk-good" },
        })
        return previous
      }),
      () =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((dir) =>
            Effect.gen(function* () {
              const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(dir.path, "opennovel.json"),
                  JSON.stringify({
                    providers: {
                      good: {
                        name: "Good",
                        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://good.example/v1" },
                        models: { chat: { name: "Chat" } },
                      },
                      unavailable: {
                        name: "Unavailable",
                        api: { type: "native", settings: {} },
                        models: { chat: { disabled: true } },
                      },
                    },
                  }),
                ),
              )
              const failure = yield* SessionRunnerModel.Service.use((models) =>
                models.resolve(
                  SessionV2.Info.make({
                    id: SessionV2.ID.make("ses_selected_unavailable"),
                    projectID: ProjectV2.ID.global,
                    title: "test",
                    model: {
                      id: ModelV2.ID.make("chat"),
                      providerID: ProviderV2.ID.make("unavailable"),
                    },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                    location,
                  }),
                ),
              ).pipe(Effect.provide(LocationServiceMap.Service.get(location)), Effect.flip)

              expect(failure).toMatchObject({
                _tag: "SessionRunnerModel.ModelUnavailableError",
                providerID: "unavailable",
                modelID: "chat",
              })
            }),
          ),
        ),
      (previous) =>
        Effect.sync(() => {
          Flag.OPENNOVEL_MODELS_PATH = previous.path
          Flag.OPENNOVEL_DISABLE_MODELS_FETCH = previous.disabled
          if (previous.auth === undefined) delete process.env.OPENNOVEL_AUTH_CONTENT
          else process.env.OPENNOVEL_AUTH_CONTENT = previous.auth
          if (previous.configDir === undefined) delete process.env.OPENNOVEL_CONFIG_DIR
          else process.env.OPENNOVEL_CONFIG_DIR = previous.configDir
        }),
    ),
  )

  it.live("resolves the selected model when it is available", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.OPENNOVEL_MODELS_PATH,
          disabled: Flag.OPENNOVEL_DISABLE_MODELS_FETCH,
          auth: process.env.OPENNOVEL_AUTH_CONTENT,
          configDir: process.env.OPENNOVEL_CONFIG_DIR,
        }
        Flag.OPENNOVEL_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
        Flag.OPENNOVEL_DISABLE_MODELS_FETCH = true
        // 隔离本机全局配置（xdg config 目录），保证 catalog 内容可控
        process.env.OPENNOVEL_CONFIG_DIR = path.join(import.meta.dir, "plugin", "fixtures", "empty-config")
        process.env.OPENNOVEL_AUTH_CONTENT = JSON.stringify({
          good: { type: "api", key: "sk-good" },
        })
        return previous
      }),
      () =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((dir) =>
            Effect.gen(function* () {
              const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(dir.path, "opennovel.json"),
                  JSON.stringify({
                    providers: {
                      good: {
                        name: "Good",
                        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://good.example/v1" },
                        models: { chat: { name: "Chat" } },
                      },
                    },
                  }),
                ),
              )
              const resolved = yield* SessionRunnerModel.Service.use((models) =>
                models.resolve(
                  SessionV2.Info.make({
                    id: SessionV2.ID.make("ses_selected_available"),
                    projectID: ProjectV2.ID.global,
                    title: "test",
                    model: {
                      id: ModelV2.ID.make("chat"),
                      providerID: ProviderV2.ID.make("good"),
                    },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                    location,
                  }),
                ),
              ).pipe(Effect.provide(LocationServiceMap.Service.get(location)))

              expect(resolved).toMatchObject({ provider: "good", id: "chat" })
            }),
          ),
        ),
      (previous) =>
        Effect.sync(() => {
          Flag.OPENNOVEL_MODELS_PATH = previous.path
          Flag.OPENNOVEL_DISABLE_MODELS_FETCH = previous.disabled
          if (previous.auth === undefined) delete process.env.OPENNOVEL_AUTH_CONTENT
          else process.env.OPENNOVEL_AUTH_CONTENT = previous.auth
          if (previous.configDir === undefined) delete process.env.OPENNOVEL_CONFIG_DIR
          else process.env.OPENNOVEL_CONFIG_DIR = previous.configDir
        }),
    ),
  )

  it.live("falls back to the newest supported model when no model is selected", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.OPENNOVEL_MODELS_PATH,
          disabled: Flag.OPENNOVEL_DISABLE_MODELS_FETCH,
          auth: process.env.OPENNOVEL_AUTH_CONTENT,
          configDir: process.env.OPENNOVEL_CONFIG_DIR,
        }
        Flag.OPENNOVEL_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
        Flag.OPENNOVEL_DISABLE_MODELS_FETCH = true
        // 隔离本机全局配置（xdg config 目录），保证 catalog 内容可控
        process.env.OPENNOVEL_CONFIG_DIR = path.join(import.meta.dir, "plugin", "fixtures", "empty-config")
        process.env.OPENNOVEL_AUTH_CONTENT = JSON.stringify({
          good: { type: "api", key: "sk-good" },
          nativeprov: { type: "api", key: "sk-native" },
        })
        return previous
      }),
      () =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((dir) =>
            Effect.gen(function* () {
              const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(dir.path, "opennovel.json"),
                  JSON.stringify({
                    providers: {
                      // 更新的模型走 native API（无 native route）：默认解析必须落到
                      // 次新但 supported 的 good provider，而不是静默换成其它模型。
                      good: {
                        name: "Good",
                        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://good.example/v1" },
                        models: { chat: { name: "Chat", release_date: "2026-10-01" } },
                      },
                      nativeprov: {
                        name: "Native",
                        api: { type: "native", settings: {} },
                        models: { chat: { name: "Native Chat", release_date: "2026-11-01" } },
                      },
                    },
                  }),
                ),
              )
              const resolved = yield* SessionRunnerModel.Service.use((models) =>
                models.resolve(
                  SessionV2.Info.make({
                    id: SessionV2.ID.make("ses_default_model"),
                    projectID: ProjectV2.ID.global,
                    title: "test",
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                    location,
                  }),
                ),
              ).pipe(Effect.provide(LocationServiceMap.Service.get(location)))

              expect(resolved).toMatchObject({ provider: "good", id: "chat" })
            }),
          ),
        ),
      (previous) =>
        Effect.sync(() => {
          Flag.OPENNOVEL_MODELS_PATH = previous.path
          Flag.OPENNOVEL_DISABLE_MODELS_FETCH = previous.disabled
          if (previous.auth === undefined) delete process.env.OPENNOVEL_AUTH_CONTENT
          else process.env.OPENNOVEL_AUTH_CONTENT = previous.auth
          if (previous.configDir === undefined) delete process.env.OPENNOVEL_CONFIG_DIR
          else process.env.OPENNOVEL_CONFIG_DIR = previous.configDir
        }),
    ),
  )

  it.live("installs public plugins into a location", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const plugins = yield* PluginV2.Service
          const reviewer = define({
            id: "reviewer",
            effect: (ctx) =>
              ctx.agent
                .transform((agent) => {
                  agent.update("reviewer", (item) => {
                    item.description = "Reviews code"
                    item.mode = "subagent"
                  })
                })
                .pipe(Effect.asVoid),
          })
          yield* plugins.add(PluginV2.ID.make(reviewer.id), reviewer.effect)

          expect(yield* (yield* AgentV2.Service).get(AgentV2.ID.make("reviewer"))).toMatchObject({
            description: "Reviews code",
            mode: "subagent",
          })
        }).pipe(
          Effect.scoped,
          Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))),
        ),
      ),
    ),
  )
})
