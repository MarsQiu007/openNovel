import { describe, expect } from "bun:test"
import { EventV2 } from "@opennovel-ai/core/event"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { SessionPurpose } from "@opennovel-ai/core/plugin/session-purpose"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { AbsolutePath, DateTimeUtcFromMillis } from "@opennovel-ai/core/schema"
import { DateTime, Effect, Option, Queue, Schema, Stream } from "effect"
import { PluginTestLayer } from "./fixture"
import { testEffect } from "../lib/effect"

// 信封测试用的 Created 事件：非持久化变体。schema 里的 SessionEvent.Created 是
// V2 生命周期事件（durable 落库投影 SessionTable 行，需真实 project 行存在），
// 本测试只验信封 purpose 回填与公开形状，用同型非 durable 事件即可，避免为
// 信封语义引入无关的 project 外键夹具。
const EnvelopeCreated = EventV2.define({
  type: "session.next.created",
  schema: {
    timestamp: DateTimeUtcFromMillis,
    sessionID: SessionSchema.ID,
    projectID: ProjectV2.ID,
    directory: AbsolutePath,
    slug: Schema.String,
    title: Schema.String,
    version: Schema.String,
  },
})

const it = testEffect(PluginTestLayer)

describe("PluginHost 事件信封 purpose 回填（任务 2.2）", () => {
  it.effect("内部会话事件信封带 purpose 且公开 properties 形状不变；降级宿主 fail-closed", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const plugins = yield* PluginV2.Service
      const internalID = SessionSchema.ID.make("ses_env_internal")
      const plainID = SessionSchema.ID.make("ses_env_plain")

      // 订阅与发布都发生在插件 effect 内：捕获的 ctx 即宿主适配后的插件面
      const received: Array<{ properties: Record<string, unknown>; purpose?: string }> = []
      // 降级探测：organize 带非空 expectedTools 违反模式约束，startBackground 在
      // create 前即 fail（不触库、不派生资源）。startBackground 的同步预检经
      // runPromise 立即 reject，插件 effect 内就地捕获断言 fail-closed 语义。
      yield* plugins.add(PluginV2.ID.make("envelope-probe"), (ctx) =>
        Effect.gen(function* () {
          const rejection = yield* Effect.promise(() =>
            ctx.session
              .startBackground({
                mode: "organize",
                agent: "any",
                prompt: "probe",
                expectedTools: ["nonexistent-tool"],
                directory: "/env",
              })
              .then(
                () => "未拒绝",
                (error: unknown) => (error instanceof Error ? error.message : String(error)),
              ),
          )
          expect(rejection).toContain("预期工具集合必须为空")
          SessionPurpose.register(internalID, "tool-insight")
          // PubSub 无订阅者时发布即丢：先轮询发布哨兵事件直到订阅确实附着（toQueue 的消费
          // fiber 异步附着），附着后队列持续消费，正式两条事件的接收才无时序竞争。
          // 订阅走字符串 type：EnvelopeCreated 与 schema SessionEvent.Created 同型
          // （session.next.created），宿主经 sessionEventByType 解析到 schema 定义，
          // 事件总线按 type 路由，两边事件互通。
          const queue = yield* ctx.event.subscribe("session.next.created").pipe(Stream.toQueue({ capacity: 16 }))
          const sentinelID = SessionSchema.ID.make("ses_env_sentinel")
          const base = {
            timestamp: DateTime.makeUnsafe(0),
            projectID: ProjectV2.ID.make("prj_env"),
            directory: AbsolutePath.make("/env"),
            slug: "envelope-probe",
            title: "envelope",
            version: "test",
          }
          let attached = false
          for (let attempt = 0; attempt < 200 && !attached; attempt++) {
            yield* Effect.yieldNow
            yield* events.publish(EnvelopeCreated, { ...base, sessionID: sentinelID })
            const probed = yield* Queue.poll(queue)
            attached = Option.isSome(probed)
          }
          if (!attached) yield* Effect.die("宿主事件订阅未附着")
          // 先发内部会话事件（早发方向），再发普通会话事件作对照
          yield* events.publish(EnvelopeCreated, { ...base, sessionID: internalID })
          yield* events.publish(EnvelopeCreated, { ...base, sessionID: plainID })
          for (let index = 0; index < 2; index++) {
            // 队列提前关闭属缺陷，用 orDie 擦掉 Done 错误通道
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- purpose 是宿主信封附加字段，公开事件类型上不存在，读取需收窄
            const envelope = (yield* Queue.take(queue).pipe(Effect.orDie)) as {
              properties: Record<string, unknown>
              purpose?: string
            }
            received.push(envelope)
          }
        }),
      )

      expect(received).toHaveLength(2)
      const internalEvent = received.find((event) => event.properties.sessionID === internalID)
      const plainEvent = received.find((event) => event.properties.sessionID === plainID)
      expect(internalEvent?.purpose).toBe("tool-insight")
      expect(plainEvent?.purpose).toBeUndefined()
      // 公开 SessionEvent Schema 不受影响：标记只在信封顶层，绝不进入 properties
      expect(Object.hasOwn(internalEvent?.properties ?? {}, "purpose")).toBe(false)
      expect(Object.hasOwn(plainEvent?.properties ?? {}, "purpose")).toBe(false)
    }),
  )
})
