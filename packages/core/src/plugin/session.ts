export * as PluginSession from "./session"

import { Cause, Deferred, Effect, Exit, Fiber, Option, Scope } from "effect"
import type { BackgroundSessionHandle, BackgroundSessionInput, BackgroundSessionResult, SessionDomain } from "@opennovel-ai/plugin/v2/effect"
import { AgentV2 } from "../agent"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionExecution } from "../session/execution"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionV2 } from "../session"
import { AbsolutePath } from "../schema"
import { ToolRegistry } from "../tool/registry"
import { SessionPurpose } from "./session-purpose"

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const sameToolSet = (actual: readonly string[], expected: readonly string[]): boolean => {
  if (actual.length !== expected.length) return false
  const left = [...actual].sort()
  const right = [...expected].sort()
  return left.every((name, index) => name === right[index])
}

/** 从 desc 消息列表提取最近一条含非空正文的 assistant 消息文本。 */
const finalText = (messages: ReadonlyArray<SessionMessage.Message>): string | undefined => {
  const last = messages.find((message) => message.type === "assistant")
  if (last?.type !== "assistant") return undefined
  const text = last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
  return text.length > 0 ? text : undefined
}

const resultFromExit = (exit: Exit.Exit<BackgroundSessionResult, unknown>): BackgroundSessionResult =>
  Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      if (Cause.hasInterruptsOnly(cause)) return { status: "cancelled" }
      const failure = Cause.findErrorOption(cause)
      if (Option.isSome(failure)) return { status: "failure", reason: describeError(failure.value) }
      return { status: "failure", reason: describeError(Cause.squash(cause)) }
    },
  })

/**
 * 插件面后台 Session 能力的 Core 宿主实现（settled + startBackground；get 由宿主持有）。
 *
 * settled 等待当前 drain 落定并确认观察点不再活动；pending wake 重启执行则继续等下一边界，
 * 只等待不注入不中断。startBackground 按预分配 ID + purpose 登记 → 目标 Location 预检 →
 * durable admission（resume: false）→ 宿主 resume → settled 观察点 → 剩余活动 interrupt →
 * 读取最终 assistant 文本的顺序驱动，三阶段取消分别落在等待创建、admission 后旗标检查与
 * 真实 execution.interrupt。整个生命周期 fiber fork 进宿主 scope，scope 关闭时经 finalizer
 * 逐个 cancel 存活 handle。
 */
export interface Deps {
  /** class 实例形状里的 Service 属性即方法接口（effect 4 class-style tag） */
  readonly sessions: SessionV2.Service["Service"]
  readonly execution: SessionExecution.Service["Service"]
  /**
   * 在目标 Location 的服务上下文里运行预检段：宿主经 LocationServiceMap.get(ref) 落地。
   * 以回调注入让本模块类型不引用 LocationServiceMap.Service——其类型内嵌整棵位置树
   * （含 PluginV2），反向引用会构成 TS 循环基类（同 SessionV2.node 注释所述形态）。
   */
  readonly withinLocation: <A>(
    ref: Location.Ref,
    precheck: Effect.Effect<A, Error, AgentV2.Service | ToolRegistry.Service>,
  ) => Effect.Effect<A, unknown>
}

export type Background = Pick<SessionDomain, "settled" | "startBackground">
/**
 * 从 LocationServiceMap 实例构造 withinLocation 回调。类型仅在参数位引用实例形状，
 * 不会进入宿主/插件的返回类型，环保持切断。断言说明：provide 的类型级残差依赖
 * Context 逆变的成员判定，这里运行时由 layer 真实提供两个服务，残差必为 never。
 */
export const withinLocationFrom = (locations: LocationServiceMap.Service["Service"]) => {
  const withinLocation = <A>(
    ref: Location.Ref,
    precheck: Effect.Effect<A, Error, AgentV2.Service | ToolRegistry.Service>,
  ): Effect.Effect<A, unknown> => Effect.provide(precheck, locations.get(ref)) as Effect.Effect<A, unknown>
  return withinLocation
}

