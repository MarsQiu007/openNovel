import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Config } from "@opennovel-ai/core/config"
import { ConfigAgentPlugin } from "@opennovel-ai/core/config/plugin/agent"
import { ConfigExternalPlugin } from "@opennovel-ai/core/config/plugin/external"
import { ConfigMigrateV1 } from "@opennovel-ai/core/config/v1/migrate"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { PluginHost } from "@opennovel-ai/core/plugin/host"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "../plugin/host"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

// 合成装配文档形状（与 Config 层推导产物一致）：无 path、两键
const syntheticDoc = () =>
  new Config.Document({
    type: "document",
    info: decode({
      plugins: [ConfigMigrateV1.NOVEL_WRITER_V2_PLUGIN],
      experimental: { subagent_depth: 2 },
    }),
  })

const loadExternal = (entries: Config.Entry[]) =>
  Effect.gen(function* () {
    const plugins = yield* PluginV2.Service
    const agents = yield* AgentV2.Service
    const host = yield* PluginHost.make(plugins)

    yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
      Effect.provideService(PluginV2.Service, plugins),
      Effect.provideService(Config.Service, Config.Service.of({ entries: () => Effect.succeed(entries) })),
    )
    return agents
  })

const waitForAgent = Effect.fnUntraced(function* (agents: AgentV2.Interface, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const agent = yield* agents.get(AgentV2.ID.make(id))
    if (agent) return agent
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die(`Timed out waiting for agent ${id}`)
})

describe("novel-auto-wire 装载集成", () => {
  it.live("auto wiring exposes the writing agent family with director as the sole primary", () =>
    Effect.gen(function* () {
      const agents = yield* loadExternal([syntheticDoc()])

      const director = yield* waitForAgent(agents, "director")
      expect(director.mode).toBe("primary")
      expect(director.category).toBe("orchestration")

      const roster = yield* agents.all()
      for (const name of ["writer", "pipeline", "auditor", "outliner", "reflector"]) {
        expect(roster.some((agent) => agent.id === AgentV2.ID.make(name))).toBe(true)
      }
      // 自定义主 agent 恰为 director 一个（代理选择器显隐以此为计数）
      const customPrimaries = roster.filter(
        (agent) => agent.mode !== "subagent" && !agent.hidden && agent.category !== "internal",
      )
      expect(customPrimaries).toHaveLength(1)
      expect(customPrimaries[0]?.id).toBe(AgentV2.ID.make("director"))
      // 默认 agent 解析指向 director，主会话无需手动选择
      expect((yield* agents.select()).id).toBe(AgentV2.ID.make("director"))
    }),
  )

  it.live("an explicit empty plugins declaration keeps the roster unwired", () =>
    Effect.gen(function* () {
      const agents = yield* loadExternal([])

      // effect 返回即第一方装载完成（同步装载），花名册保持无写作 agent
      expect(yield* agents.get(AgentV2.ID.make("director"))).toBeUndefined()
      expect(yield* agents.get(AgentV2.ID.make("writer"))).toBeUndefined()
    }),
  )

  it.live("an explicit novel-writer declaration loads the plugin exactly once", () =>
    Effect.gen(function* () {
      const agents = yield* loadExternal([
        new Config.Document({
          type: "document",
          path: "/tmp/project/opennovel.json",
          info: decode({ plugins: [ConfigMigrateV1.NOVEL_WRITER_V2_PLUGIN] }),
        }),
      ])

      const director = yield* waitForAgent(agents, "director")
      expect(director.mode).toBe("primary")
      const roster = yield* agents.all()
      expect(roster.filter((agent) => agent.id === AgentV2.ID.make("director"))).toHaveLength(1)
      expect(roster.some((agent) => agent.id === AgentV2.ID.make("writer"))).toBe(true)
    }),
  )

  it.live("routing placeholder is adopted by the auto-wired plugin registration", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const pluginHost = yield* PluginHost.make(plugins)

      // 生产 boot 时序：config-agent 合并（路由条目 → 隐藏占位）先于外部插件装载
      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: decode({ agents: { director: { model: "zp-coding-plan/glm-5.3-flash" } } }),
                }),
              ]),
          }),
        ),
      )
      expect((yield* agents.get(AgentV2.ID.make("director")))?.hidden).toBe(true)

      yield* ConfigExternalPlugin.Plugin.effect(pluginHost).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(
          Config.Service,
          Config.Service.of({ entries: () => Effect.succeed([syntheticDoc()]) }),
        ),
      )

      const director = yield* waitForAgent(agents, "director")
      // 占位转正：模型路由保留、按插件定义恢复可见
      expect(director.hidden).toBe(false)
      expect(director.model).toMatchObject({ providerID: "zp-coding-plan", id: "glm-5.3-flash" })
      expect(director.mode).toBe("primary")
      expect(director.category).toBe("orchestration")
      expect(director.system).toBeDefined()
    }),
  )
})
