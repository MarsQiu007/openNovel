import { describe, expect } from "bun:test"
import { EventV2 } from "@opennovel-ai/core/event"
import { PluginV2 } from "@opennovel-ai/core/plugin"
import { SessionPurpose } from "@opennovel-ai/core/plugin/session-purpose"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { SessionEvent } from "@opennovel-ai/core/session/event"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { DateTime, Effect, Option, Queue, Stream } from "effect"
import { PluginTestLayer } from "./fixture"
import { testEffect } from "../lib/effect"

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
      let degradedRejection = "未探测"
      yield* plugins.add(PluginV2.ID.make("envelope-probe"), (ctx) =>
        Effect.gen(function* () {
          // 降级断言：本测试环境未装配 SessionV2 运行栈，后台能力必须 fail-closed
          degradedRejection = yield* Effect.promise(() =>
            ctx.session.settled("ses_env_missing").then(() => "未拒绝", (error: unknown) => String(error)),
          )
          SessionPurpose.register(internalID, "tool-insight")
          // PubSub 无订阅者时发布即丢：先轮询发布哨兵事件直到订阅确实附着（toQueue 的消费
          // fiber 异步附着），附着后队列持续消费，正式两条事件的接收才无时序竞争
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
            yield* events.publish(SessionEvent.Created, { ...base, sessionID: sentinelID })
            const probed = yield* Queue.poll(queue)
            attached = Option.isSome(probed)
          }
          if (!attached) yield* Effect.die("宿主事件订阅未附着")
          // 先发内部会话事件（早发方向），再发普通会话事件作对照
          yield* events.publish(SessionEvent.Created, { ...base, sessionID: internalID })
          yield* events.publish(SessionEvent.Created, { ...base, sessionID: plainID })
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
      // 未装配运行栈时后台能力显式拒绝，绝不静默绕过 purpose 限制
      expect(degradedRejection).toContain("未绑定 SessionV2 运行栈")
    }),
  )
})
