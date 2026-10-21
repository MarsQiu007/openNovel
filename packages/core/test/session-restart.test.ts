import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { BackgroundJob } from "@opennovel-ai/core/background-job"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { KV } from "@opennovel-ai/core/kv"
import { Location } from "@opennovel-ai/core/location"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionRestart } from "@opennovel-ai/core/session/execution/restart"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionInputTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const wakeCalls: SessionV2.ID[] = []
const activeSessions = new Set<SessionV2.ID>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: (sessionID) => Effect.sync(() => void wakeCalls.push(sessionID)),
    interrupt: () => Effect.void,
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
      KV.node,
      SessionStore.node,
      SessionV2.node,
      BackgroundJob.node,
      SessionRestart.node,
    ]),
    [
      [SessionExecution.node, execution],
      [ProjectV2.node, projects],
    ],
  ),
)

const recoveryOf = (parentID: SessionV2.ID, childID: SessionV2.ID): Extract<BackgroundJob.Recovery, { kind: "subagent" }> => ({
  kind: "subagent",
  parentSessionID: parentID,
  childSessionID: childID,
  agent: "helper",
  description: "章节",
})

const seed = (record: { notificationID: SessionMessage.ID } & Record<string, KV.Value>) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    yield* kv.set(BackgroundJob.backgroundKey(record.notificationID), record)
  })

const recordOf = (notificationID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    return yield* kv.get(BackgroundJob.backgroundKey(notificationID))
  })

const parentRows = (parentID: SessionV2.ID) =>
  Database.Service.use(({ db }) =>
    db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, parentID)).all().pipe(Effect.orDie),
  )

const eventually = (check: Effect.Effect<boolean, never, Database.Service>) => {
  const loop: Effect.Effect<void, never, Database.Service> = Effect.flatMap(check, (ok) =>
    ok ? Effect.void : Effect.sleep(5).pipe(Effect.andThen(loop)),
  )
  return loop
}

describe("SessionRestart", () => {
  it.effect("discards records whose child, parent, or parentID linkage no longer matches", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      activeSessions.clear()
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })
      const other = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })

      const missingChild = SessionMessage.ID.create()
      yield* seed({
        id: "job-missing-child",
        notificationID: missingChild,
        recovery: recoveryOf(parent.id, SessionV2.ID.make("ses_missing")),
        status: "running",
      })
      const mismatchedParent = SessionMessage.ID.create()
      yield* seed({
        id: "job-mismatched",
        notificationID: mismatchedParent,
        recovery: recoveryOf(other.id, child.id),
        status: "running",
      })
      const missingParent = SessionMessage.ID.create()
      yield* seed({
        id: "job-missing-parent",
        notificationID: missingParent,
        recovery: recoveryOf(SessionV2.ID.make("ses_missing"), child.id),
        status: "running",
      })

      const restart = yield* SessionRestart.Service
      yield* restart.recover

      expect(yield* recordOf(missingChild)).toBeUndefined()
      expect(yield* recordOf(mismatchedParent)).toBeUndefined()
      expect(yield* recordOf(missingParent)).toBeUndefined()
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("replays terminal records as notifications without waking the parent", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      activeSessions.clear()
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const nid = SessionMessage.ID.create()
      yield* seed({
        id: child.id,
        notificationID: nid,
        recovery: recoveryOf(parent.id, child.id),
        status: "completed",
        output: "旧结果",
      })

      const restart = yield* SessionRestart.Service
      yield* restart.recover

      const rows = yield* parentRows(parent.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.prompt.text).toContain('state="completed"')
      expect(rows[0]?.prompt.text).toContain("旧结果")
      // fork 适配：恢复通知一律 resume:false，父会话不唤醒
      expect(wakeCalls).toEqual([])
      // 送达后清账
      expect(yield* recordOf(nid)).toBeUndefined()
    }),
  )

  it.effect("terminalizes running records that exhaust the resume budget", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      activeSessions.clear()
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const nid = SessionMessage.ID.create()
      yield* seed({
        id: child.id,
        notificationID: nid,
        recovery: recoveryOf(parent.id, child.id),
        status: "running",
        attempts: 10,
      })

      const restart = yield* SessionRestart.Service
      yield* restart.recover

      // 终态化以 error 通知呈现，child 不再 resume
      const rows = yield* parentRows(parent.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.prompt.text).toContain('state="error"')
      expect(rows[0]?.prompt.text).toContain("will not be resumed automatically")
      expect(wakeCalls).toEqual([])
      expect(yield* recordOf(nid)).toBeUndefined()
    }),
  )

  it.effect("restarts running records within budget and notifies on completion", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      activeSessions.clear()
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const nid = SessionMessage.ID.create()
      yield* seed({
        id: child.id,
        notificationID: nid,
        recovery: recoveryOf(parent.id, child.id),
        status: "running",
      })

      const restart = yield* SessionRestart.Service
      yield* restart.recover

      // 作业 run 显式 resume 了 child（无 assistant 消息 → NO_TEXT 兜底）
      expect(wakeCalls).toEqual([child.id])
      yield* eventually(Effect.map(parentRows(parent.id), (rows) => rows.length === 1))
      const rows = yield* parentRows(parent.id)
      expect(rows[0]?.prompt.text).toContain('state="completed"')
      expect(rows[0]?.prompt.text).toContain("Subagent completed without a text response.")
      expect(wakeCalls.filter((id) => id === parent.id)).toHaveLength(0)
      expect(yield* recordOf(nid)).toBeUndefined()
    }),
  )

  it.effect("skips running records whose child is already active in this process", () =>
    Effect.gen(function* () {
      wakeCalls.length = 0
      activeSessions.clear()
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ parentID: parent.id })
      const nid = SessionMessage.ID.create()
      yield* seed({
        id: child.id,
        notificationID: nid,
        recovery: recoveryOf(parent.id, child.id),
        status: "running",
      })
      activeSessions.add(child.id)

      const restart = yield* SessionRestart.Service
      yield* restart.recover

      // 本进程已持有该 child 的活跃 drain：记录保持 pending，不重复执行
      expect(wakeCalls).toEqual([])
      expect(yield* recordOf(nid)).toMatchObject({ status: "running" })
      activeSessions.delete(child.id)
    }),
  )
})
