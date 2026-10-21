import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@opennovel-ai/core/background-job"
import { KV } from "@opennovel-ai/core/kv"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer } from "effect"

export {
  Service,
  type ExtendInput,
  type Info,
  type Interface,
  type StartInput,
  type Status,
  type WaitInput,
  type WaitResult,
} from "@opennovel-ai/core/background-job"

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
const layer = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const state = yield* InstanceState.make(() =>
      CoreBackgroundJob.make.pipe(Effect.provide(Layer.succeed(KV.Service, kv))),
    )
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      extend: (input) => InstanceState.useEffect(state, (jobs) => jobs.extend(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
      block: (input) => InstanceState.useEffect(state, (jobs) => jobs.block(input)),
      background: (id) => InstanceState.useEffect(state, (jobs) => jobs.background(id)),
      backgroundAll: (input) => InstanceState.useEffect(state, (jobs) => jobs.backgroundAll(input)),
      pendingBackground: InstanceState.useEffect(state, (jobs) => jobs.pendingBackground),
      runningBackground: InstanceState.useEffect(state, (jobs) => jobs.runningBackground),
      completeBackground: (notificationID) => InstanceState.useEffect(state, (jobs) => jobs.completeBackground(notificationID)),
    })
  }),
)

export const node = LayerNode.make({ service: CoreBackgroundJob.Service, layer, deps: [KV.node] })

export * as BackgroundJob from "./job"
