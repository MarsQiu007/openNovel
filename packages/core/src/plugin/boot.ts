export * as PluginBoot from "./boot"

import { makeLocationNode } from "../effect/app-node"
import { Context, Deferred, Effect, Layer } from "effect"

export interface Interface {
  /** 等待插件引导放行。无引导方（最小测试/嵌入层图）时立即通过。 */
  readonly ready: Effect.Effect<void>
  /** 引导方（PluginInternal）在层构建期收窄 ready，直到 release 才放行。 */
  readonly arm: Effect.Effect<void>
  /** 引导方在引导提交完成（或失败落定）后放行所有等待方。幂等。 */
  readonly release: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/PluginBoot") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // 默认放行：latch 初始即 succeed，只有 PluginInternal 在场时才会 arm 收窄。
    let latch = yield* Deferred.make<void>()
    yield* Deferred.succeed(latch, undefined)
    return Service.of({
      ready: Effect.suspend(() => Deferred.await(latch)),
      arm: Effect.gen(function* () {
        latch = yield* Deferred.make<void>()
      }),
      release: Effect.suspend(() => Deferred.succeed(latch, undefined).pipe(Effect.asVoid)),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
