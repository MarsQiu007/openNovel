export * as PluginInternal from "./internal"

import { makeLocationNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import type { PluginContext } from "@opennovel-ai/plugin/v2/effect"
import { Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { ConfigCommandPlugin } from "../config/plugin/command"
import { ConfigExternalPlugin } from "../config/plugin/external"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { ConfigReferencePlugin } from "../config/plugin/reference"
import { ConfigSkillPlugin } from "../config/plugin/skill"
import { EventV2 } from "../event"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Integration } from "../integration"
import { Location } from "../location"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PluginBoot } from "../plugin/boot"
import { PluginV2 } from "../plugin"
import { Reference } from "../reference"
import { SkillV2 } from "../skill"
import { State } from "../state"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { SkillPlugin } from "./skill"
import { VariantPlugin } from "./variant"

export type Requirements =
  | AgentV2.Service
  | Catalog.Service
  | CommandV2.Service
  | Config.Service
  | EventV2.Service
  | FileSystem.Service
  | FSUtil.Service
  | Global.Service
  | HttpClient.HttpClient
  | Integration.Service
  | Location.Service
  | ModelsDev.Service
  | Npm.Service
  | Reference.Service
  | SkillV2.Service

export interface Plugin<R = never> {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R | Scope.Scope>
}

export function define<R>(plugin: Plugin<R>) {
  return plugin
}

// catalog 批处理提交完成后经 PluginBoot 放行：SessionRunnerModel 在模型解析前
// 等待它，保证读到已提交的 catalog 数据（State.batch 的 reload 在批末才执行，
// 等待插件 active 不足以保证数据可见）。

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const commands = yield* CommandV2.Service
    const plugin = yield* PluginV2.Service
    const integration = yield* Integration.Service
    const agents = yield* AgentV2.Service
    const config = yield* Config.Service
    const location = yield* Location.Service
    const modelsDev = yield* ModelsDev.Service
    const npm = yield* Npm.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const filesystem = yield* FileSystem.Service
    const global = yield* Global.Service
    const http = yield* HttpClient.HttpClient
    const skill = yield* SkillV2.Service
    const reference = yield* Reference.Service
    const pluginBoot = yield* PluginBoot.Service
    const add = <R>(input: Plugin<R>) => {
      const loaded = {
        id: input.id,
        effect: (context: PluginContext) =>
          input
            .effect(context)
            .pipe(
              Effect.provideService(Catalog.Service, catalog),
              Effect.provideService(CommandV2.Service, commands),
              Effect.provideService(Integration.Service, integration),
              Effect.provideService(AgentV2.Service, agents),
              Effect.provideService(Config.Service, config),
              Effect.provideService(Location.Service, location),
              Effect.provideService(ModelsDev.Service, modelsDev),
              Effect.provideService(Npm.Service, npm),
              Effect.provideService(EventV2.Service, events),
              Effect.provideService(FSUtil.Service, fs),
              Effect.provideService(FileSystem.Service, filesystem),
              Effect.provideService(Global.Service, global),
              Effect.provideService(HttpClient.HttpClient, http),
              Effect.provideService(SkillV2.Service, skill),
              Effect.provideService(Reference.Service, reference),
            ),
      }
      return plugin.add(PluginV2.ID.make(loaded.id), loaded.effect)
    }

    // 层构建期收窄放行门：此后直到 catalog 批提交前，模型解析的等待会真正
    // 阻塞。arm 与 fork 都发生在层构建期，早于任何可能调用 resolve 的 drain。
    yield* pluginBoot.arm
    // 整体 fork：引导不阻塞层构建；内部先提交 catalog 批并放行就绪信号，
    // 再注册其余内置插件。catalog 相关插件均为纯 transform（models-dev 走已
    // 缓存数据），可快速完成；config-skill/config-external 等含网络加载，放在
    // 信号之后注册，不阻塞模型解析。
    yield* Effect.gen(function* () {
      yield* State.batch(
        Effect.gen(function* () {
          yield* add(ModelsDevPlugin)
          for (const item of ProviderPlugins) yield* add(item)
          yield* add(ConfigProviderPlugin.Plugin)
          yield* add(VariantPlugin.Plugin)
        }),
      ).pipe(
        Effect.withSpan("PluginInternal.boot"),
        // 无论批处理成败都放行：失败的插件不会再生效，等待方继续走
        // 正常的解析错误路径，而不是永远挂起。
        Effect.onExit(() => pluginBoot.release),
      )
      yield* State.batch(
        Effect.gen(function* () {
          yield* add(ConfigReferencePlugin.Plugin)
          yield* add(AgentPlugin.Plugin)
          yield* add(CommandPlugin.Plugin)
          yield* add(SkillPlugin.Plugin)
          yield* add(ConfigAgentPlugin.Plugin)
          yield* add(ConfigCommandPlugin.Plugin)
          yield* add(ConfigSkillPlugin.Plugin)
          yield* add(ConfigExternalPlugin.Plugin)
        }),
      ).pipe(Effect.withSpan("PluginInternal.deferred"))
    }).pipe(Effect.forkScoped({ startImmediately: true }))
  }),
)

export const locationLayer = layer.pipe(
  Layer.provideMerge(Config.locationLayer),
  Layer.provideMerge(FetchHttpClient.layer),
)

export const node = makeLocationNode({
  name: "plugin-internal",
  layer,
  deps: [
    Catalog.node,
    CommandV2.node,
    PluginBoot.node,
    PluginV2.node,
    Integration.node,
    AgentV2.node,
    Config.node,
    Location.node,
    ModelsDev.node,
    Npm.node,
    EventV2.node,
    FSUtil.node,
    FileSystem.node,
    Global.node,
    httpClient,
    SkillV2.node,
    Reference.node,
  ],
})
