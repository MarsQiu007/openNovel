import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { BackgroundJob } from "@opennovel-ai/core/background-job"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Catalog } from "@opennovel-ai/core/catalog"
import { Config } from "@opennovel-ai/core/config"
import { ConfigExperimental } from "@opennovel-ai/core/config/experimental"
import { Database } from "@opennovel-ai/core/database/database"
import { AppNodeBuilder } from "@opennovel-ai/core/effect/app-node-builder"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { EventV2 } from "@opennovel-ai/core/event"
import { Location } from "@opennovel-ai/core/location"
import { ModelV2 } from "@opennovel-ai/core/model"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { PermissionV2 } from "@opennovel-ai/core/permission"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SubagentJob } from "@opennovel-ai/core/session/subagent-job"
import { SessionInputTable, SessionTable } from "@opennovel-ai/core/session/sql"
import { SessionStore } from "@opennovel-ai/core/session/store"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import { SubagentTool } from "@opennovel-ai/core/tool/subagent"
import { ToolOutputStore } from "@opennovel-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

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

const configEntries: Config.Entry[] = []
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(configEntries) }))

const availableModels: ModelV2.Info[] = []
const catalog = Layer.succeed(
  Catalog.Service,
  Catalog.Service.of({
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    provider: {
      get: () => Effect.die("unused"),
      all: () => Effect.die("unused"),
      available: () => Effect.die("unused"),
    },
    model: {
      get: () => Effect.die("unused"),
      all: () => Effect.die("unused"),
      available: () => Effect.succeed(availableModels),
      default: () => Effect.die("unused"),
      small: () => Effect.die("unused"),
    },
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionStore.node,
      SessionV2.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      SubagentTool.node,
      BackgroundJob.node,
      SubagentJob.node,
    ]),
    [
      [SessionExecution.node, execution],
      [ProjectV2.node, projects],
      [PermissionV2.node, permission],
      [Config.node, config],
      [Catalog.node, catalog],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

let callCounter = 0
const settleSubagent = (sessionID: SessionV2.ID, input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    return yield* settleTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call" as const, id: `call-subagent-${callCounter++}`, name: "subagent", input },
    })
  })

const addAgent = (id: string, mode: "subagent" | "primary", options?: { description?: string; model?: ModelV2.Ref }) =>
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* agents.transform((draft) => {
      draft.update(AgentV2.ID.make(id), (agent) => {
        agent.mode = mode
        if (options?.description !== undefined) agent.description = options.description
        if (options?.model !== undefined) agent.model = options.model
      })
    })
  })

const sessionRow = (sessionID: SessionV2.ID) =>
  Database.Service.use(({ db }) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie))

const promptRows = (sessionID: SessionV2.ID) =>
  Database.Service.use(({ db }) =>
    db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).all().pipe(Effect.orDie),
  )

const childIDOf = (settlement: { output?: { structured?: unknown } }) =>
  (settlement.output?.structured as { sessionID: SessionV2.ID }).sessionID

const eventually = (check: Effect.Effect<boolean, never, Database.Service>) => {
  const loop: Effect.Effect<void, never, Database.Service> = Effect.flatMap(check, (ok) =>
    ok ? Effect.void : Effect.sleep(5).pipe(Effect.andThen(loop)),
  )
  return loop
}

