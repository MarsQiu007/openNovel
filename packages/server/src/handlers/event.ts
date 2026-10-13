import { EventV2 } from "@opennovel-ai/core/event"
import { OpenNovelEvent } from "@opennovel-ai/protocol/groups/event"
import { Effect, Option, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"

const subscriberCapacity = 256

function eventType(data: unknown) {
  if (typeof data !== "object" || data === null || !("type" in data)) return "unknown"
  return String(data.type)
}

// EventV2.all() 承载全量事件，桥接层会带入 protocol 未定义的类型（TUI/MCP/VCS/LSP 等）。
// 契约外的事件跳过并记日志，不能让编码错误炸掉整条 SSE 流。
function eventData(data: unknown): Effect.Effect<Sse.Event | undefined> {
  const encoded = Schema.encodeUnknownOption(OpenNovelEvent)(data)
  if (Option.isNone(encoded))
    return Effect.logWarning("skipping event outside the server event schema", { type: eventType(data) }).pipe(
      Effect.as(undefined),
    )
  return Effect.succeed({
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(encoded.value),
  })
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          data: {},
        }
        const output = Stream.unwrap(
          Effect.gen(function* () {
            // Acquiring the bounded stream installs its listener before readiness is observable.
            const live = yield* EventV2.allBounded(events, subscriberCapacity)
            return Stream.make(connected).pipe(Stream.concat(live))
          }),
        ).pipe(
          Stream.mapEffect(eventData),
          Stream.filter((event): event is Sse.Event => event !== undefined),
          Stream.pipeThroughChannel(Sse.encode()),
        )
        const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
        return HttpServerResponse.stream(
          output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          },
        )
      }),
    )
  }),
)
