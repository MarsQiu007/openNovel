import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Queue, Schema, Stream } from "effect"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

// SSE 按帧（空行分隔）交付而非按 chunk：插件 boot 批的事件会同 tick 涌入并合并
// 进同一个 chunk，读取端必须自行缓冲分帧，不能假设一个 chunk 恰好是一个 event。
const readEvent = (reader: Queue.Dequeue<string>, type?: string) => {
  const decode = (frame: string) =>
    Schema.decodeUnknownSync(EventData)(JSON.parse(frame.replace(/^data: /, "")))
  const take = Queue.take(reader).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for event")),
    }),
  )
  if (type === undefined) return Effect.map(take, decode)
  return Effect.gen(function* () {
    while (true) {
      const event = decode(yield* take)
      if (event.type === type) return event
    }
  })
}

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(EventPaths.event, directory)
    const reader = yield* Queue.unbounded<string>()
    let buffer = ""
    yield* response.stream.pipe(
      Stream.map((value) => {
        buffer += new TextDecoder().decode(value)
        const frames = buffer.split("\n\n")
        buffer = frames.pop() ?? ""
        return frames
      }),
      Stream.flattenIterable,
      Stream.runForEach((frame) => Queue.offer(reader, frame)),
      Effect.forkScoped,
    )
    return { response, reader }
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain("text/event-stream")
        expect(response.headers["cache-control"]).toBe("no-cache, no-transform")
        expect(response.headers["x-accel-buffering"]).toBe("no")
        expect(response.headers["x-content-type-options"]).toBe("nosniff")
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps the event stream open after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        // If no second event arrives within 250ms, the stream is still open.
        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const created = yield* requestInDirectory("/api/session", directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // 显式声明 location，确保 create 落在本实例（缺省回退为请求解析的 location）
          body: JSON.stringify({ location: { directory } }),
        })
        expect(created.status).toBe(200)
        // 订阅可能落在插件 boot 批进行中，先收到的是 boot 事件，跳过直到目标事件
        expect(yield* readEvent(reader, "session.next.created")).toMatchObject({ type: "session.next.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
