import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer } from "effect"
import { BackgroundJob } from "@opennovel-ai/core/background-job"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { Location } from "@opennovel-ai/core/location"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionInputTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SubagentCompletion } from "@opennovel-ai/core/session/subagent-completion"
import { SubagentJob } from "@opennovel-ai/core/session/subagent-job"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const wakeCalls: SessionV2.ID[] = []
// 受控 resume 门：特定 child 的 resume 阻塞到测试放行，用于制造「调用方 scope
// 已关闭、作业仍在运行」的窗口
let gatedChild: SessionV2.ID | undefined
let gate: Deferred.Deferred<void> | undefined
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set<SessionV2.ID>()),
    resume: (sessionID) =>
      gate !== undefined && sessionID === gatedChild
        ? Deferred.await(gate).pipe(Effect.andThen(Effect.sync(() => void wakeCalls.push(sessionID))))
        : Effect.sync(() => void wakeCalls.push(sessionID)),
    interrupt: () => Effect.void,
    wait: () => Effect.void,
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionStore.node,
      SessionV2.node,
      BackgroundJob.node,
      SubagentJob.node,
    ]),
    [
      [SessionExecution.node, execution],
      [ProjectV2.node, projects],
    ],
  ),
)

const inputRows = (messageID: SessionMessage.ID) =>
  Database.Service.use(({ db }) =>
    db.select().from(SessionInputTable).where(eq(SessionInputTable.id, messageID)).all().pipe(Effect.orDie),
  )

const eventually = (check: Effect.Effect<boolean, never, Database.Service>) => {
  const loop: Effect.Effect<void, never, Database.Service> = Effect.flatMap(check, (ok) =>
    ok ? Effect.void : Effect.sleep(5).pipe(Effect.andThen(loop)),
  )
  return loop
}

const recoveryOf = (parentID: SessionV2.ID, childID: SessionV2.ID): Extract<BackgroundJob.Recovery, { kind: "subagent" }> => ({
  kind: "subagent",
  parentSessionID: parentID,
  childSessionID: childID,
  agent: "helper",
  description: "章节",
})

describe("SubagentJob", () => {
  it.effect("deliver is idempotent by notificationID and honors resume false", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      const sessions = yield* SessionV2.Service
      const jobs = yield* BackgroundJob.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const notificationID = SessionMessage.ID.create()
      const input = {
        status: "completed" as const,
        output: "写完了",
        notificationID,
        recovery: recoveryOf(parent.id, child.id),
        resume: false,
      }

      yield* SubagentCompletion.deliver(sessions, jobs, input)
      yield* SubagentCompletion.deliver(sessions, jobs, input)
      const rows = yield* inputRows(notificationID)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.prompt.text).toContain('state="completed"')
      expect(rows[0]?.prompt.text).toContain("写完了")
      // resume:false 只落库，不唤醒父会话
      expect(wakeCalls).toEqual([])

      // error 状态走 error 文案分支；默认 resume 语义唤醒父会话
      const failedID = SessionMessage.ID.create()
      yield* SubagentCompletion.deliver(sessions, jobs, {
        status: "error",
        error: "炸了",
        notificationID: failedID,
        recovery: recoveryOf(parent.id, child.id),
      })
      const failedRows = yield* inputRows(failedID)
      expect(failedRows[0]?.prompt.text).toContain('state="error"')
      expect(failedRows[0]?.prompt.text).toContain("炸了")
      expect(wakeCalls).toEqual([parent.id])
    }),
  )

  it.effect("completion observer outlives the caller scope", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      const sessions = yield* SessionV2.Service
      const jobs = yield* BackgroundJob.Service
      const subagents = yield* SubagentJob.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const recovery = recoveryOf(parent.id, child.id)
      gate = yield* Deferred.make<void>()
      gatedChild = child.id

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* subagents.start(recovery)
          yield* subagents.background(recovery)
        }),
      )
      const record = yield* jobs.get(child.id)
      const notificationID = record?.notificationID
      expect(record?.status).toBe("running")
      expect(notificationID).toBeDefined()
      // gate 未放行：作业 run 仍阻塞，调用方 scope 关闭不影响它
      expect(wakeCalls).toEqual([])

      yield* Deferred.succeed(gate!, undefined)
      yield* eventually(Effect.map(inputRows(notificationID!), (rows) => rows.length === 1))
      expect(wakeCalls.filter((id) => id === parent.id)).toHaveLength(1)
    }),
  )

  it.effect("background after the job already finished delivers once", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      gatedChild = undefined
      gate = undefined
      const sessions = yield* SessionV2.Service
      const jobs = yield* BackgroundJob.Service
      const subagents = yield* SubagentJob.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const recovery = recoveryOf(parent.id, child.id)

      // 作业先于 background 完成：run 同步跑完（stub resume + 无 assistant → NO_TEXT）
      yield* subagents.start(recovery)
      expect((yield* jobs.get(child.id))?.status).toBe("completed")

      // recovery 作业的 background 仍成立，通知照常送达；重复调用按代际去重。
      // 送达触发 completeBackground 清账，作业可能已移除，故按父会话通知行断言
      yield* subagents.background(recovery)
      yield* subagents.background(recovery)
      yield* eventually(
        Effect.map(
          Database.Service.use(({ db }) =>
            db
              .select()
              .from(SessionInputTable)
              .where(eq(SessionInputTable.session_id, parent.id))
              .all()
              .pipe(Effect.orDie),
          ),
          (rows) => rows.length === 1,
        ),
      )
      expect(wakeCalls.filter((id) => id === parent.id)).toHaveLength(1)
    }),
  )
})
