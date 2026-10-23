// 事件发布的位置附加：EventV2.publish 原生仅从 Location.Service 取位置，
// 跑在 opennovel 实例上下文（InstanceRef/WorkspaceRef）里的发布方经此助手补全
// directory/workspaceID——/api/event 的 location 过滤、plugin 事件钩子与
// /global/event 的 workspace sync 传输都依赖这两个字段。
import { Effect } from "effect"
import { EventV2 } from "@opennovel-ai/core/event"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"

export function publishRouted<D extends EventV2.Definition>(
  events: EventV2.Interface,
  definition: D,
  data: EventV2.Data<D>,
  options?: EventV2.PublishOptions,
) {
  return Effect.gen(function* () {
    if (options?.location) return yield* events.publish(definition, data, options)
    const ctx = yield* InstanceRef
    if (!ctx) return yield* events.publish(definition, data, options)
    const workspaceID = yield* WorkspaceRef
    return yield* events.publish(definition, data, {
      ...options,
      location: {
        directory: AbsolutePath.make(ctx.directory),
        ...(workspaceID ? { workspaceID } : {}),
      },
    })
  })
}
