// V2 化（perf-benchmark-v2，design D6）：V1 路径/配置键（messageDelay、beforeMessagesResponse、
// onMessages、pageMessages）已随 V2 mock 重写删除；本用例改验 V2 门闩语义——
// beforeV2MessagesResponse 闸门持有期间响应不出，释放后按
// onV2Messages(start) → beforeV2MessagesResponse → v2Messages → onV2Messages(end) → fulfill 序完成；
// 延迟不再内建（无 messageDelay 键），由闸门回调内自睡实现。
import { expect, test } from "bun:test"
import type { Page, Route } from "@playwright/test"
import { mockOpenNovelServer } from "../../utils/mock-server"

test("applies message latency after a list response gate is released", async () => {
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    // mockOpenNovelServer 会用 addInitScript 固定配色方案，假 page 需同步该契约
    addInitScript: () => Promise.resolve(),
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockOpenNovelServer(page, {
    provider: {},
    directory: "C:/OpenNovel",
    project: {},
    sessions: [{ id: "session" }],
    beforeV2MessagesResponse: async () => {
      events.push("before")
      await gate.promise
      await new Promise((resolve) => setTimeout(resolve, 25))
    },
    onV2Messages: (request) => events.push(request.phase),
    v2Messages: () => {
      events.push("page")
      return []
    },
  })

  const response = handler!({
    request: () => ({ url: () => "http://127.0.0.1:4096/api/session/session/message", method: () => "GET" }),
    fulfill: () => {
      events.push("fulfill")
      return Promise.resolve()
    },
  } as unknown as Route)
  expect(events).toEqual(["start", "before"])

  const released = performance.now()
  gate.resolve()
  await response
  expect(performance.now() - released).toBeGreaterThanOrEqual(20)
  expect(events).toEqual(["start", "before", "page", "end", "fulfill"])
})
