import { describe, expect, test } from "bun:test"
import type { ToolDefinition } from "@opennovel-ai/llm"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Location } from "@opennovel-ai/core/location"
import { PluginSession } from "@opennovel-ai/core/plugin/session"
import { SessionPurpose } from "@opennovel-ai/core/plugin/session-purpose"
import { ProjectV2 } from "@opennovel-ai/core/project"
import { SessionExecution } from "@opennovel-ai/core/session/execution"
import { SessionInput } from "@opennovel-ai/core/session/input"
import { SessionMessage } from "@opennovel-ai/core/session/message"
import { SessionSchema } from "@opennovel-ai/core/session/schema"
import { SessionV2 } from "@opennovel-ai/core/session"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { ToolRegistry } from "@opennovel-ai/core/tool/registry"
import type { BackgroundSessionInput } from "@opennovel-ai/plugin/v2/effect"
import { DateTime, Deferred, Effect, Exit, Layer, Scope, Stream } from "effect"

const dieUnused = () => Effect.die("测试桩未实现的成员")

const assistantMessage = (text: string) =>
  // 测试只需 finalText 能读到 type/content/text 形状，完整消息形状无需伪造
  ({ type: "assistant", content: [{ type: "text", id: "msg_text", text }] }) as unknown as SessionMessage.Message

const userMessage = (text: string) => ({ type: "user", text }) as unknown as SessionMessage.Message

const fakeInfo = (id: string, parentID?: string) =>
  SessionSchema.Info.make({
    id: SessionSchema.ID.make(id),
    ...(parentID === undefined ? {} : { parentID: SessionSchema.ID.make(parentID) }),
    projectID: ProjectV2.ID.make("prj_test"),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    title: "fake",
    location: Location.Ref.make({ directory: AbsolutePath.make("/p") }),
  })

const fakeSessions = (overrides: Partial<SessionV2.Interface> = {}): SessionV2.Interface =>
  SessionV2.Service.of({
    list: dieUnused,
    create: dieUnused,
    children: dieUnused,
    synthetic: dieUnused,
    get: () => Effect.fail(new SessionV2.NotFoundError({ sessionID: SessionSchema.ID.make("ses_missing") })),
    messages: dieUnused,
    message: dieUnused,
    context: dieUnused,
    events: () => Stream.die("测试桩未实现的成员"),
    history: dieUnused,
    switchAgent: dieUnused,
    switchModel: dieUnused,
    prompt: dieUnused,
    shell: dieUnused,
    skill: dieUnused,
    compact: dieUnused,
    wait: dieUnused,
    command: dieUnused,
    update: dieUnused,
    move: dieUnused,
    remove: dieUnused,
    todo: dieUnused,
    diff: dieUnused,
    active: Effect.succeed(new Set<SessionSchema.ID>()),
    resume: dieUnused,
    interrupt: dieUnused,
    revert: { stage: dieUnused, clear: dieUnused, commit: dieUnused },
    ...overrides,
  })

const fakeExecution = (overrides: Partial<SessionExecution.Interface> = {}) => {
  const interrupts: string[] = []
  const service = SessionExecution.Service.of({
    active: overrides.active ?? Effect.succeed(new Set<SessionSchema.ID>()),
    resume: overrides.resume ?? dieUnused,
    wake: dieUnused,
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interrupts.push(sessionID)
      }),
    wait: overrides.wait ?? dieUnused,
  })
  return { service, interrupts }
}

