import type { Event as SDKEvent } from "@opennovel-ai/sdk/v2/types"
import type { Stream } from "effect"

export type EventMap = {
  [Item in SDKEvent as Item["type"]]: Item
}

/**
 * V2 插件面事件订阅。宿主侧把公开类型字符串解析为 schema Definition 并委托
 * EventV2.Service.subscribe（v2/effect PLAN.md §8 Event Adapter）。
 * 当前宿主解析表覆盖 session.next.* 全集；其余域事件（catalog/integration 等）
 * 订阅会收到 fail 流并带明确错误，按需扩展解析表。
 */
export interface Event {
  subscribe<Type extends keyof EventMap>(type: Type): Stream.Stream<EventMap[Type]>
}
