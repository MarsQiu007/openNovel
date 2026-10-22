export * as PluginHost from "./host"

import type {
  AnyToolSpec,
  AskInput,
  PluginContext as Interface,
  SystemContextSource,
  ToolEditor,
} from "@opennovel-ai/plugin/v2/effect"
import { ToolResult } from "@opennovel-ai/plugin/v2/effect"
import { Effect, Exit, Option, Schema, Scope } from "effect"
import { AgentV2 } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Credential } from "../credential"
import { Global } from "../global"
import { Integration } from "../integration"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import type { DeepMutable } from "../schema"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { SkillV2 } from "../skill"
import { SystemContext } from "../system-context/index"
import { SystemContextRegistry } from "../system-context/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"

const mutable = <T>(value: T) => value as DeepMutable<T>

// 插件回调传入的 source/method 来自插件侧（未受信）：解码失败时抛出点名标签的错误，
// 而不是让裸 SchemaError 以 defect 形式冲击 reload 管线。
function decodeHostValue<S extends Schema.Decoder<unknown>>(label: string, schema: S, value: unknown) {
  const decoded = Schema.decodeUnknownOption(schema)(value)
  if (Option.isSome(decoded)) return decoded.value
  throw new Error(`Plugin host received an invalid ${label}`)
}

