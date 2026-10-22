import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionInputTable, SessionTable, TodoTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { SessionTodo } from "@opennovel-ai/core/session/todo"
import { eq } from "drizzle-orm"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const interruptCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    interrupt: (sessionID) => Effect.sync(() => interruptCalls.push(sessionID)),
    wake: () => Effect.void,
    wait: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      LocationServiceMap.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, execution],
    ],
  ),
)

// Location 层构建会做文件系统探测，session 目录必须是真实存在的临时目录
const setup = Effect.gen(function* () {
  interruptCalls.length = 0
  const tmp = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  // tmpdir() 已返回 realpath 之后的真实路径
  const session = yield* SessionV2.Service
  const info = yield* session.create({ location: { directory: AbsolutePath.make(tmp.path) } })
  return { session, info }
})

const inputRows = (sessionID: SessionV2.ID) =>
  Database.Service.use(({ db }) =>
    db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).all(),
  ).pipe(Effect.orDie)
const todoRows = (sessionID: SessionV2.ID) =>
  Database.Service.use(({ db }) => db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).all()).pipe(
    Effect.orDie,
  )

describe("SessionV2.remove", () => {
  it.effect("publishes session.next.deleted, clears the row and cascades session-scoped tables", () =>
    Effect.gen(function* () {
      const { session, info } = yield* setup
      const events = yield* EventV2.Service
      const deleted: SessionV2.ID[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type !== "session.next.deleted") return
          // 事件 payload 的 timestamp 是 DateTime 实例，只对所需字段做精确 decode
          deleted.push(Schema.decodeUnknownSync(Schema.Struct({ sessionID: SessionV2.ID }))(event.data).sessionID)
        }),
      )
      yield* session.prompt({ sessionID: info.id, prompt: { text: "第一章大纲" }, resume: false })
      const locations = yield* LocationServiceMap.Service
      // 与 SessionV2.todo 读取走同一 LocationServiceMap 实例；必须用 store 读出的
      // info.location（LayerMap 按结构哈希 key，自建 Ref 会命中另一份 layer）
      yield* SessionTodo.Service.use((todo) =>
        todo.update({
          sessionID: info.id,
          todos: [{ content: "写第三章", status: "in_progress", priority: "high" }],
        }),
      ).pipe(Effect.provide(locations.get(info.location)))
      expect((yield* inputRows(info.id)).length).toBe(1)
      expect((yield* todoRows(info.id)).length).toBe(1)

      yield* session.remove(info.id)

      expect(deleted).toEqual([info.id])
      expect(interruptCalls).toEqual([info.id])
      const missing = yield* session.get(info.id).pipe(Effect.flip)
      expect(missing._tag).toBe("Session.NotFoundError")
      expect(yield* inputRows(info.id)).toEqual([])
      expect(yield* todoRows(info.id)).toEqual([])
      // 聚合事件历史一并清除
      expect(
        yield* Database.Service.use(({ db }) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, info.id)).all(),
        ).pipe(Effect.orDie),
      ).toEqual([])
    }),
  )

  it.effect("recurses into children and is idempotent", () =>
    Effect.gen(function* () {
      const { session, info } = yield* setup
      const child = yield* session.create({ parentID: info.id, location: info.location })

      yield* session.remove(info.id)

      for (const id of [child.id, info.id]) {
        const missing = yield* session.get(id).pipe(Effect.flip)
        expect(missing._tag).toBe("Session.NotFoundError")
      }
      expect(interruptCalls.toSorted()).toEqual([child.id, info.id].toSorted())
      // 重复删除是 no-op
      yield* session.remove(info.id)
      yield* session.remove(SessionV2.ID.make("ses_remove_missing"))
    }),
  )
})

describe("SessionV2.todo", () => {
  it.effect("returns the seeded todos in position order", () =>
    Effect.gen(function* () {
      const { session, info } = yield* setup
      const locations = yield* LocationServiceMap.Service
      yield* SessionTodo.Service.use((todo) =>
        todo.update({
          sessionID: info.id,
          todos: [
            { content: "写第三章", status: "in_progress", priority: "high" },
            { content: "校对第二章", status: "pending", priority: "low" },
          ],
        }),
      ).pipe(Effect.provide(locations.get(info.location)))

      expect(yield* session.todo(info.id)).toEqual([
        { content: "写第三章", status: "in_progress", priority: "high" },
        { content: "校对第二章", status: "pending", priority: "low" },
      ])
      const missing = yield* session.todo(SessionV2.ID.make("ses_todo_missing")).pipe(Effect.flip)
      expect(missing._tag).toBe("Session.NotFoundError")
    }),
  )
})

describe("SessionV2.diff", () => {
  it.effect("returns an empty diff when no assistant snapshot was captured", () =>
    Effect.gen(function* () {
      const { session, info } = yield* setup
      yield* session.prompt({ sessionID: info.id, prompt: { text: "第一章大纲" }, resume: false })

      expect(yield* session.diff(info.id)).toEqual([])
      const missing = yield* session.diff(SessionV2.ID.make("ses_diff_missing")).pipe(Effect.flip)
      expect(missing._tag).toBe("Session.NotFoundError")
    }),
  )
})
