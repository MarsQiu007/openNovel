export * as PluginV2 from "./plugin"

import { Node, makeLocationNode } from "./effect/app-node"
import { Context, Deferred, Effect, Exit, Layer, Option, Scope } from "effect"
import type { Plugin as PluginRuntime } from "@opennovel-ai/plugin/v2/effect"
import { Plugin } from "@opennovel-ai/schema/plugin"
import { AgentV2 } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
import { EventV2 } from "./event"
import { Global } from "./global"
import { Integration } from "./integration"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { LocationServiceMap } from "./location-service-map"
import { PermissionV2 } from "./permission"
import { PluginHost } from "./plugin/host"
import { Reference } from "./reference"
import { PluginSession } from "./plugin/session"
import { SessionExecution } from "./session/execution"
import { SessionStore } from "./session/store"
import { SessionV2 } from "./session"
import { SkillV2 } from "./skill"
import { State } from "./state"
import { SystemContextRegistry } from "./system-context/registry"
import { ToolRegistry } from "./tool/registry"

export const ID = Plugin.ID
export type ID = typeof ID.Type
export const Event = Plugin.Event

export interface Interface {
  readonly add: (id: ID, effect: PluginRuntime["effect"]) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
  readonly wait: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/Plugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const locks = KeyedMutex.makeUnsafe<ID>()
    const scope = yield* Scope.make()
    // SessionV2 运行栈惰性绑定（与 host 同策略）：生产可用，测试环境缺绑定时 per-plugin
    // 视图退化为 host.session（fail-closed 拒绝后台能力）
    const sessionV2 = yield* Effect.serviceOption(SessionV2.Service)
    const execution = yield* Effect.serviceOption(SessionExecution.Service)
    const locations = yield* Effect.serviceOption(LocationServiceMap.Service)
    const active = new Map<ID, Scope.Closeable>()
    const loading = new Set<ID>()
    const waiters = new Map<ID, Set<Deferred.Deferred<void>>>()
    const failures = new Map<ID, Exit.Exit<void, never>>()
    let host: Parameters<PluginRuntime["effect"]>[0]

    const add = Effect.fn("Plugin.add")(function* (id: ID, effect: PluginRuntime["effect"]) {
      if (loading.has(id)) return yield* Effect.die(`Plugin load cycle detected for ${id}`)

      yield* locks.withLock(id)(
        Effect.sync(() => {
          loading.add(id)
          failures.delete(id)
        }).pipe(
          Effect.andThen(
            State.batch(
              Effect.gen(function* () {
                const existing = active.get(id)
                active.delete(id)
                if (existing) yield* Scope.close(existing, Exit.void).pipe(Effect.ignore)

                const child = yield* Scope.fork(scope)
                // per-plugin Session 域视图：生命周期 fiber 与存活 handle 都挂在 child scope 上，
                // 卸载/重载/关闭开关时经 finalizer 真实 cancel（含 execution.interrupt）。
                // pluginID 注入 retest 授权消费：首次消费绑定请求插件，跨插件复用拒绝
                const sessionView =
                  Option.isSome(sessionV2) && Option.isSome(execution) && Option.isSome(locations)
                    ? yield* PluginSession.make({
                        sessions: sessionV2.value,
                        execution: execution.value,
                        pluginID: id as string,
                        withinLocation: PluginSession.withinLocationFrom(locations.value),
                      }).pipe(Effect.provideService(Scope.Scope, child))
                    : undefined
                const pluginHost: Parameters<PluginRuntime["effect"]>[0] = {
                  ...host,
                  // 完整视图整体替换（get 含 purpose 回填）；降级时沿用宿主 SessionStore 兜底
                  session: sessionView ?? host.session,
                }
                yield* effect(pluginHost).pipe(
                  Scope.provide(child),
                  Effect.withSpan("Plugin.load", { attributes: { "plugin.id": id } }),
                  Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
                )
                yield* events.publish(Event.Added, { id })
                active.set(id, child)
                yield* Effect.forEach(waiters.get(id) ?? [], (waiter) => Deferred.succeed(waiter, undefined), {
                  discard: true,
                })
                waiters.delete(id)
              }),
            ),
          ),
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            failures.set(id, exit)
            return Effect.forEach(waiters.get(id) ?? [], (waiter) => Deferred.done(waiter, exit), {
              discard: true,
            }).pipe(Effect.ensuring(Effect.sync(() => waiters.delete(id))))
          }),
          Effect.ensuring(Effect.sync(() => loading.delete(id))),
        ),
      )
    })

    const remove = Effect.fn("Plugin.remove")(function* (id: ID) {
      if (loading.has(id)) return yield* Effect.die(`Cannot remove plugin ${id} while it is loading`)

      yield* locks.withLock(id)(
        State.batch(
          Effect.gen(function* () {
            const current = active.get(id)
            active.delete(id)
            failures.delete(id)
            if (current) yield* Scope.close(current, Exit.void).pipe(Effect.ignore)
          }),
        ),
      )
    })

    const wait = Effect.fn("Plugin.wait")(function* (id: ID) {
      const waiter = yield* Deferred.make<void>()
      const pending = yield* locks.withLock(id)(
        Effect.sync(() => {
          if (active.has(id)) return false
          const failure = failures.get(id)
          if (failure) return failure
          const current = waiters.get(id) ?? new Set()
          current.add(waiter)
          waiters.set(id, current)
          return true
        }),
      )
      if (!pending) return
      if (typeof pending !== "boolean") return yield* pending
      yield* Deferred.await(waiter).pipe(
        Effect.ensuring(
          locks.withLock(id)(
            Effect.sync(() => {
              const current = waiters.get(id)
              current?.delete(waiter)
              if (current?.size === 0) waiters.delete(id)
            }),
          ),
        ),
      )
    })

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        active.clear()
        yield* State.batch(Scope.close(scope, exit))
      }),
    )

    const service = Service.of({
      add,
      remove,
      wait,
    })
    host = yield* PluginHost.make(service)
    return service
  }),
)

export const locationLayer = layer.pipe(
  Layer.provideMerge(AgentV2.locationLayer),
  Layer.provideMerge(AISDK.locationLayer),
  Layer.provideMerge(Catalog.locationLayer),
  Layer.provideMerge(CommandV2.locationLayer),
  Layer.provideMerge(Integration.locationLayer),
  Layer.provideMerge(Reference.locationLayer),
)

// 显式注解读窄 node 静态类型（同 SessionV2.node 先例）：宿主 Session 域经 withinLocation
// 回调引用 LocationServiceMap，其类型内嵌整棵位置树（含本 node）。注解让位置树别名在
// 引用本 node 的循环点直接采用本类型，不再重入 layer 初始化式推导；运行时图不受影响。
export const node: Node.LocationNode<Service> = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Global.node,
    Integration.node,
    Location.node,
    PermissionV2.node,
    Reference.node,
    SessionStore.node,
    SkillV2.node,
    SystemContextRegistry.node,
    ToolRegistry.toolsNode,
  ],
})