// Location 预检段的替身：agent 恒存在，registry 物化出给定工具名集合
const fakeWithinLocation = (toolNames: readonly string[]) => {
  const agents = AgentV2.Service.of({
    transform: dieUnused,
    reload: dieUnused,
    get: dieUnused,
    default: dieUnused,
    resolve: dieUnused,
    select: () =>
      Effect.succeed({ id: AgentV2.ID.make("build"), info: AgentV2.Info.empty(AgentV2.ID.make("build")) }),
    all: () => Effect.succeed([]),
  })
  const registry = ToolRegistry.Service.of({
    materialize: () =>
      Effect.succeed({
        definitions: toolNames.map((name) => ({ name, description: "", inputSchema: {} })) as ToolDefinition[],
        settle: dieUnused,
      }),
    register: dieUnused,
  })
  return <A>(
    ref: Location.Ref,
    precheck: Effect.Effect<A, Error, AgentV2.Service | ToolRegistry.Service>,
  ): Effect.Effect<A, unknown> =>
    Effect.provide(
      precheck,
      Layer.merge(Layer.succeed(AgentV2.Service, agents), Layer.succeed(ToolRegistry.Service, registry)),
    )
}

const admittedFake = (input: Parameters<SessionV2.Interface["prompt"]>[0]) =>
  SessionInput.Admitted.make({
    admittedSeq: 0,
    id: input.id ?? SessionMessage.ID.create(),
    sessionID: input.sessionID,
    // Admitted 的 prompt 是 schema 侧形状（files 需 mime），桩只承载文本
    prompt: { text: input.prompt.text },
    delivery: "steer",
    timeCreated: DateTime.makeUnsafe(0),
  })

const organizeInput = (over: Partial<BackgroundSessionInput> = {}): BackgroundSessionInput => ({
  mode: "organize",
  agent: "build",
  prompt: "整理该问题",
  expectedTools: [],
  directory: "/tmp/organize",
  ...over,
})

const retestInput = (over: Partial<BackgroundSessionInput> = {}): BackgroundSessionInput => ({
  mode: "retest",
  agent: "build",
  prompt: "复测该问题",
  expectedTools: ["bash"],
  directory: "/tmp/retest",
  authorization: { id: "auth-1", caseDigest: "digest" },
  ...over,
})

// 测试与生命周期 fiber 的确定性握手：fake 进入阶段时 succeed(entered)，测试 await 后再推进
const gate = Effect.gen(function* () {
  const entered = yield* Deferred.make<void>()
  const open = yield* Deferred.make<void>()
  return { entered, open }
})

