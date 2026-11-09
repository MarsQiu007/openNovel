import type { Event as SDKEvent } from "@opennovel-ai/sdk/v2/types"
import type { Stream } from "effect"

export type EventMap = {
  [Item in SDKEvent as Item["type"]]: Item
}

/**
 * 宿主信封在公开事件形状外附加内部会话标记：purpose 来自进程级注册表，公开
 * SessionEvent Schema 不变。事件处理器在任何计数、Map 更新或报告触发前必须先
 * 排除带 purpose 的会话（早发与晚消费的尾部事件同样携带）。
 */
export type EventEnvelope<Type> = Type & { readonly purpose?: "tool-insight" }

/**
 * V2 插件面事件订阅。宿主侧把公开类型字符串解析为 schema Definition 并委托
 * EventV2.Service.subscribe（v2/effect PLAN.md §8 Event Adapter）。
 * 当前宿主解析表覆盖 session.next.* 全集；其余域事件（catalog/integration 等）
 * 订阅会收到 fail 流并带明确错误，按需扩展解析表。
 */
export interface Event {
  subscribe<Type extends keyof EventMap>(type: Type): Stream.Stream<EventEnvelope<EventMap[Type]>>
}