describe("SubagentTool", () => {
  it.effect("enforces the default depth limit of 1", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      const first = yield* settleSubagent(parent.id, {
        agent: "helper",
        description: "写第三章初稿",
        prompt: "写第三章初稿",
      })
      expect(first.result.type).toBe("text")
      const childID = childIDOf(first)
      const child = yield* sessionRow(SessionV2.ID.make(childID))
      expect(child?.parent_id).toBe(parent.id)
      // prompt 的 wake + 作业 run 的显式 resume，两次都指向 child
      expect(wakeCalls).toEqual([SessionV2.ID.make(childID), SessionV2.ID.make(childID)])

      const second = yield* settleSubagent(SessionV2.ID.make(childID), {
        agent: "helper",
        description: "嵌套续写",
        prompt: "嵌套续写",
      })
      expect(second.result).toMatchObject({
        type: "error",
        value: expect.stringContaining('Subagent depth limit reached (1). Increase "experimental.subagent_depth"'),
      })
    }),
  )

  it.effect("honors experimental.subagent_depth from config documents", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      configEntries.push(
        Config.Document.make({
          type: "document",
          info: Config.Info.make({
            experimental: ConfigExperimental.Experimental.make({ subagent_depth: 2 }),
          }),
        }),
      )
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      const first = yield* settleSubagent(parent.id, { agent: "helper", description: "一级", prompt: "一级" })
      const childID = childIDOf(first)
      const second = yield* settleSubagent(SessionV2.ID.make(childID), { agent: "helper", description: "二级", prompt: "二级" })
      expect(second.result.type).toBe("text")
      const grandchildID = childIDOf(second)
      const grandchild = yield* sessionRow(SessionV2.ID.make(grandchildID))
      expect(grandchild?.parent_id).toBe(childID)
    }),
  )

  it.effect("rejects primary agents", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      yield* addAgent("main", "primary")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      const settlement = yield* settleSubagent(parent.id, { agent: "main", description: "主代理", prompt: "主代理" })
      expect(settlement.result).toMatchObject({ type: "error", value: "Agent main cannot run as a subagent" })
      expect(assertions).toHaveLength(0)
    }),
  )

  it.effect("rejects continuation sessions outside the current session subtree", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })
      const otherParent = yield* sessions.create({ location })
      const otherChild = yield* sessions.create({ parentID: otherParent.id })

      const settlement = yield* settleSubagent(parent.id, {
        agent: "helper",
        description: "续聊",
        prompt: "续聊",
        sessionID: otherChild.id,
      })
      expect(settlement.result).toMatchObject({
        type: "error",
        value: `Session ${otherChild.id} is not a child of the current session`,
      })
    }),
  )

  it.effect("resolves the model as override, then agent, then parent", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      availableModels.length = 0
      const parentModel = ModelV2.Ref.make({ providerID: ProviderV2.ID.make("prov"), id: ModelV2.ID.make("parent-model") })
      const agentModel = ModelV2.Ref.make({ providerID: ProviderV2.ID.make("prov"), id: ModelV2.ID.make("agent-model") })
      yield* addAgent("chained", "subagent", { model: agentModel })
      yield* addAgent("plain", "subagent")
      availableModels.push(ModelV2.Info.empty(ProviderV2.ID.make("prov"), ModelV2.ID.make("override-model")))
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location, model: parentModel })

      const viaAgent = yield* settleSubagent(parent.id, { agent: "chained", description: "链一", prompt: "链一" })
      expect((yield* sessionRow(SessionV2.ID.make(childIDOf(viaAgent))))?.model).toMatchObject({ id: "agent-model" })

      const viaParent = yield* settleSubagent(parent.id, { agent: "plain", description: "链二", prompt: "链二" })
      expect((yield* sessionRow(SessionV2.ID.make(childIDOf(viaParent))))?.model).toMatchObject({ id: "parent-model" })

      const viaOverride = yield* settleSubagent(parent.id, {
        agent: "chained",
        description: "链三",
        prompt: "链三",
        model: "prov/override-model",
      })
      expect((yield* sessionRow(SessionV2.ID.make(childIDOf(viaOverride))))?.model).toMatchObject({ id: "override-model" })

      const missing = yield* settleSubagent(parent.id, {
        agent: "chained",
        description: "链四",
        prompt: "链四",
        model: "prov/absent-model",
      })
      expect(missing.result).toMatchObject({
        type: "error",
        value: 'Model "prov/absent-model" is not available. Use the models tool to see what is available.',
      })
    }),
  )

  it.effect("asserts permission for the resolved agent and surfaces denials", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      deny = false
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      yield* settleSubagent(parent.id, { agent: "helper", description: "权限", prompt: "权限" })
      expect(assertions).toMatchObject([
        {
          action: "subagent",
          resources: ["helper"],
          save: ["helper"],
          sessionID: parent.id,
          agent: "build",
          source: { type: "tool", messageID: toolIdentity.assistantMessageID, callID: expect.stringContaining("call-subagent") },
        },
      ])

      deny = true
      const denied = yield* settleSubagent(parent.id, { agent: "helper", description: "权限", prompt: "权限" })
      expect(denied.result).toMatchObject({ type: "error", value: "Subagent denied: helper" })
      deny = false
    }),
  )

  it.effect("treats empty-string model and sessionID parameters as absent", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      const parentModel = ModelV2.Ref.make({ providerID: ProviderV2.ID.make("prov"), id: ModelV2.ID.make("parent-model") })
      yield* addAgent("plain", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location, model: parentModel })

      const settlement = yield* settleSubagent(parent.id, {
        agent: "plain",
        description: "空串",
        prompt: "空串",
        model: "",
        sessionID: "",
      })
      expect(settlement.result.type).toBe("text")
      expect((yield* sessionRow(SessionV2.ID.make(childIDOf(settlement))))?.model).toMatchObject({ id: "parent-model" })
    }),
  )

  it.effect("prepends the spawn notice only for new conversations", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      const first = yield* settleSubagent(parent.id, { agent: "helper", description: "前缀", prompt: "写第三章" })
      const childID = SessionV2.ID.make(childIDOf(first))
      const spawned = yield* promptRows(childID)
      expect(spawned).toHaveLength(1)
      expect(spawned[0]?.prompt.text).toBe("You are a subagent spawned by another session.\n写第三章")

      const second = yield* settleSubagent(parent.id, {
        agent: "helper",
        description: "前缀",
        prompt: "继续",
        sessionID: childID,
      })
      expect(SessionV2.ID.make(childIDOf(second))).toBe(childID)
      const continued = yield* promptRows(childID)
      expect(continued).toHaveLength(2)
      expect(continued[1]?.prompt.text).toBe("继续")
    }),
  )

  it.effect("lists non-primary non-hidden agents in the description and honors deny rules", () =>
    Effect.gen(function* () {
      configEntries.length = 0
      yield* addAgent("helper", "subagent", { description: "编写章节初稿" })
      yield* addAgent("main", "primary", { description: "主写手" })
      const registry = yield* ToolRegistry.Service

      const open = yield* toolDefinitions(registry)
      const subagent = open.find((definition) => definition.name === "subagent")
      expect(subagent?.description).toContain("Available subagents:")
      expect(subagent?.description).toContain("- helper: 编写章节初稿")
      expect(subagent?.description).not.toContain("- main:")

      const filtered = yield* toolDefinitions(registry, [{ action: "subagent", resource: "helper", effect: "deny" }])
      const filteredSubagent = filtered.find((definition) => definition.name === "subagent")
      expect(filteredSubagent?.description).not.toContain("- helper:")
      expect(filteredSubagent?.description).not.toContain("Available subagents:")
    }),
  )

  it.effect("foreground waits on the job and returns its completed output", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      const settlement = yield* settleSubagent(parent.id, { agent: "helper", description: "前台", prompt: "写" })
      expect(settlement.result.type).toBe("text")
      // 无 assistant 消息的 child 走 NO_TEXT 兜底
      expect(settlement.result.value).toContain('state="completed"')
      expect(settlement.result.value).toContain("Subagent completed without a text response.")
    }),
  )

  it.effect("background branch admits resume-free and notifies the parent on completion", () =>
    Effect.gen(function* () {
      assertions.length = 0
      wakeCalls.length = 0
      configEntries.length = 0
      yield* addAgent("helper", "subagent")
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create({ location })

      const settlement = yield* settleSubagent(parent.id, {
        agent: "helper",
        description: "后台",
        prompt: "写第三章",
        background: true,
      })
      expect(settlement.result.type).toBe("text")
      expect(settlement.result.value).toContain("working in the background")
      expect(settlement.result.value).toContain("DO NOT sleep, poll for progress")

      const childID = SessionV2.ID.make(childIDOf(settlement))
      // 后台新会话 admit-only：prompt 落库一次，作业 run 的显式 resume 是唯一执行起点
      expect(yield* promptRows(childID)).toHaveLength(1)
      expect(wakeCalls.filter((id) => id === childID)).toHaveLength(1)

      // 作业完成后，观察者把 <subagent> 通知注入父会话（默认 resume 语义唤醒父）；
      // 送达会触发 completeBackground 清账，作业可能已从注册表移除，故按通知行断言
      yield* eventually(
        Effect.map(promptRows(parent.id), (rows) => rows.some((row) => row.prompt.text.includes('state="completed"'))),
      )
      expect(wakeCalls.filter((id) => id === parent.id)).toHaveLength(1)
    }),
  )
})
