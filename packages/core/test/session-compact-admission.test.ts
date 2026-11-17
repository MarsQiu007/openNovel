import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, LayerMap } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionEvent } from "@opennovel-ai/core/session/event"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SessionWatermark } from "@opennovel-ai/core/session/watermark"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { LocationServiceMap } from "@opennovel-ai/core/location-service-map"
import type { LocationServices } from "@opennovel-ai/core/location-services"
import { ModelV2 } from "@opennovel-ai/core/model"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { Model } from "@opennovel-ai/schema/model"
import { Session } from "@opennovel-ai/schema/session"
import { Prompt } from "@opennovel-ai/core/session/prompt"
import { testEffect } from "./lib/effect"

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
    wait: () => Effect.void,
  }),
)

// 水位服务由 location 层提供：准入只消费 get，成功/失败行为用可切换的伪实现
let watermarkOK = true
const watermarkLayer = Layer.succeed(
  SessionWatermark.Service,
  SessionWatermark.Service.of({
    get: (session) =>
      watermarkOK
        ? Effect.succeed(
            Session.ContextWatermark.make({
              model: Model.Ref.make({ id: ModelV2.ID.make("fake"), providerID: ProviderV2.ID.make("fake") }),
              window: 100_000,
              measured: 100,
              estimated: 0,
              total: 100,
              ratio: 0.5,
              source: "estimated",
            }),
          )
        : Effect.fail(new SessionWatermark.ModelNotResolvedError({ sessionID: session.id })),
  }),
)
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(() => watermarkLayer as unknown as Layer.Layer<LocationServices>),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [[SessionExecution.node, execution], [LocationServiceMap.node, locations]],
  ),
)
const sessionID = SessionV2.ID.make("ses_compact_admission")

const setup = Effect.gen(function* () {
  wakeCalls.length = 0
  watermarkOK = true
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const compactionMessages = Effect.gen(function* () {
  const context = yield* (yield* SessionStore.Service).context(sessionID)
  return context.filter((message) => message.type === "compaction")
})

// resume:false 的 prompt 只准入不投影；直接发布 Prompted 事件，等效 drain 提升后的用户消息投影
const seedUserMessage = Effect.gen(function* () {
  const bus = yield* EventV2.Service
  yield* bus.publish(SessionEvent.Prompted, {
    sessionID,
    messageID: SessionMessage.ID.create(),
    timestamp: yield* DateTime.now,
    prompt: Prompt.make({ text: "hello" }),
    delivery: "steer",
  })
})

describe("V2Session.compact admission", () => {
  it.effect("unknown session fails with NotFoundError", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const error = yield* session.compact({ sessionID: SessionV2.ID.make("ses_compact_missing") }).pipe(Effect.flip)
      expect(error._tag).toBe("Session.NotFoundError")
      expect(wakeCalls).toHaveLength(0)
    }),
  )

  it.effect("empty history is skipped without creating an operation or waking the drain", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const admission = yield* session.compact({ sessionID })
      expect(admission).toEqual({ status: "skipped" })
      expect(wakeCalls).toHaveLength(0)
      expect(yield* compactionMessages).toHaveLength(0)
    }),
  )

  it.effect("unresolvable window is skipped without creating an operation", () =>
    Effect.gen(function* () {
      yield* setup
      watermarkOK = false
      const session = yield* SessionV2.Service
      yield* seedUserMessage
      const admission = yield* session.compact({ sessionID })
      expect(admission).toEqual({ status: "skipped" })
      expect(wakeCalls).toHaveLength(0)
      expect(yield* compactionMessages).toHaveLength(0)
    }),
  )

  it.effect("admits a queued operation, wakes the drain, and returns immediately with the operation ID", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* seedUserMessage
      const admission = yield* session.compact({ sessionID })
      expect(admission.status).toBe("queued")
      if (admission.status === "queued") expect(admission.messageID).toMatch(/^msg_/)
      expect(wakeCalls).toEqual([sessionID])
      // durable Queued 同步投影：受理即可见排队状态，不等待 drain 执行
      const operations = yield* compactionMessages
      expect(operations).toHaveLength(1)
      expect(operations[0]).toMatchObject({ status: "queued", reason: "manual" })
    }),
  )

  it.effect("singleflight reuses the active queued operation instead of queueing a duplicate", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* seedUserMessage
      const first = yield* session.compact({ sessionID })
      const second = yield* session.compact({ sessionID })
      expect(second).toEqual(first)
      expect((yield* compactionMessages)).toHaveLength(1)
      // 复用路径是只读返回：不重复入队，也不再发 advisory 唤醒（首次受理已唤醒）
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("singleflight reuses a running operation", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const bus = yield* EventV2.Service
      yield* seedUserMessage
      const opID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Compaction.Queued, {
        sessionID,
        messageID: opID,
        timestamp: yield* DateTime.now,
        reason: "manual",
      })
      yield* bus.publish(SessionEvent.Compaction.Started, {
        sessionID,
        messageID: opID,
        timestamp: yield* DateTime.now,
        reason: "manual",
      })
      const admission = yield* session.compact({ sessionID })
      expect(admission).toEqual({ messageID: opID, status: "running" })
      expect(yield* compactionMessages).toHaveLength(1)
    }),
  )

  it.effect("a settled operation does not block admitting a new one", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const bus = yield* EventV2.Service
      yield* seedUserMessage
      const opID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Compaction.Queued, {
        sessionID,
        messageID: opID,
        timestamp: yield* DateTime.now,
        reason: "manual",
      })
      yield* bus.publish(SessionEvent.Compaction.Started, {
        sessionID,
        messageID: opID,
        timestamp: yield* DateTime.now,
        reason: "manual",
      })
      yield* bus.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        messageID: opID,
        timestamp: yield* DateTime.now,
        reason: "manual",
        text: "summary",
        recent: "recent",
      })
      const admission = yield* session.compact({ sessionID })
      expect(admission.status).toBe("queued")
      if (admission.status === "queued") expect(admission.messageID).not.toBe(opID)
      expect(yield* compactionMessages).toHaveLength(2)
    }),
  )
})
