// EventV2 → GlobalBus 桥（原 event-v2-bridge 监听方向的 re-home）：
// /global/event SSE 与 control-plane 的 waitUntilSynced 都经 GlobalBus 收
// 普通信封与 sync 信封（workspace sync 传输承重墙），因此桥挂在服务图里
// 而非请求处理器内。监听器在发布方 fiber 里执行，InstanceRef/WorkspaceRef
// 兜底保留原桥接语义。发布方向的位置附加见 effect/publish.ts。
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opennovel-ai/core/event"
import { Effect, Layer } from "effect"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        const workspaceID = (yield* WorkspaceRef) ?? event.location?.workspaceID
        const routed = { directory: event.location?.directory ?? ctx?.directory, workspace: workspaceID }
        GlobalBus.emit("event", {
          ...routed,
          payload: { id: event.id, type: event.type, properties: event.data },
        })
        if (event.durable === undefined) return
        GlobalBus.emit("event", {
          ...routed,
          payload: {
            type: "sync",
            syncEvent: {
              id: event.id,
              type: EventV2.versionedType(event.type, event.durable.version),
              seq: event.durable.seq,
              aggregateID: event.durable.aggregateID,
              data: event.data,
            },
          },
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
  }),
)

export const node = LayerNode.make({ name: "@opennovel/GlobalEventBridge", layer, deps: [EventV2.node] })

export * as GlobalEventBridge from "./global-event-bridge"
