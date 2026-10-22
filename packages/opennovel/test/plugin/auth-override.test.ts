import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Effect } from "effect"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { ProviderAuth } from "@/provider/auth"

import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opennovel-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { Config } from "@/config/config"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

function providerAuthLayer(directory: string, plugins: string[]) {
  return LayerNode.compile(ProviderAuth.node, [
    [
      Config.node,
      TestConfig.layer({
        get: () =>
          Effect.succeed({
            plugin: plugins,
            plugin_origins: plugins.map((plugin) => ({
              spec: plugin,
              source: path.join(directory, "opennovel.json"),
              scope: "local" as const,
            })),
          }),
        directories: () => Effect.succeed([directory]),
      }),
    ],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ])
}

describe("plugin.auth-override", () => {
  it.instance(
    "user plugin overrides built-in github-copilot auth",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const pluginDir = path.join(tmp.directory, ".opennovel", "plugin")

        yield* fs.writeWithDirs(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default {",
            '  id: "demo.custom-copilot-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "github-copilot",',
            "      methods: [",
            '        { type: "api", label: "Test Override Auth" },',
            "      ],",
            "      loader: async () => ({ access: 'test-token' }),",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )

        const plain = yield* tmpdirScoped({ git: true })
        const plugin = pathToFileURL(path.join(pluginDir, "custom-copilot-auth.ts")).href
        const methods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(tmp.directory, [plugin])))
        const plainMethods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(plain, [])), provideInstance(plain))

        const copilot = methods[ProviderV2.ID.make("github-copilot")]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
        expect(plainMethods[ProviderV2.ID.make("github-copilot")][0].label).not.toBe("Test Override Auth")
      }),
    { git: true },
    30000,
  )
})

const file = path.join(import.meta.dir, "../../src/plugin/index.ts")

// config hook 消费循环已随 novel-writer V1 入口一并摘除（runtime-v2-cutover E④），
// 原「config hooks 错误隔离」源码断言随之失效；Hooks.config 契约的退役归第③格。
describe("plugin.auth-override source", () => {
  test("plugin/index.ts no longer consumes the V1 config hook", async () => {
    const src = await Bun.file(file).text()
    expect(src).not.toContain("plugin config hook failed")
    expect(src).not.toContain(".config?.(")
  })
})
