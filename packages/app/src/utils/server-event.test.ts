import { expect, test } from "bun:test"
import { normalizeEventTimestamp } from "./server-event"

type ServerEvent = { type: string; properties?: Record<string, unknown> }

test("把 SSE 的 ISO 时间戳转成毫秒", () => {
  const event: ServerEvent = {
    type: "session.next.reasoning.ended",
    properties: { timestamp: "2026-10-29T02:26:40.334Z", sessionID: "ses_1" },
  }
  expect(normalizeEventTimestamp(event)).toEqual({
    type: "session.next.reasoning.ended",
    properties: { timestamp: Date.parse("2026-10-29T02:26:40.334Z"), sessionID: "ses_1" },
  })
})

test("毫秒时间戳保持不变", () => {
  const event: ServerEvent = { type: "session.next.step.started", properties: { timestamp: 1793240287539 } }
  expect(normalizeEventTimestamp(event)).toBe(event)
})

test("没有 properties 或时间戳缺失时原样返回", () => {
  const bare: ServerEvent = { type: "server.connected" }
  expect(normalizeEventTimestamp(bare)).toBe(bare)
  const withoutTimestamp: ServerEvent = { type: "session.next.deleted", properties: { sessionID: "ses_1" } }
  expect(normalizeEventTimestamp(withoutTimestamp)).toBe(withoutTimestamp)
})

test("不能解析的字符串不转换", () => {
  const event: ServerEvent = { type: "session.next.deleted", properties: { timestamp: "not-a-date" } }
  expect(normalizeEventTimestamp(event)).toBe(event)
})

test("只归一化顶层时间戳，不改动嵌套字段", () => {
  const event: ServerEvent = {
    type: "x",
    properties: { timestamp: "2026-10-29T02:26:40.334Z", nested: { timestamp: "2026-10-29T02:26:41.000Z" } },
  }
  expect(normalizeEventTimestamp(event).properties).toEqual({
    timestamp: Date.parse("2026-10-29T02:26:40.334Z"),
    nested: { timestamp: "2026-10-29T02:26:41.000Z" },
  })
})