export const make = (deps: Deps) =>
  Effect.gen(function* () {
    const sessions = deps.sessions
    const execution = deps.execution
    const withinLocation = deps.withinLocation
    const scope = yield* Scope.Scope

  const settledEffect = (id: string) =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make(id)
      while (true) {
        yield* sessions.wait(sessionID)
        const active = yield* execution.active
        if (!active.has(sessionID)) return
      }
    })

  // 跨 startBackground 调用共享的存活 handle 集合；finalizer 只 cancel 仍在运行的 handle
  const live = new Set<BackgroundSessionHandle>()

  const startBackground = (input: BackgroundSessionInput) =>
    Effect.gen(function* () {
      // create 前校验：模式约束与位置来源二选一，不满足直接拒绝且不派生任何资源
      if (input.mode === "organize" && input.expectedTools.length > 0)
        return yield* Effect.fail(new Error("后台 organize 会话的预期工具集合必须为空"))
      if (input.mode === "retest" && input.authorization === undefined)
        return yield* Effect.fail(new Error("后台 retest 会话缺少宿主执行授权"))
      if ((input.parentID === undefined) === (input.directory === undefined))
        return yield* Effect.fail(new Error("后台会话位置来源必须二选一：parentID 或 directory"))

      const sessionID = SessionSchema.ID.create()
      // create 之前登记 purpose（tombstone 到进程退出），堵住早发事件与晚消费事件之间的采集窗口
      SessionPurpose.register(sessionID, "tool-insight")

      const cancelled = yield* Deferred.make<void>()
      const done = yield* Deferred.make<BackgroundSessionResult>()

      const lifecycle = Effect.gen(function* () {
        if (input.parentID !== undefined) {
          // 等待父会话落定；等待期间取消则 fiber 在此中断，不再 create
          yield* settledEffect(input.parentID)
        }
        const info = yield* sessions
          .create({
            id: sessionID,
            ...(input.parentID !== undefined
              ? { parentID: SessionSchema.ID.make(input.parentID) }
              : { location: Location.Ref.make({ directory: AbsolutePath.make(input.directory as string) }) }),
            agent: AgentV2.ID.make(input.agent),
            ...(input.model === undefined
              ? {}
              : {
                  model: {
                    id: ModelV2.ID.make(input.model.modelID),
                    providerID: ProviderV2.ID.make(input.model.providerID),
                  },
                }),
          })
          .pipe(Effect.mapError((error) => new Error(`后台会话创建失败: ${describeError(error)}`)))

        // 目标 Location 预检：agent 存在，且实际工具集合与预期精确一致（organize 要求空集）
        const rejected = yield* withinLocation(
          info.location,
          Effect.gen(function* () {
            const agents = yield* AgentV2.Service
            const registry = yield* ToolRegistry.Service
            const selection = yield* agents.select(AgentV2.ID.make(input.agent))
            if (selection.info === undefined) return new Error(`后台会话 agent 不存在: ${input.agent}`)
            const materialization = yield* registry.materialize(selection.info.permissions)
            const actual = materialization.definitions.map((definition) => definition.name)
            if (!sameToolSet(actual, input.expectedTools))
              return new Error(`后台会话工具集合不匹配: 预期 [${input.expectedTools.join(", ")}]，实际 [${actual.join(", ")}]`)
            return undefined
          }),
        )
        if (rejected !== undefined) return yield* Effect.fail(rejected)

        // durable admission（resume: false 只落库，不调度执行）
        yield* sessions
          .prompt({
            id: SessionMessage.ID.create(),
            sessionID,
            prompt: { text: input.prompt },
            resume: false,
          })
          .pipe(Effect.mapError((error) => new Error(`后台会话 admission 失败: ${describeError(error)}`)))

        // 已 admission 尚未 resume：取消则不再发车（自中断走 interrupted exit → cancelled）
        if (yield* Deferred.isDone(cancelled)) return yield* Effect.interrupt

        // 宿主 resume 驱动真实 drain；执行错误不吞掉，落到 failure。取消与 drain 落定
        // 竞争时旗标优先：被 interrupt 的 drain 报错改判为 cancelled，取消语义确定
        yield* sessions
          .resume(sessionID)
          .pipe(
            Effect.mapError((error) => new Error(`后台会话执行失败: ${describeError(error)}`)),
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (yield* Deferred.isDone(cancelled)) return yield* Effect.interrupt
                return yield* Effect.fail(error)
              }),
            ),
          )

        // settled 观察点：pending wake 重启执行则继续等待下一边界
        yield* settledEffect(sessionID)

        // 剩余活动 interrupt，避免 pending wake 在结果落盘后继续执行
        yield* execution.interrupt(sessionID)

        const messages = yield* sessions
          .messages({ sessionID, order: "desc", limit: 50 })
          .pipe(Effect.mapError((error) => new Error(`后台会话结果读取失败: ${describeError(error)}`)))
        const text = finalText(messages)
        if (text === undefined) return yield* Effect.fail(new Error("后台会话未产出最终 assistant 文本"))
        return { status: "success", text } satisfies BackgroundSessionResult
      })

      // 失败/取消路径收尾：interrupt 残余活动（成功路径已显式 interrupt；idle/missing 均为 no-op）
      const fiber = yield* lifecycle.pipe(
        Effect.onError(() => execution.interrupt(sessionID)),
        Effect.onExit((exit) => Deferred.done(done, Exit.succeed(resultFromExit(exit)))),
        Effect.forkIn(scope),
      )

      const handle: BackgroundSessionHandle = {
        id: sessionID,
        done: Deferred.await(done).pipe(Effect.runPromise),
        cancel: () =>
          Effect.gen(function* () {
            // 三阶段取消的旗标：等待期中断不再 create，admission 后旗标检查不再发车
            yield* Deferred.succeed(cancelled, undefined)
            // 真实 interrupt 当前 drain；idle/missing no-op
            yield* execution.interrupt(sessionID)
            // 中断生命周期 fiber 的任一挂起点
            yield* Fiber.interrupt(fiber)
          }).pipe(Effect.runPromise),
      }
      live.add(handle)
      // 完成后从存活集合移除，finalizer 只 cancel 仍在运行的 handle
      yield* Deferred.await(done)
        .pipe(Effect.andThen(Effect.sync(() => live.delete(handle))), Effect.forkIn(scope))
      return handle
    })

  const domain: SessionDomain = {
    get: (id) =>
      Effect.runPromise(
        sessions.get(SessionSchema.ID.make(id)).pipe(
          Effect.map((info) => ({
            id: info.id,
            parentID: info.parentID,
            purpose: SessionPurpose.lookup(info.id),
          })),
          // 链读取语义：不存在的 Session 返回 undefined（视为链不可达），不抛错
          Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)),
        ),
      ),
    settled: (id) => Effect.runPromise(settledEffect(id)),
    startBackground: (input) => Effect.runPromise(startBackground(input)),
  }

  // scope 关闭（插件卸载、开关关闭、宿主销毁）时对每个存活 handle 执行真实 cancel
  yield* Scope.addFinalizer(
    scope,
    Effect.forEach(
      Array.from(live),
      (handle) => Effect.promise(() => handle.cancel()),
      { discard: true },
    ),
  )

  return domain
})

/**
 * 宿主运行栈未绑定 SessionV2（如仅装配 recording 层的测试环境）时的显式降级：
 * fail-closed，直接拒绝后台能力，绝不静默绕过 purpose 限制。get 由宿主以
 * SessionStore 兜底提供。
 */
export const unavailable = (): Background => ({
  settled: () => Promise.reject(new Error("插件宿主未绑定 SessionV2 运行栈：settled 不可用")),
  startBackground: () => Promise.reject(new Error("插件宿主未绑定 SessionV2 运行栈：startBackground 不可用")),
})
