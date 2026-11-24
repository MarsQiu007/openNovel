import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { Global } from "@opennovel-ai/core/global"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
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
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
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

// global 哨兵语义：目录过滤值 "global" 解析为全局数据目录后过滤，其余值按字面路径过滤
describe("SessionV2.list directory sentinel", () => {
  it.effect(
    "global 命中全局目录会话且不命中项目会话",
    () =>
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        )
        const projectDirectory = AbsolutePath.make(tmp.path)
        yield* db
          .insert(ProjectTable)
          .values({ id: ProjectV2.ID.global, worktree: projectDirectory, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const rows = [
          {
            id: SessionV2.ID.make("ses_sentinel_global"),
            project_id: ProjectV2.ID.global,
            slug: "global",
            directory: Global.Path.data,
            title: "global session",
            version: "test",
          },
          {
            id: SessionV2.ID.make("ses_sentinel_project"),
            project_id: ProjectV2.ID.global,
            slug: "project",
            directory: projectDirectory,
            title: "project session",
            version: "test",
          },
        ]
        yield* db.insert(SessionTable).values(rows).onConflictDoNothing().run().pipe(Effect.orDie)

        const session = yield* SessionV2.Service
        const globalHits = yield* session.list({ directory: "global" })
        expect(globalHits.map((row) => row.id)).toEqual([SessionV2.ID.make("ses_sentinel_global")])

        const projectHits = yield* session.list({ directory: projectDirectory })
        expect(projectHits.map((row) => row.id)).toEqual([SessionV2.ID.make("ses_sentinel_project")])
      }),
  )
})