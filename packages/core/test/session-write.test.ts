import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { Location } from "@opennovel-ai/core/location"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionInputTable, SessionTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { testEffect } from "./lib/effect"

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set<SessionV2.ID>()),
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
    LayerNode.group([Database.node, EventV2.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      [ProjectV2.node, projects],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const sessionRow = (sessionID: SessionV2.ID) =>
  Database.Service.use(({ db }) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie))

const inputRows = (messageID: SessionMessage.ID) =>
  Database.Service.use(({ db }) =>
    db.select().from(SessionInputTable).where(eq(SessionInputTable.id, messageID)).all().pipe(Effect.orDie),
  )

describe("SessionV2 write-side extensions", () => {
  it.effect("child sessions inherit parent location, metadata, and permission", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location })
      yield* Database.Service.use(({ db }) =>
        db
          .update(SessionTable)
          .set({ metadata: { team: "writing" }, permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
          .where(eq(SessionTable.id, parent.id))
          .run()
          .pipe(Effect.orDie),
      )

      const child = yield* session.create({ parentID: parent.id, title: "章节写作" })
      expect(child.parentID).toBe(parent.id)
      expect(child.title).toBe("章节写作")
      expect(child.location.directory).toBe(AbsolutePath.make("/project"))

      const row = yield* sessionRow(child.id)
      expect(row?.metadata).toEqual({ team: "writing" })
      expect(row?.permission).toEqual([{ permission: "edit", pattern: "*", action: "deny" }])
    }),
  )

  it.effect("create with a missing parent fails with NotFoundError", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const error = yield* Effect.flip(session.create({ parentID: SessionV2.ID.make("ses_missing") }))
      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )

  it.effect("children lists direct children only", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location })
      const first = yield* session.create({ parentID: parent.id })
      const second = yield* session.create({ parentID: parent.id })
      yield* session.create({ parentID: first.id })
      yield* session.create({ location })

      const direct = yield* session.children(parent.id)
      expect(direct.map((info) => info.id).toSorted()).toEqual([first.id, second.id].toSorted())
      expect((yield* session.children(first.id)).map((info) => info.parentID)).toEqual([first.id])
    }),
  )

  it.effect("synthetic admits durably and is idempotent by id", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { id: sessionID } = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      wakeCalls.length = 0

      yield* session.synthetic({ id: messageID, sessionID, text: "<subagent>完成</subagent>" })
      yield* session.synthetic({ id: messageID, sessionID, text: "<subagent>完成</subagent>" })

      expect(yield* inputRows(messageID)).toHaveLength(1)
      expect(wakeCalls).toEqual([sessionID, sessionID])
    }),
  )

  it.effect("synthetic with resume false admits without waking", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { id: sessionID } = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      wakeCalls.length = 0

      yield* session.synthetic({ id: messageID, sessionID, text: "<subagent>恢复通知</subagent>", resume: false })

      expect(wakeCalls).toEqual([])
      expect(yield* inputRows(messageID)).toHaveLength(1)
    }),
  )
})