export const make = Effect.fn("PluginHost.make")(function* (plugin: PluginV2.Interface) {
  const agents = yield* AgentV2.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const globalPaths = yield* Global.Service
  const integration = yield* Integration.Service
  const location = yield* Location.Service
  const permission = yield* PermissionV2.Service
  const reference = yield* Reference.Service
  const sessions = yield* SessionStore.Service
  const skill = yield* SkillV2.Service
  const systemContexts = yield* SystemContextRegistry.Service
  const tools = yield* Tools.Service

  const askPermission = (input: AskInput, context: Tool.Context) =>
    permission
      .assert({
        sessionID: context.sessionID,
        action: input.permission,
        resources: [...input.patterns],
        save: [...input.always],
        metadata: input.metadata,
        source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        agent: context.agent,
      })
      .pipe(
        Effect.catchTag("PermissionV2.CorrectedError", (error) => Effect.fail(new Error(error.feedback))),
        Effect.catchTag("Session.NotFoundError", () => Effect.fail(new Error("Session not found"))),
      )

  const wrapTool = (spec: AnyToolSpec) => {
    const tool = Tool.make({
      description: spec.description,
      input: spec.args,
      output: ToolResult,
      execute: (input, context) =>
        Effect.tryPromise({
          try: () =>
            spec.execute(input, {
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.assistantMessageID,
              directory: location.directory,
              ask: (ask) => Effect.runPromise(askPermission(ask, context)),
            }),
          catch: (cause) => new Tool.Failure({ message: cause instanceof Error ? cause.message : String(cause) }),
        }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: typeof output === "string" ? output : output.output }],
    })
    return spec.permission ? Tool.withPermission(tool, spec.permission) : tool
  }

  const registerSource = (source: SystemContextSource<any>) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const key = SystemContext.Key.make(source.key)
        const context = SystemContext.make({
          key,
          codec: source.codec,
          load: source.load.pipe(Effect.map(Option.getOrElse(() => SystemContext.unavailable))),
          baseline: source.baseline,
          update: source.update,
          ...(source.removed ? { removed: source.removed } : {}),
        })
        // 与 tool transform 同款子 scope：dispose 只摘除本次注册的源
        const scope = yield* Scope.Scope
        const child = yield* Scope.fork(scope)
        yield* systemContexts.register({ key, load: Effect.succeed(context) }).pipe(Scope.provide(child))
        let active = true
        const dispose = Effect.uninterruptible(
          Effect.suspend(() => {
            if (!active) return Effect.void
            active = false
            return Scope.close(child, Exit.void)
          }),
        )
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      }),
    )

  return {
    options: {},
    location: {
      directory: location.directory,
      project: { directory: location.project.directory },
    },
    paths: {
      home: globalPaths.home,
      data: globalPaths.data,
      cache: globalPaths.cache,
      config: globalPaths.config,
      state: globalPaths.state,
      tmp: globalPaths.tmp,
    },
    session: {
      get: (id) =>
        Effect.runPromise(
          sessions.get(SessionSchema.ID.make(id)).pipe(
            Effect.map((info) => info && { id: info.id as string, parentID: info.parentID as string | undefined }),
          ),
        ),
    },
    systemContext: {
      register: registerSource,
    },
    tool: {
      transform: (callback) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const staged = new Map<string, AnyToolSpec>()
            const editor: ToolEditor = {
              list: () => Array.from(staged.keys()),
              get: (name) => staged.get(name),
              add: (name, spec) => {
                Effect.runSync(Tool.validateName(name))
                staged.set(name, spec)
              },
              update: (name, spec) => {
                if (!staged.has(name)) return
                staged.set(name, spec)
              },
              remove: (name) => {
                staged.delete(name)
              },
            }
            yield* Effect.suspend(() => {
              const result = callback(editor)
              return Effect.isEffect(result) ? Effect.asVoid(result).pipe(Effect.orDie) : Effect.void
            })
            // 独立子 scope 承接整批注册：dispose 只摘除本次 transform 的工具，
            // 露出注册表里的上一个同名注册（registry overlay 语义）。
            const scope = yield* Scope.Scope
            const child = yield* Scope.fork(scope)
            yield* tools
              .register(Object.fromEntries(Array.from(staged, ([name, spec]) => [name, wrapTool(spec)])))
              .pipe(Effect.orDie, Scope.provide(child))
            let active = true
            const dispose = Effect.uninterruptible(
              Effect.suspend(() => {
                if (!active) return Effect.void
                active = false
                return Scope.close(child, Exit.void)
              }),
            )
            yield* Scope.addFinalizer(scope, dispose)
            return { dispose }
          }),
        ),
    },
    agent: {
      reload: agents.reload,
      transform: (callback) =>
        agents.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(AgentV2.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          }),
        ),
    },
    aisdk: {
      sdk: (callback) =>
        aisdk.hook.sdk((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
            sdk: event.sdk,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        }),
      language: (callback) =>
        aisdk.hook.language((event) => {
          const output = {
            model: mutable(event.model),
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        }),
    },
    catalog: {
      reload: catalog.reload,
      transform: (callback) =>
        catalog.transform((draft) =>
          callback({
            provider: {
              list: () => mutable(draft.provider.list()),
              get: (id) => mutable(draft.provider.get(ProviderV2.ID.make(id))),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              },
            },
          }),
        ),
    },
    command: {
      reload: commands.reload,
      transform: commands.transform,
    },
    integration: {
      reload: integration.reload,
      connection: {
        active: (id) => integration.connection.active(Integration.ID.make(id)),
        resolve: (connection) =>
          integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          ),
      },
      transform: (callback) =>
        integration.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Integration.ID.make(id))),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => mutable(draft.method.list(Integration.ID.make(id))),
              update: (input) => {
                if ("authorize" in input) {
                  const methodID = Integration.MethodID.make(input.method.id)
                  const refresh = input.refresh
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, id: methodID },
                    authorize: (inputs) =>
                      input.authorize(inputs).pipe(
                        Effect.map((authorization) => {
                          if (authorization.mode === "auto") {
                            return {
                              ...authorization,
                              callback: authorization.callback.pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                            }
                          }
                          return {
                            ...authorization,
                            callback: (code: string) =>
                              authorization.callback(code).pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                          }
                        }),
                      ),
                    ...(refresh
                      ? {
                          refresh: (value: Credential.OAuth) =>
                            refresh(value).pipe(
                              Effect.map((next) =>
                                Credential.OAuth.make({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                              ),
                            ),
                        }
                      : {}),
                    ...(input.label ? { label: input.label } : {}),
                  })
                  return
                }
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), decodeHostValue("integration method", Integration.Method, method)),
            },
          }),
        ),
    },
    plugin: {
      add: (input) => plugin.add(PluginV2.ID.make(input.id), input.effect),
      remove: (id) => plugin.remove(PluginV2.ID.make(id)),
    },
    reference: {
      reload: reference.reload,
      transform: (callback) =>
        reference.transform((draft) =>
          callback({
            add: (name, source) => draft.add(name, decodeHostValue("reference source", Reference.Source, source)),
            remove: draft.remove,
            list: draft.list,
          }),
        ),
    },
    skill: {
      reload: skill.reload,
      transform: (callback) =>
        skill.transform((draft) =>
          callback({
            source: (source) => draft.source(decodeHostValue("skill source", SkillV2.Source, source)),
            list: draft.list,
          }),
        ),
    },
  } satisfies Interface
})
