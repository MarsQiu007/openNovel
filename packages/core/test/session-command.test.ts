import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CommandV2 } from "@opennovel-ai/core/command"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionInput } from "@opennovel-ai/core/session/input"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionProjector } from "@opennovel-ai/core/session/projector"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
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
const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: (sessionID) => Effect.sync(() => wakeCalls.push(sessionID)),
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
      CommandV2.node,
      LocationServiceMap.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, execution],
    ],
  ),
)
const sessionID = SessionV2.ID.make("ses_command_test")

// Location 层构建会做文件系统探测，session 目录必须是真实存在的临时目录
const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  wakeCalls.length = 0
  const tmp = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  // tmpdir() 已返回 realpath 之后的真实路径
  const directory = AbsolutePath.make(tmp.path)
  yield* db
    .insert(ProjectTable)
    .values({ id: ProjectV2.ID.global, worktree: directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: ProjectV2.ID.global,
      slug: "test",
      directory,
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  // 命令注册在 Location 作用域：与 SessionV2.command 读取走同一 LocationServiceMap 实例。
  // 注意必须用 store 读出的 info.location：LayerMap 按结构哈希 key，
  // 「缺 workspaceID key」与「workspaceID: undefined」结构不等价，自建 Ref 会命中另一份 layer
  const session = yield* SessionV2.Service
  const info = yield* session.get(sessionID)
  const locations = yield* LocationServiceMap.Service
  yield* CommandV2.Service.use((commands) =>
    commands.transform((draft) => {
      draft.update("review", (command) => {
        command.description = "审阅章节"
        command.template = "请审阅 $ARGUMENTS，并给出修改建议"
      })
      draft.update("polish", (command) => {
        command.description = "润色段落"
        command.template = "润色 $1 章的 $2 节"
      })
    }),
  ).pipe(Effect.provide(locations.get(info.location)))
  return { location: info.location }
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInput.find(db, id))

describe("SessionV2.command", () => {
  it.effect("expands $ARGUMENTS and durably admits the template as a user prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.command({ sessionID, command: "review", arguments: "第三章" })

      expect(message.prompt.text).toBe("请审阅 第三章，并给出修改建议")
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        prompt: { text: "请审阅 第三章，并给出修改建议" },
        delivery: "steer",
      })
      expect(wakeCalls).toEqual([sessionID])
      // 转写提升前不可见（与 prompt admission 语义一致）
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("expands positional placeholders with the last one absorbing the rest", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.command({
        sessionID,
        command: "polish",
        arguments: "三 二 多余的词",
        resume: false,
      })

      expect(message.prompt.text).toBe("润色 三 章的 二 多余的词 节")
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("appends arguments when the template has no placeholder", () =>
    Effect.gen(function* () {
      const { location } = yield* setup
      const session = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      yield* CommandV2.Service.use((commands) =>
        commands.transform((draft) =>
          draft.update("init", (command) => {
            command.description = "初始化"
            command.template = "初始化项目设定"
          }),
        ),
      ).pipe(Effect.provide(locations.get(location)))

      const message = yield* session.command({ sessionID, command: "init", arguments: "偏武侠风", resume: false })

      expect(message.prompt.text).toBe("初始化项目设定\n\n偏武侠风")
    }),
  )

  it.effect("fails with CommandNotFoundError listing available commands", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const error = yield* session.command({ sessionID, command: "missing" }).pipe(Effect.flip)

      expect(error._tag).toBe("Session.CommandNotFoundError")
      if (error._tag !== "Session.CommandNotFoundError") return
      // 全局配置会注入内建命令（如 init），断言只要求列出测试注入的命令
      expect(error.available).toEqual(expect.arrayContaining(["review", "polish"]))
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("rejects a conflicting message ID retry like prompt admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const id = SessionMessage.ID.create()

      const first = yield* session.command({ id, sessionID, command: "review", arguments: "第三章", resume: false })
      expect(first.id).toBe(id)
      // 同 id 同内容：精确重试幂等
      const retried = yield* session.command({ id, sessionID, command: "review", arguments: "第三章", resume: false })
      expect(retried.id).toBe(id)
      // 同 id 不同内容：冲突
      const conflict = yield* session
        .command({ id, sessionID, command: "review", arguments: "第四章", resume: false })
        .pipe(Effect.flip)
      expect(conflict._tag).toBe("Session.PromptConflictError")
    }),
  )
})
