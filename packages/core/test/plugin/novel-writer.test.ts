import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import { mkdirSync } from "fs"
import { join } from "path"
import novelWriterV2 from "@opennovel-ai/plugin/novel-writer-v2"
import { createNovelWriterTools } from "@opennovel-ai/plugin/novel-writer/tools/index"
import { getDb, NovelTable, SoulTable, tagNovelSession } from "@opennovel-ai/plugin/novel-writer/session-store"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Location } from "@opennovel-ai/core/location"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { SystemContext } from "@opennovel-ai/core/system-context/index"
import { SystemContextRegistry } from "@opennovel-ai/core/system-context/registry"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

// 冒烟用桩 session 域：工具注册只搬运 spec，不在 boot 期调用
const stubTools = createNovelWriterTools({ session: { get: () => Promise.resolve(undefined) } })

describe("novel-writer V2 入口", () => {
  it.effect("boot 后 88 工具可见、director 为默认 agent、非小说目录零注入", () =>
    Effect.gen(function* () {
      expect(Object.keys(stubTools)).toHaveLength(88)

      const plugins = yield* PluginV2.Service
      yield* plugins.add(PluginV2.ID.make("novel-writer"), novelWriterV2.effect)

      const registry = yield* ToolRegistry.Service
      const materialized = yield* registry.materialize()
      const names = materialized.definitions.map((definition) => definition.name)
      for (const name of Object.keys(stubTools)) {
        expect(names).toContain(name)
      }

      const agents = yield* AgentV2.Service
      expect((yield* agents.select()).id).toBe(AgentV2.ID.make("director"))

      // 非小说目录：条件注册不生效，注入源不在注册表
      const contexts = yield* SystemContextRegistry.Service
      const generation = yield* SystemContext.initialize(yield* contexts.load())
      expect(Object.keys(generation.snapshot).some((key) => key.startsWith("novel-writer/"))).toBe(false)
    }),
  )

  it.effect("小说目录会话 baseline 含模式/灵魂/快照三段注入", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      mkdirSync(join(location.directory, ".novel"), { recursive: true })

      const db = getDb(location.directory)
      // bun:sqlite 驱动的 drizzle 调用为同步返回，不能用 Effect.promise 包装
      yield* Effect.sync(() => db.insert(NovelTable).values({ id: "n1", title: "测试书", genre: "奇幻" }).run())
      yield* Effect.sync(() =>
        db
          .insert(SoulTable)
          .values({ id: "s1", novel_id: "n1", content: "测试灵魂", created_at: 1, updated_at: 1 })
          .run(),
      )
      yield* Effect.sync(() => tagNovelSession("ses_smoke", "n1", location.directory))

      const plugins = yield* PluginV2.Service
      yield* plugins.add(PluginV2.ID.make("novel-writer"), novelWriterV2.effect)

      // 经 CurrentSessionID 把观测会话传给注入源（与 context-epoch 同一机制）
      const contexts = yield* SystemContextRegistry.Service
      const generation = yield* SystemContext.initialize(yield* contexts.load()).pipe(
        Effect.provideService(SystemContext.CurrentSessionID, Option.some("ses_smoke")),
      )
      expect(generation.baseline).toContain("【写作模式与初始化模式（项目级，持久化）】")
      expect(generation.baseline).toContain("【灵魂】\n测试灵魂")
      expect(generation.baseline).toContain("【小说写作上下文快照】")
      expect(generation.baseline).toContain("书名：测试书")
    }),
  )
})
