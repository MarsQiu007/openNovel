import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Config } from "@opennovel-ai/core/config"
import { ConfigExternalPlugin } from "@opennovel-ai/core/config/plugin/external"
import { ConfigHealth } from "@opennovel-ai/core/config/health"
import { NOVEL_WRITER_V2_PLUGIN } from "@opennovel-ai/core/config/v1/migrate"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { Location } from "@opennovel-ai/core/location"
import { Npm } from "@opennovel-ai/core/npm"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { PluginHost } from "@opennovel-ai/core/plugin/host"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { testEffect } from "../lib/effect"
import { location as testLocation } from "../fixture/location"
import { PluginTestLayer } from "../plugin/fixture"

const evaluate = ConfigHealth.evaluate
const decode = Schema.decodeUnknownSync(Config.Info)

const input = (override: Partial<ConfigHealth.EvaluateInput>): ConfigHealth.EvaluateInput => ({
  info: {},
  file: "/home/user/.config/opennovel/opennovel.jsonc",
  records: [],
  knownProviders: new Set(),
  legacyFiles: [],
  ...override,
})

describe("ConfigHealth.evaluate", () => {
  test("插件装载失败生成 error 条目并附带修复建议", () => {
    const findings = evaluate(
      input({
        info: { plugins: ["@opennovel-ai/plugin/novel-writer"] },
        records: [new ConfigHealth.LoadRecord({ raw: "@opennovel-ai/plugin/novel-writer", package: "@opennovel-ai/plugin/novel-writer", reason: "unresolvable" })],
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].issue.severity).toBe("error")
    expect(findings[0].issue.keyPath).toBe("plugins[0]")
    expect(findings[0].issue.fixSummary).toContain(NOVEL_WRITER_V2_PLUGIN)
  })

  test("修复 apply 将死条目重写为现行第一方插件 id", () => {
    const findings = evaluate(
      input({
        info: { plugins: ["@opennovel-ai/plugin/novel-writer"] },
        records: [new ConfigHealth.LoadRecord({ raw: "@opennovel-ai/plugin/novel-writer", package: "@opennovel-ai/plugin/novel-writer", reason: "unresolvable" })],
      }),
    )
    const draft = structuredClone({ plugins: ["@opennovel-ai/plugin/novel-writer"] })
    findings[0].apply?.(draft)
    expect(draft.plugins).toEqual([NOVEL_WRITER_V2_PLUGIN])
  })

  test("事故形态：旧第一方 id unresolvable 的静默跳过进入清单", () => {
    const findings = evaluate(
      input({
        info: { plugins: ["@opennovel-ai/plugin/legacy-plugin"] },
        records: [new ConfigHealth.LoadRecord({ raw: "@opennovel-ai/plugin/legacy-plugin", package: "@opennovel-ai/plugin/legacy-plugin", reason: "unresolvable" })],
      }),
    )
    expect(findings.map((finding) => finding.issue.id)).toEqual(["plugin:@opennovel-ai/plugin/legacy-plugin"])
  })

  test("装载成功不记录问题：配置有条目但注册表无记录则无插件问题", () => {
    const findings = evaluate(input({ info: { plugins: ["@opennovel-ai/plugin/novel-writer-v2"] } }))
    expect(findings).toEqual([])
  })

  test("记录指向已不在配置中的条目时自愈忽略（修复后旧记录不残留）", () => {
    const findings = evaluate(
      input({
        info: { plugins: [NOVEL_WRITER_V2_PLUGIN] },
        records: [new ConfigHealth.LoadRecord({ raw: "@opennovel-ai/plugin/old", package: "@opennovel-ai/plugin/old", reason: "unresolvable" })],
      }),
    )
    expect(findings).toEqual([])
  })

  test("事故形态：语法合法但 provider 已下线的旧型号进入清单", () => {
    const findings = evaluate(
      input({
        info: { agent: { reflector: { model: "alibaba/glm-5" } } },
        knownProviders: new Set(["anthropic"]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].issue.severity).toBe("warning")
    expect(findings[0].issue.keyPath).toBe("agent.reflector.model")
    expect(findings[0].issue.fixSummary).toBeUndefined()
  })

  test("模型引用缺少 provider/model 形态进入清单", () => {
    const findings = evaluate(
      input({
        info: { agent: { writer: { model: "claude-sonnet" } } },
        knownProviders: new Set(["anthropic"]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].issue.id).toBe("agent-model:writer")
  })

  test("provider 在已知目录中则不报", () => {
    const findings = evaluate(
      input({
        info: { agent: { writer: { model: "anthropic/claude-sonnet-5" } } },
        knownProviders: new Set(["anthropic"]),
      }),
    )
    expect(findings).toEqual([])
  })

  test("旧式 agent 定义残留生成 warning 且无修复建议", () => {
    const findings = evaluate(input({ legacyFiles: ["agent/plan.md"] }))
    expect(findings).toHaveLength(1)
    expect(findings[0].issue.severity).toBe("warning")
    expect(findings[0].issue.file).toBe("agent/plan.md")
    expect(findings[0].apply).toBeUndefined()
  })

  test("只读性：evaluate 不改变入参配置", () => {
    const info = { plugins: ["@opennovel-ai/plugin/old"], agent: { writer: { model: "alibaba/glm-5" } } }
    const snapshot = JSON.stringify(info)
    evaluate(
      input({
        info,
        records: [new ConfigHealth.LoadRecord({ raw: "@opennovel-ai/plugin/old", package: "@opennovel-ai/plugin/old", reason: "unresolvable" })],
        knownProviders: new Set(),
        legacyFiles: ["agent/plan.md"],
      }),
    )
    expect(JSON.stringify(info)).toBe(snapshot)
  })
})

describe("ConfigHealth.Service", () => {
  test("record 按 package 去重保留最近一条，clear 移除记录", async () => {
    const result = await Effect.gen(function* () {
      const health = yield* ConfigHealth.Service
      yield* health.record(new ConfigHealth.LoadRecord({ raw: "a", package: "a", reason: "r1" }))
      yield* health.record(new ConfigHealth.LoadRecord({ raw: "a", package: "a", reason: "r2" }))
      const before = yield* health.records()
      yield* health.clear("a")
      const after = yield* health.records()
      return { before, after }
    }).pipe(Effect.provide(ConfigHealth.layer), Effect.runPromise)
    expect(result.before).toHaveLength(1)
    expect(result.before[0].reason).toBe("r2")
    expect(result.after).toEqual([])
  })
})

describe("ConfigExternalPlugin 健康上报", () => {
  const it = testEffect(PluginTestLayer)
  const locatedHere = () =>
    Location.Service.of(testLocation(Location.Ref.make({ directory: AbsolutePath.make(path.join(import.meta.dir)) })))

  it.live("装载失败的插件条目被记入健康注册表", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const npm = yield* Npm.Service
      const health = yield* ConfigHealth.Service
      const host = yield* PluginHost.make(plugins)

      // 包存在但子路径不在 exports 内：import.meta.resolve 必然抛错 → 走 unresolvable 静默跳过分支
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
                  info: decode({ plugins: ["@opennovel-ai/plugin/definitely-not-exported"] }),
                }),
              ]),
          }),
        ),
      )

      const records = yield* health.records()
      expect(records).toHaveLength(1)
      expect(records[0].raw).toBe("@opennovel-ai/plugin/definitely-not-exported")
      expect(records[0].reason.length).toBeGreaterThan(0)
    }),
  )
})
