import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { Project } from "@opennovel-ai/core/project"
import { ProjectTable } from "@opennovel-ai/core/project/sql"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionTable } from "@opennovel-ai/core/session/sql"
import { SessionWorkRun } from "@opennovel-ai/core/session/work-run"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { WorkRunTool } from "@opennovel-ai/core/tool/workrun"
import { ToolOutputStore } from "@opennovel-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolIdentity, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_workrun_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionWorkRun.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      WorkRunTool.node,
    ]),
    [
      [PermissionV2.node, permission],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
  deny = false
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "workrun-tool",
      directory: "/project",
      title: "workrun-tool",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (input: Record<string, unknown>, id = "call-workrun") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: WorkRunTool.name, input },
})

const itemStatuses = (run: { readonly items: ReadonlyArray<{ readonly status: string }> }) =>
  run.items.map((item) => item.status)

const runOf = (settlement: { readonly output?: { readonly structured?: unknown } }) => {
  const structured = settlement.output?.structured as typeof WorkRunTool.Output.Type | undefined
  if (structured === undefined) throw new Error("expected structured tool output")
  return structured.run
}

describe("WorkRunTool", () => {
  it.effect("create 声明队列返回全貌并断言权限，重复创建被拒绝", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([WorkRunTool.name])

      const settlement = yield* settleTool(
        registry,
        call({ action: "create", goal: "逐章审查全书", items: ["第 1 章", "第 2 章"] }),
      )
      expect(runOf(settlement).status).toBe("active")
      expect(runOf(settlement).goal).toBe("逐章审查全书")
      expect(itemStatuses(runOf(settlement))).toEqual(["pending", "pending"])
      expect(settlement.result).toEqual({
        type: "text",
        value: JSON.stringify(runOf(settlement), null, 2),
      })
      expect(assertions).toMatchObject([{ sessionID, action: "workrun", resources: ["*"], save: ["*"] }])

      expect(
        yield* executeTool(registry, call({ action: "create", goal: "x", items: ["y"] })),
      ).toEqual({ type: "error", value: "会话已有活动工作队列，须先完结后再创建" })
    }),
  )

  it.effect("claim 与 complete_item 推进状态机，非法跃迁与缺 seq 被拒绝", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      yield* settleTool(registry, call({ action: "create", goal: "g", items: ["a", "b"] }))

      const claimed = yield* settleTool(registry, call({ action: "claim" }))
      expect(itemStatuses(runOf(claimed))).toEqual(["in_progress", "pending"])

      expect(yield* executeTool(registry, call({ action: "complete_item" }))).toEqual({
        type: "error",
        value: "complete_item 需要 seq",
      })

      const done = yield* settleTool(registry, call({ action: "complete_item", seq: 0 }))
      expect(itemStatuses(runOf(done))).toEqual(["done", "pending"])

      const again = yield* executeTool(registry, call({ action: "complete_item", seq: 0 }, "call-again"))
      expect(again).toEqual({
        type: "error",
        value: "单元状态为 done，不能转为 done",
      })

      const second = yield* settleTool(registry, call({ action: "claim" }, "call-claim-2"))
      expect(itemStatuses(runOf(second))).toEqual(["done", "in_progress"])
      yield* settleTool(registry, call({ action: "complete_item", seq: 1 }, "call-complete-2"))

      expect(yield* executeTool(registry, call({ action: "claim" }, "call-claim-3"))).toEqual({
        type: "error",
        value: "队列没有待处理单元",
      })
    }),
  )

  it.effect("block_item 附原因可重置，缺 reason 被拒绝", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      yield* settleTool(registry, call({ action: "create", goal: "g", items: ["a"] }))
      yield* settleTool(registry, call({ action: "claim" }))

      expect(yield* executeTool(registry, call({ action: "block_item", seq: 0 }))).toEqual({
        type: "error",
        value: "block_item 需要 reason",
      })

      const blocked = yield* settleTool(registry, call({ action: "block_item", seq: 0, reason: "前置缺失" }))
      expect(itemStatuses(runOf(blocked))).toEqual(["blocked"])
      expect(runOf(blocked).items[0].note).toBe("前置缺失")

      const reset = yield* settleTool(registry, call({ action: "reset_item", seq: 0 }))
      expect(itemStatuses(runOf(reset))).toEqual(["pending"])
      expect(runOf(reset).items[0].note).toBeUndefined()
    }),
  )

  it.effect("progress 覆盖笔记，finish 校验未终结单元，完结后无活动队列", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      yield* settleTool(registry, call({ action: "create", goal: "g", items: ["a"] }))
      yield* settleTool(registry, call({ action: "claim" }))

      const progressed = yield* settleTool(registry, call({ action: "progress", note: "第一版笔记" }))
      expect(runOf(progressed).progressNote).toBe("第一版笔记")
      const overwritten = yield* settleTool(registry, call({ action: "progress", note: "覆盖后的最新笔记" }))
      expect(runOf(overwritten).progressNote).toBe("覆盖后的最新笔记")

      expect(yield* executeTool(registry, call({ action: "finish" }))).toEqual({
        type: "error",
        value: "还有 1 个未终结单元，不能终结队列",
      })

      yield* settleTool(registry, call({ action: "skip_item", seq: 0 }))
      const finished = yield* settleTool(registry, call({ action: "finish" }))
      expect(runOf(finished).status).toBe("complete")

      expect(yield* executeTool(registry, call({ action: "claim" }))).toEqual({
        type: "error",
        value: "没有活动的工作队列",
      })
    }),
  )

  it.effect("权限拒绝时不改动持久化队列", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const workrun = yield* SessionWorkRun.Service
      deny = true

      expect(
        yield* executeTool(registry, call({ action: "create", goal: "g", items: ["a"] })),
      ).toEqual({ type: "error", value: "Unable to update work queue" })
      expect(yield* workrun.current(sessionID)).toBeUndefined()
      expect(deny).toBe(true)
      expect(assertions).toMatchObject([{ sessionID, action: "workrun" }])
    }),
  )
})
