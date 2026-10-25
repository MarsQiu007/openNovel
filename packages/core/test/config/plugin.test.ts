import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Config } from "@opennovel-ai/core/config"
import { ConfigExternalPlugin } from "@opennovel-ai/core/config/plugin/external"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Location } from "@opennovel-ai/core/location"
import { Npm } from "@opennovel-ai/core/npm"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { PluginHost } from "@opennovel-ai/core/plugin/host"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { testEffect } from "../lib/effect"
import { location as testLocation } from "../fixture/location"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

// 相对插件路径以 Location 目录为基：把测试 Location 钉在配置文件旁，../plugin/fixtures 解析不变
const locatedHere = () =>
  Location.Service.of(testLocation(Location.Ref.make({ directory: AbsolutePath.make(path.join(import.meta.dir)) })))

describe("ConfigExternalPlugin", () => {
  it.live("resolves and loads a configured Promise plugin with options", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)
      const document = path.join(import.meta.dir, "opennovel.json")

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, locatedHere()),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: document,
                  info: decode({
                    plugins: [
                      {
                        package: "../plugin/fixtures/config-promise-plugin.ts",
                        options: { description: "Loaded from config" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Loaded from config",
        mode: "subagent",
      })
    }),
  )

  it.live("loads a configured Effect plugin with options", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, locatedHere()),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opennovel.json"),
                  info: decode({
                    plugins: [
                      {
                        package: "../plugin/fixtures/config-effect-plugin.ts",
                        options: { description: "Effect plugin from config" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "effect-configured")).toMatchObject({
        description: "Effect plugin from config",
        mode: "subagent",
      })
    }),
  )

  it.live("ignores invalid plugins and continues loading", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, locatedHere()),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opennovel.json"),
                  info: decode({
                    plugins: [
                      "../plugin/fixtures/missing-plugin.ts",
                      "../plugin/fixtures/invalid-plugin.ts",
                      {
                        package: "../plugin/fixtures/config-promise-plugin.ts",
                        options: { description: "Loaded after invalid plugins" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Loaded after invalid plugins",
      })
    }),
  )

  it.live("loads first-party and file-path plugins before the plugin effect completes", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, locatedHere()),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opennovel.json"),
                  info: decode({
                    plugins: [{ package: "../plugin/fixtures/config-promise-plugin.ts", options: {} }],
                  }),
                }),
              ]),
          }),
        ),
      )

      // 同步装载分野：effect 返回时 agent 已注册，无需轮询
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toMatchObject({ id: "configured" })
    }),
  )

  it.live("installs and resolves npm plugin packages", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const host = yield* PluginHost.make(plugins)
      let installed: string | undefined
      const npm = Npm.Service.of({
        add: (spec) =>
          Effect.sync(() => {
            installed = spec
            return {
              directory: import.meta.dir,
              entrypoint: path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts"),
            }
          }),
        install: () => Effect.void,
        which: () => Effect.succeed(undefined),
      })

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: decode({
                    plugins: [
                      {
                        package: "example-plugin@1.0.0",
                        options: { description: "Installed from npm" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Installed from npm",
      })
      expect(installed).toBe("example-plugin@1.0.0")
    }),
  )

  it.live("loads plugin files from config directories", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, locatedHere()),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Directory({
                  type: "directory",
                  path: AbsolutePath.make(path.join(import.meta.dir, "fixtures")),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "directory")).toMatchObject({
        description: "Loaded from plugin directory",
        mode: "subagent",
      })
    }),
  )

  it.live("resolves relative plugin paths against the location directory", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      // 配置文档位于 location 的 .opennovel/ 子目录：相对条目必须以 location 目录（而非配置目录）为基。
      // 自包含插件（零 import），从 tmp 目录动态 import 时不依赖 node_modules 解析。
      const source = `export default {
  id: "relative-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("configured", (agent) => {
        agent.description = "Resolved against location"
        agent.mode = "subagent"
      })
    })
  },
}
`
      yield* Effect.promise(() => Bun.write(path.join(location.directory, "relative-plugin.ts"), source))

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(location.directory, ".opennovel", "opennovel.json"),
                  info: decode({ plugins: ["./relative-plugin.ts"] }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Resolved against location",
      })
    }),
  )
})

const waitForAgent = Effect.fnUntraced(function* (agents: AgentV2.Interface, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const agent = yield* agents.get(AgentV2.ID.make(id))
    if (agent) return agent
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die(`Timed out waiting for agent ${id}`)
})
