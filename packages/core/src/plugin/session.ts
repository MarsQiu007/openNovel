export * as PluginSession from "./session"

import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Scope } from "effect"
import type {
  BackgroundRetestAgent,
  BackgroundSessionHandle,
  BackgroundSessionInput,
  BackgroundSessionResult,
  SessionDomain,
} from "@opennovel-ai/plugin/v2/effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { ModelV2 } from "../model"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"
import { SessionExecution } from "../session/execution"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionRunnerModel } from "../session/runner/model"
import { SessionV2 } from "../session"
import { AbsolutePath } from "../schema"
import { ToolRegistry } from "../tool/registry"
import { RetestAuthorization } from "./retest-authorization"
import { SessionPurpose } from "./session-purpose"

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** 复测前置插件激活的有界期限：事件驱动等待（PluginV2.wait），超时即失败关闭，无固定 sleep */
const RETEST_PLUGIN_WAIT_TIMEOUT = "15 seconds"

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
  /** 请求插件身份（per-plugin 宿主视图注入）：retest 授权首次消费时绑定，跨插件复用拒绝 */
  readonly pluginID: string
  /**
   * 在目标 Location 的服务上下文里运行预检段：宿主经 LocationServiceMap.get(ref) 落地。
   * 以回调注入让本模块类型不引用 LocationServiceMap.Service——其类型内嵌整棵位置树
   * （含 PluginV2），反向引用会构成 TS 循环基类（同 SessionV2.node 注释所述形态）。
   * retest 的前置插件等待需要临时 Location 自己的 PluginV2 实例，因此预检段的
   * Requirements 含 PluginV2.Service（未传 requiredPlugins 时不会真正 yield）。
   */
  /**
   * 复测前置插件激活的有界期限：默认 15 秒；测试注入短时限以覆盖超时路径，
   * 而不真实等待 15 秒。
   */
  readonly retestPluginWaitTimeout?: Duration.Input
  readonly withinLocation: <A>(
    ref: Location.Ref,
    precheck: Effect.Effect<A, Error, AgentV2.Service | ToolRegistry.Service | Catalog.Service | PluginV2.Service>,
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
    precheck: Effect.Effect<A, Error, AgentV2.Service | ToolRegistry.Service | Catalog.Service | PluginV2.Service>,
  ): Effect.Effect<A, unknown> => Effect.provide(precheck, locations.get(ref)) as Effect.Effect<A, unknown>
  return withinLocation
}

