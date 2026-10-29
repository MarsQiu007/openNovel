// V2 SSE 事件把 DateTime 编码为 ISO 字符串，而 REST 投影与持久化用毫秒数。
// app 状态（part.time、session.time、重试时刻）统一按毫秒处理，故入队前归一化顶层 timestamp。
// 只转换能解析的字符串；数字、缺失字段和其他形状原样返回。
export function normalizeEventTimestamp<T extends { properties?: unknown }>(payload: T): T {
  const properties = payload.properties
  if (!properties || typeof properties !== "object") return payload
  const timestamp = (properties as { timestamp?: unknown }).timestamp
  if (typeof timestamp !== "string") return payload
  const millis = Date.parse(timestamp)
  if (Number.isNaN(millis)) return payload
  return { ...payload, properties: { ...properties, timestamp: millis } }
}
