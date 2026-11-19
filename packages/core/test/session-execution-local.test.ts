import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, LayerMap } from "effect"
import { LLMError, TransportReason } from "@opennovel-ai/llm"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { EventTable } from "@opennovel-ai/core/event/sql"
import { LocationServiceMap } from "@opennovel-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opennovel-ai/core/location-services"
import type { Location } from "@opennovel-ai/core/location"

import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionExecutionLocal } from "@opennovel-ai/core/session/execution/local"
import { SessionRunner } from "@opennovel-ai/core/session/runner"
import { SessionRunnerModel } from "@opennovel-ai/core/session/runner/model"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { ModelV2 } from "@opennovel-ai/core/model"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { testEffect } from "./lib/effect"

// runner 替身：本地栈只关心 drain 的成败与中断，两类失败分别对应模型解析与 LLM 请求
const failingRunner = (error: SessionRunner.RunError) =>
  Layer.succeed(
    SessionRunner.Service,
    SessionRunner.Service.of({
      run: () => Effect.fail(error),
    }),
  )

const modelUnavailableRunner = failingRunner(
  new SessionRunnerModel.ModelUnavailableError({
    providerID: ProviderV2.ID.make("deepseek"),
    modelID: ModelV2.ID.make("deepseek-v4-pro"),
  }),
)

const llmRequestRunner = failingRunner(
  new LLMError({
    module: "test",
    method: "stream",
    reason: new TransportReason({ message: "Provider unavailable" }),
  }),
)

const makeLocations = (runner: Layer.Layer<SessionRunner.Service>): Layer.Layer<LocationServiceMap.Service> =>
  // 测试桩只实现 get(ref)：drain 失败路径只消费 get 返回的 runner 层，其余
  // LayerMap 成员运行时不会走到；按 LayerMap 接口整体收口类型。
  Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const map = yield* LayerMap.make<Location.Ref, Layer.Layer<SessionRunner.Service>>(() => runner, {
        idleTimeToLive: "60 minutes",
      })
      return map as unknown as LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>
    }),
  )

const sessionID = SessionSchema.ID.make("ses_local_drain")

const setup = Effect.gen(function* () {
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
      slug: "local-drain",
      directory: AbsolutePath.make("/project"),
      title: "local drain",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const durableRows = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return yield* db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .all()
    .pipe(Effect.orDie)
})

const failedEvents = Effect.gen(function* () {
  const rows = yield* durableRows
  // durable 行携带版本后缀（如 session.next.failed.1），wire 层才是裸类型
  return rows.filter((row) => row.type.startsWith("session.next.failed"))
})

const makeIt = (runner: Layer.Layer<SessionRunner.Service>) =>
  testEffect(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, EventV2.node, SessionStore.node, SessionExecutionLocal.node]),
      [[LocationServiceMap.node, makeLocations(runner)]],
    ),
  )

describe("SessionExecutionLocal drain 失败可见性（changelog-ai-routing）", () => {
  makeIt(modelUnavailableRunner).effect("模型解析失败发布会话级终态失败事件", () =>
    Effect.gen(function* () {
      yield* setup
      const exec = yield* SessionExecution.Service
      yield* exec.resume(sessionID).pipe(Effect.ignore)
      yield* exec.wait(sessionID)

      const failedRow = (yield* failedEvents)[0]
      expect(failedRow).toBeDefined()
      const failedData = typeof failedRow.data === "string" ? JSON.parse(failedRow.data) : failedRow.data
      expect(failedData).toMatchObject({
        sessionID,
        error: { type: "unknown", message: "Model unavailable: deepseek/deepseek-v4-pro" },
      })
    }),
  )

  makeIt(llmRequestRunner).effect("LLM 请求失败发布会话级终态失败事件", () =>
    Effect.gen(function* () {
      yield* setup
      const exec = yield* SessionExecution.Service
      yield* exec.resume(sessionID).pipe(Effect.ignore)
      yield* exec.wait(sessionID)

      const failedRow = (yield* failedEvents)[0]
      expect(failedRow).toBeDefined()
      const failedData = typeof failedRow.data === "string" ? JSON.parse(failedRow.data) : failedRow.data
      expect(failedData).toMatchObject({
        sessionID,
        error: { type: "unknown", message: "test.stream: Provider unavailable" },
      })
    }),
  )

  let started = false
  const hangingRunner = Layer.succeed(
    SessionRunner.Service,
    SessionRunner.Service.of({
      run: () => Effect.sync(() => (started = true)).pipe(Effect.andThen(Effect.never)),
    }),
  )

  const waitStarted: Effect.Effect<void> = Effect.suspend(() => (started ? Effect.void : Effect.yieldNow.pipe(Effect.flatMap(() => waitStarted))))

  makeIt(hangingRunner).effect("用户中断不发布失败事件", () =>
    Effect.gen(function* () {
      yield* setup
      const exec = yield* SessionExecution.Service
      // 真实用户中断：drain 挂起后由 interrupt 通道终止，而不是 runner 自中断
      yield* exec.resume(sessionID).pipe(Effect.ignore, Effect.forkScoped)
      yield* waitStarted
      yield* exec.interrupt(sessionID)

      expect(yield* failedEvents).toHaveLength(0)
    }),
  )
})