export const make = (deps: Deps) =>
  Effect.gen(function* () {
    const sessions = deps.sessions
    const execution = deps.execution
    const withinLocation = deps.withinLocation
    const pluginID = deps.pluginID
    const pluginWaitTimeout = deps.retestPluginWaitTimeout ?? RETEST_PLUGIN_WAIT_TIMEOUT
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
      if (input.mode === "retest") {
        if (input.authorization === undefined) return yield* Effect.fail(new Error("后台 retest 会话缺少宿主执行授权"))
        if (input.originSessionID === undefined) return yield* Effect.fail(new Error("后台 retest 会话缺少发起确认的原会话"))
        if (input.model === undefined) return yield* Effect.fail(new Error("后台 retest 会话缺少案例绑定的模型"))
        // 按运行次数消费授权：绑定（原会话/案例摘要/模型/白名单/请求插件）任一不符即拒绝，
        // 拒绝发生在预分配与 purpose 登记之前，不派生任何资源
        const consumed = RetestAuthorization.consume({
          id: input.authorization.id,
          pluginID,
          sessionID: input.originSessionID,
          caseDigest: input.authorization.caseDigest,
          model: input.model,
          expectedTools: input.expectedTools,
        })
        if (!consumed.ok) return yield* Effect.fail(new Error(`后台 retest 授权校验失败: ${consumed.reason}`))
      }
      if ((input.parentID === undefined) === (input.directory === undefined))
        return yield* Effect.fail(new Error("后台会话位置来源必须二选一：parentID 或 directory"))
      // 目录来源分支必须携带显式隔离目录：同一表达式内完成收窄，缺失即失败关闭
      const directoryRef =
        input.parentID === undefined && input.directory !== undefined
          ? Location.Ref.make({ directory: AbsolutePath.make(input.directory) })
          : undefined
      if (input.parentID === undefined && directoryRef === undefined)
        return yield* Effect.fail(new Error("后台会话缺少隔离目录"))

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

        // 目标 Location 规范 ref：父会话取其已持久化 location，目录来源显式构造
        const targetRef =
          input.parentID !== undefined
            ? yield* sessions.get(SessionSchema.ID.make(input.parentID)).pipe(
                Effect.mapError((error) => new Error(`父会话不可达: ${describeError(error)}`)),
                Effect.flatMap((info) =>
                  info === undefined
                    ? Effect.fail(new Error(`父会话不存在: ${input.parentID}`))
                    : Effect.succeed(info.location),
                ),
              )
            : directoryRef ?? (yield* Effect.fail(new Error("后台会话缺少隔离目录")))

        // retest 隔离作用域准备（任务 5.3/5.4）：先逐个有界等待 config 声明的前置插件
        // 在临时 Location 激活（PluginV2.wait 事件驱动，无固定 sleep；插件装载失败或
        // 超时均失败关闭），再由宿主在临时 Location 代持注册唯一 deny-first 复测 agent
        // ——插件 ctx 只见自身 Location 视图，无法跨 Location transform。deny-first
        // 权限按本次授权白名单构造：先全量 deny，再逐项 allow；materialize 后的工具
        // 集合由下方预检断言精确等于授权集合，权限不固化在 agent 身份上。
        // State.transform 是作用域化注册（关闭作用域即移除并重载）：注册挂到本运行
        // 独立的 registrationScope 上，避免 withinLocation 的层作用域随调用结束把
        // 注册回收；收尾经 Scope.close 执行 finalizer 完成清理。
        const registrationScope = yield* Scope.make()
        const prepareRetestScope = (spec: BackgroundRetestAgent) =>
          withinLocation(
            targetRef,
            Effect.gen(function* () {
              if (input.requiredPlugins !== undefined && input.requiredPlugins.length > 0) {
                const plugins = yield* PluginV2.Service
                for (const id of input.requiredPlugins) {
                  yield* plugins.wait(PluginV2.ID.make(id)).pipe(
                    Effect.timeout(pluginWaitTimeout),
                    Effect.mapError((error) => new Error(`复测前置插件未激活: ${id}（${describeError(error)}）`)),
                  )
                }
              }
              const agents = yield* AgentV2.Service
              yield* agents
                .transform((editor) =>
                  editor.update(AgentV2.ID.make(spec.id), (agent) => {
                    agent.mode = "subagent"
                    agent.hidden = true
                    agent.description = spec.description
                    agent.system = spec.system
                    agent.permissions = [
                      { action: "*", resource: "*", effect: "deny" },
                      ...input.expectedTools.map((name) => ({ action: name, resource: "*", effect: "allow" as const })),
                    ]
                  }),
                )
                .pipe(Effect.provideService(Scope.Scope, registrationScope))
            }),
          )

        // 作用域收尾：close 执行注册 finalizer（移除 transform 并重载），未注册时为 no-op；
        // 清理失败不影响主退出
        const cleanupRetestScope = () =>
          Effect.promise(() => Effect.runPromise(Scope.close(registrationScope, Exit.void)).catch(() => undefined))

        const rest = Effect.gen(function* () {
        // 模型固定语义：organize 在发车前解析并固定（agent 提示优先，其次目录默认），
        // 固定值必须精确存在于目录可用集且受支持才放行；无已配置模型或解析失败一律
        // 失败关闭，不隐式改用其他模型。解析下沉到目标 Location 目录作用域完成，
        // 不依赖会话运行栈——后台能力缺失时 organize 仍可整理，retest 仍被授权拒绝
        let fixedModel = input.model
        if (input.mode === "organize" && fixedModel === undefined) {
          const resolved = yield* withinLocation(
            targetRef,
            Effect.gen(function* () {
              const agents = yield* AgentV2.Service
              const catalog = yield* Catalog.Service
              const hint = (yield* agents.select(AgentV2.ID.make(input.agent))).info?.model
              const fallback = hint ?? (yield* catalog.model.default())
              if (fallback === undefined) return undefined
              const available = yield* catalog.model.available()
              const matched = available.find((model) => model.providerID === fallback.providerID && model.id === fallback.id)
              if (matched === undefined || !SessionRunnerModel.supported(matched)) return undefined
              return { providerID: fallback.providerID, modelID: fallback.id }
            }),
          )
          if (resolved === undefined)
            return yield* Effect.fail(new Error("无已配置模型：后台整理保留 pending，不隐式改用其他模型"))
          fixedModel = resolved
        }
        // create 前在目标 Location 上下文完成预检：agent 存在、实际工具集合与
        // 预期精确一致（organize 要求空集）、模型可用性终检。任何拒绝都发生在
        // create 之前，不派生 Session 资源
        const rejected = yield* withinLocation(
          targetRef,
          Effect.gen(function* () {
            const agents = yield* AgentV2.Service
            const registry = yield* ToolRegistry.Service
            const catalog = yield* Catalog.Service
            const selection = yield* agents.select(AgentV2.ID.make(input.agent))
            if (selection.info === undefined) return new Error(`后台会话 agent 不存在: ${input.agent}`)
            const materialization = yield* registry.materialize(selection.info.permissions)
            const actual = materialization.definitions.map((definition) => definition.name)
            if (!sameToolSet(actual, input.expectedTools))
              return new Error(`后台会话工具集合不匹配: 预期 [${input.expectedTools.join(", ")}]，实际 [${actual.join(", ")}]`)
            if (fixedModel !== undefined) {
              const available = yield* catalog.model.available()
              const matched = available.find(
                (model) => model.providerID === fixedModel?.providerID && model.id === fixedModel?.modelID,
              )
              if (matched === undefined || !SessionRunnerModel.supported(matched))
                return new Error(`发车前模型解析与固定值不一致: ${fixedModel.providerID}/${fixedModel.modelID} 不再可用，拒绝发车`)
            }
            return undefined
          }),
        )
        if (rejected !== undefined) return yield* Effect.fail(rejected)

        yield* sessions
          .create({
            id: sessionID,
            ...(input.parentID !== undefined
              ? { parentID: SessionSchema.ID.make(input.parentID) }
              : { location: directoryRef ?? (yield* Effect.fail(new Error("后台会话缺少隔离目录"))) }),
            agent: AgentV2.ID.make(input.agent),
            ...(fixedModel === undefined
              ? {}
              : {
                  model: {
                    id: ModelV2.ID.make(fixedModel.modelID),
                    providerID: ProviderV2.ID.make(fixedModel.providerID),
                  },
                }),
          })
          .pipe(Effect.mapError((error) => new Error(`后台会话创建失败: ${describeError(error)}`)))

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

        // retest：先准备隔离作用域（等待插件激活 + 代持注册），预检通过才发车；
        // onExit 覆盖成功/失败/取消路径的代持注册清理
        const retestSpec = input.retestAgent
        if (input.mode !== "retest" || retestSpec === undefined) return yield* rest
        return yield* prepareRetestScope(retestSpec).pipe(
          Effect.flatMap(() => rest),
          Effect.onExit(() => cleanupRetestScope()),
        )
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
            // 规范 stored.location：复测隔离核验据此定位原书做前后摘要比对
            location: info.location.directory,
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
 * 宿主运行栈未绑定（如仅装配 recording 层的测试环境，或服务端组合根未把
 * SessionExecution 送达插件层）时的显式降级：fail-closed，直接拒绝后台能力，
 * 绝不静默绕过 purpose 限制。缺失服务的判定由调用方（PluginV2 层/host）给出并
 * 拼进 reason——「未绑定 SessionV2 运行栈」是既有断言的稳定锚点，不得破坏。
 * get 由宿主以 SessionStore 兜底提供。
 */
export const unavailable = (missing?: string): Background => {
  const reason = missing === undefined ? "插件宿主未绑定 SessionV2 运行栈" : `插件宿主未绑定 SessionV2 运行栈（缺 ${missing}）`
  return {
    settled: () => Promise.reject(new Error(`${reason}：settled 不可用`)),
    startBackground: () => Promise.reject(new Error(`${reason}：startBackground 不可用`)),
  }
}