/** 门控与断言必须在同一个 scoped effect 内完成：外层 scope 关闭会触发 finalizer 取消存活 handle */
const inside = <A>(body: Effect.Effect<A, unknown, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

describe("PluginSession 后台会话生命周期", () => {
  test("organize 携带非空工具集合在 create 前拒绝", async () => {
    const created: string[] = []
    await expect(
      inside(
        Effect.gen(function* () {
          const domain = yield* PluginSession.make({
            sessions: fakeSessions({
              create: (input) =>
                Effect.sync(() => {
                  created.push(input.id ?? "ses_unspecified")
                  return fakeInfo(input.id ?? "ses_unspecified")
                }),
            }),
            execution: fakeExecution().service,
            withinLocation: fakeWithinLocation(["bash"]),
          })
          return yield* Effect.promise(() => domain.startBackground(organizeInput({ expectedTools: ["bash"] })))
        }),
      ),
    ).rejects.toThrow("预期工具集合必须为空")
    expect(created).toEqual([])
  })

  test("retest 缺少宿主执行授权在 create 前拒绝", async () => {
    const created: string[] = []
    await expect(
      inside(
        Effect.gen(function* () {
          const domain = yield* PluginSession.make({
            sessions: fakeSessions({
              create: (input) =>
                Effect.sync(() => {
                  created.push(input.id ?? "ses_unspecified")
                  return fakeInfo(input.id ?? "ses_unspecified")
                }),
            }),
            execution: fakeExecution().service,
            withinLocation: fakeWithinLocation(["bash"]),
          })
          const { authorization: _dropped, ...input } = retestInput()
          return yield* Effect.promise(() => domain.startBackground(input))
        }),
      ),
    ).rejects.toThrow("缺少宿主执行授权")
    expect(created).toEqual([])
  })

  test("位置来源必须二选一：parentID 与 directory 同时给或都不给都拒绝", async () => {
    const domainInput = {
      sessions: fakeSessions(),
      execution: fakeExecution().service,
      withinLocation: fakeWithinLocation([]),
    }
    await expect(
      inside(
        Effect.gen(function* () {
          const domain = yield* PluginSession.make(domainInput)
          return yield* Effect.promise(() => domain.startBackground(organizeInput({ parentID: "ses_parent" })))
        }),
      ),
    ).rejects.toThrow("二选一")
    await expect(
      inside(
        Effect.gen(function* () {
          const domain = yield* PluginSession.make(domainInput)
          const { directory: _dropped, ...input } = organizeInput()
          return yield* Effect.promise(() => domain.startBackground(input))
        }),
      ),
    ).rejects.toThrow("二选一")
  })

  test("organize 预期空工具但实际物化非空则预检拒绝且不 admission", async () => {
    const admissions: string[] = []
    const result = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) =>
              Effect.sync(() => {
                admissions.push(input.sessionID)
                return admittedFake(input)
              }),
          }),
          execution: fakeExecution().service,
          // 目标 Location 实际物化出 bash，与 organize 的空预期不一致
          withinLocation: fakeWithinLocation(["bash"]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        return yield* Effect.promise(() => handle.done)
      }),
    )
    if (result.status !== "failure") throw new Error("应为 failure 结果")
    expect(result.reason).toContain("工具集合不匹配")
    expect(admissions).toEqual([])
  })

  test("等待父会话落定期间取消则不再 create", async () => {
    const created: string[] = []
    const createdInputs: Array<Parameters<SessionV2.Interface["create"]>[0]> = []
    const { service, interrupts } = fakeExecution()
    const outcome = await inside(
      Effect.gen(function* () {
        const g = yield* gate
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            wait: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(g.entered, undefined)
                yield* Deferred.await(g.open)
              }),
            create: (input) =>
              Effect.sync(() => {
                createdInputs.push(input)
                created.push(input.id ?? "ses_unspecified")
                return fakeInfo(input.id ?? "ses_unspecified")
              }),
          }),
          execution: service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() =>
          domain.startBackground({
            mode: "organize",
            agent: "build",
            prompt: "整理该问题",
            expectedTools: [],
            parentID: "ses_parent",
          }),
        )
        yield* Deferred.await(g.entered)
        yield* Effect.promise(() => handle.cancel())
        return { result: yield* Effect.promise(() => handle.done), handleID: handle.id }
      }),
    )
    expect(outcome.result).toEqual({ status: "cancelled" })
    expect(created).toEqual([])
    expect(createdInputs).toEqual([])
    expect(interrupts).toContain(outcome.handleID)
  })

  test("父会话路径经 create 传 parentID 且不带显式 Location，归因继承原 Location", async () => {
    const createdInputs: Array<Parameters<SessionV2.Interface["create"]>[0]> = []
    await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) =>
              Effect.sync(() => {
                createdInputs.push(input)
                return fakeInfo(input.id ?? "ses_unspecified")
              }),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: () => Effect.void,
            wait: () => Effect.void,
            messages: () => Effect.succeed([assistantMessage("继承路径完成")]),
          }),
          execution: fakeExecution().service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() =>
          domain.startBackground({
            mode: "organize",
            agent: "build",
            prompt: "整理该问题",
            expectedTools: [],
            parentID: "ses_parent",
          }),
        )
        return yield* Effect.promise(() => handle.done)
      }),
    )
    expect(createdInputs).toHaveLength(1)
    expect(String(createdInputs[0]?.parentID)).toBe("ses_parent")
    expect(createdInputs[0]?.location).toBeUndefined()
  })

  test("已 admission 未 resume 的窗口内取消则不再发车", async () => {
    const attempts: string[] = []
    const resumes: string[] = []
    const { service, interrupts } = fakeExecution()
    const outcome = await inside(
      Effect.gen(function* () {
        const g = yield* gate
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) =>
              Effect.gen(function* () {
                attempts.push(input.sessionID)
                yield* Deferred.succeed(g.entered, undefined)
                yield* Deferred.await(g.open)
                return admittedFake(input)
              }),
            resume: (sessionID) =>
              Effect.sync(() => {
                resumes.push(sessionID)
              }),
          }),
          execution: service,
          withinLocation: fakeWithinLocation(["bash"]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(retestInput()))
        yield* Deferred.await(g.entered)
        yield* Effect.promise(() => handle.cancel())
        return yield* Effect.promise(() => handle.done)
      }),
    )
    expect(outcome).toEqual({ status: "cancelled" })
    expect(attempts).toHaveLength(1)
    expect(resumes).toEqual([])
    expect(interrupts.length).toBeGreaterThan(0)
  })

  test("执行中取消触发真实 interrupt 并落 cancelled", async () => {
    // gate 在测试作用域构造（Deferred 与 runtime 无关），fake resume 才能引用同一个 gate
    const g = {
      entered: Effect.runSync(Deferred.make<void>()),
      open: Effect.runSync(Deferred.make<void>()),
    }
    const resumes: string[] = []
    const { service, interrupts } = fakeExecution()
    const outcome = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: (sessionID) =>
              Effect.gen(function* () {
                resumes.push(sessionID)
                yield* Deferred.succeed(g.entered, undefined)
                yield* Deferred.await(g.open)
              }),
          }),
          execution: service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        yield* Deferred.await(g.entered)
        yield* Effect.promise(() => handle.cancel())
        return { result: yield* Effect.promise(() => handle.done), handleID: handle.id }
      }),
    )
    expect(outcome.result).toEqual({ status: "cancelled" })
    expect(resumes).toHaveLength(1)
    expect(interrupts.filter((id) => id === outcome.handleID).length).toBeGreaterThan(0)
  })

  test("settled 观察点：pending wake 重新活动则继续等待下一边界", async () => {
    const active = new Set<SessionSchema.ID>()
    const child = SessionSchema.ID.make("ses_child")
    const outcome = await inside(
      Effect.gen(function* () {
        const gates = [yield* gate, yield* gate]
        let calls = 0
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            wait: () => {
              const index = Math.min(calls++, gates.length - 1)
              return Effect.gen(function* () {
                yield* Deferred.succeed(gates[index].entered, undefined)
                yield* Deferred.await(gates[index].open)
              })
            },
          }),
          execution: fakeExecution({ active: Effect.sync(() => new Set(active)) }).service,
          withinLocation: fakeWithinLocation([]),
        })
        const settledPromise = domain.settled(child)
        // 第一次观察点：会话仍活动（模拟 pending wake 重启执行）→ 必须继续等待
        yield* Deferred.await(gates[0].entered)
        active.add(child)
        yield* Deferred.succeed(gates[0].open, undefined)
        // 循环确实进入第二次等待；放行后观察点不再活动 → 落定
        yield* Deferred.await(gates[1].entered)
        active.delete(child)
        yield* Deferred.succeed(gates[1].open, undefined)
        return yield* Effect.promise(() => settledPromise)
      }),
    )
    expect(outcome).toBeUndefined()
  })

  test("真实执行错误不被 wait 吞掉：resume 失败落为 failure 并 interrupt 残余", async () => {
    const { service, interrupts } = fakeExecution()
    const outcome = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: (sessionID) => Effect.fail(new SessionV2.NotFoundError({ sessionID })),
            wait: () => Effect.void,
          }),
          execution: service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        return { result: yield* Effect.promise(() => handle.done), handleID: handle.id }
      }),
    )
    if (outcome.result.status !== "failure") throw new Error("应为 failure 结果")
    expect(outcome.result.reason).toContain("后台会话执行失败")
    expect(interrupts).toContain(outcome.handleID)
  })

  test("成功路径携带最终 assistant 文本并 interrupt 剩余活动", async () => {
    const { service, interrupts } = fakeExecution()
    const outcome = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: () => Effect.void,
            wait: () => Effect.void,
            messages: () => Effect.succeed([assistantMessage("最终结论：工具描述有歧义")]),
          }),
          execution: service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        return { result: yield* Effect.promise(() => handle.done), handleID: handle.id }
      }),
    )
    expect(outcome.result).toEqual({ status: "success", text: "最终结论：工具描述有歧义" })
    expect(interrupts).toContain(outcome.handleID)
  })

  test("无 assistant 文本则失败", async () => {
    const result = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: () => Effect.void,
            wait: () => Effect.void,
            messages: () => Effect.succeed([userMessage("整理")]),
          }),
          execution: fakeExecution().service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        return yield* Effect.promise(() => handle.done)
      }),
    )
    if (result.status !== "failure") throw new Error("应为 failure 结果")
    expect(result.reason).toContain("assistant")
  })

  test("get 回填 purpose，不存在的 Session 返回 undefined", async () => {
    SessionPurpose.register("ses_registered", "tool-insight")
    const outcome = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            get: (sessionID) =>
              sessionID === "ses_registered"
                ? Effect.succeed(fakeInfo("ses_registered"))
                : Effect.fail(new SessionV2.NotFoundError({ sessionID })),
          }),
          execution: fakeExecution().service,
          withinLocation: fakeWithinLocation([]),
        })
        const registered = yield* Effect.promise(() => domain.get("ses_registered"))
        const missing = yield* Effect.promise(() => domain.get("ses_missing"))
        return { registered, missing }
      }),
    )
    expect(outcome.registered).toMatchObject({ id: "ses_registered", purpose: "tool-insight" })
    expect(outcome.missing).toBeUndefined()
  })

  test("完成后的重复取消幂等：done 保持既有结果", async () => {
    const result = await inside(
      Effect.gen(function* () {
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: () => Effect.void,
            wait: () => Effect.void,
            messages: () => Effect.succeed([assistantMessage("done")]),
          }),
          execution: fakeExecution().service,
          withinLocation: fakeWithinLocation([]),
        })
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        const done = yield* Effect.promise(() => handle.done)
        yield* Effect.promise(() => handle.cancel())
        yield* Effect.promise(() => handle.cancel())
        const doneAgain = yield* Effect.promise(() => handle.done)
        return { done, doneAgain }
      }),
    )
    expect(result.done).toEqual({ status: "success", text: "done" })
    expect(result.doneAgain).toEqual(result.done)
  })

  test("scope 关闭经 finalizer 对存活 handle 执行真实 cancel（任务 2.3）", async () => {
    const { service, interrupts } = fakeExecution()
    const outcome = await inside(
      Effect.gen(function* () {
        const g = yield* gate
        // 手动 scope 持有 domain：显式 close 模拟插件卸载/关开关
        const scope = yield* Scope.make()
        const domain = yield* PluginSession.make({
          sessions: fakeSessions({
            create: (input) => Effect.sync(() => fakeInfo(input.id ?? "ses_unspecified")),
            prompt: (input) => Effect.sync(() => admittedFake(input)),
            resume: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(g.entered, undefined)
                yield* Deferred.await(g.open)
              }),
          }),
          execution: service,
          withinLocation: fakeWithinLocation([]),
        }).pipe(Effect.provideService(Scope.Scope, scope))
        const handle = yield* Effect.promise(() => domain.startBackground(organizeInput()))
        yield* Deferred.await(g.entered)
        yield* Scope.close(scope, Exit.void)
        return { result: yield* Effect.promise(() => handle.done), handleID: handle.id }
      }),
    )
    expect(outcome.result).toEqual({ status: "cancelled" })
    expect(interrupts).toContain(outcome.handleID)
  })

  test("purpose 注册表 tombstone 保留到进程退出", () => {
    SessionPurpose.register("ses_tombstone", "tool-insight")
    expect(SessionPurpose.lookup("ses_tombstone")).toBe("tool-insight")
    expect(SessionPurpose.lookup("ses_never_registered")).toBeUndefined()
  })
})
