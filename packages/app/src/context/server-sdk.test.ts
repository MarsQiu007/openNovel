import { describe, expect, test } from "bun:test"
import { coalesceServerEvents, enqueueServerEvent, resumeStreamAfterPageShow } from "./server-sdk"
import type { Event } from "@opennovel-ai/sdk/v2/client"

describe("resumeStreamAfterPageShow", () => {
  test("restarts a stream only after a back-forward cache restore", () => {
    let starts = 0
    const start = () => starts++

    resumeStreamAfterPageShow({ persisted: false } as PageTransitionEvent, start)
    resumeStreamAfterPageShow({ persisted: true } as PageTransitionEvent, start)

    expect(starts).toBe(1)
  })
})

describe("coalesceServerEvents", () => {
  const delta = (value: string, textID = "text") => ({
    directory: "/repo",
    payload: {
      id: "",
      type: "session.next.text.delta",
      properties: { timestamp: 0, sessionID: "session", assistantMessageID: "msg", textID, delta: value },
    } as Event,
  })

  const reasoning = (value: string) => ({
    directory: "/repo",
    payload: {
      id: "",
      type: "session.next.reasoning.delta",
      properties: { timestamp: 0, sessionID: "session", assistantMessageID: "msg", reasoningID: "reasoning", delta: value },
    } as Event,
  })

  test("merges adjacent deltas for the same part", () => {
    const first = delta("hello ")
    const second = delta("world")
    first.payload.id = "first"
    second.payload.id = "second"
    const result = coalesceServerEvents([first, second])

    expect(result).toHaveLength(1)
    expect(result[0]?.payload).toMatchObject({ id: "second", properties: { delta: "hello world" } })
  })

  test("preserves event boundaries and distinct delta streams", () => {
    const status = {
      directory: "/repo",
      payload: { type: "session.status", properties: { sessionID: "ses", status: { type: "idle" } } } as Event,
    }
    const result = coalesceServerEvents([delta("a"), reasoning("b"), status, delta("c")])

    expect(result.map((event) => event.payload.type)).toEqual([
      "session.next.text.delta",
      "session.next.reasoning.delta",
      "session.status",
      "session.next.text.delta",
    ])
  })

  test("preserves event ID order across interleaved deltas", () => {
    const first = delta("a")
    const other = delta("b", "other")
    const last = delta("c")
    first.payload.id = "1"
    other.payload.id = "2"
    last.payload.id = "3"

    const result = coalesceServerEvents([first, other, last])

    expect(result.map((event) => event.payload.id)).toEqual(["1", "2", "3"])
  })
})

describe("enqueueServerEvent", () => {
  const progress = (title: string) =>
    ({
      id: "",
      type: "session.next.tool.progress",
      properties: {
        timestamp: 0,
        sessionID: "session",
        assistantMessageID: "message",
        callID: "call",
        structured: { title },
        content: [],
      },
    }) as Event

  const textDelta = (value: string) =>
    ({
      id: "",
      type: "session.next.text.delta",
      properties: { timestamp: 0, sessionID: "session", assistantMessageID: "message", textID: "text", delta: value },
    }) as Event

  test("preserves progress snapshots across event barriers", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (payload: Event) => enqueueServerEvent(events, { directory: "/repo", payload })

    enqueue(progress("old"))
    enqueue(textDelta("x"))
    enqueue({
      type: "session.next.step.started",
      properties: {
        timestamp: 1,
        sessionID: "session",
        assistantMessageID: "message",
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    } as Event)
    enqueue(progress("new"))

    expect(events.map((event) => event.payload.type)).toEqual([
      "session.next.tool.progress",
      "session.next.text.delta",
      "session.next.step.started",
      "session.next.tool.progress",
    ])
  })

  test("preserves deltas after a replacement snapshot", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (payload: Event) => enqueueServerEvent(events, { directory: "/repo", payload })

    enqueue(progress("a"))
    enqueue(progress("ab"))
    enqueue(textDelta("c"))

    const result = coalesceServerEvents(events)
    expect(result.map((event) => event.payload.type)).toEqual(["session.next.tool.progress", "session.next.text.delta"])
    expect(result[0]?.payload).toMatchObject({ properties: { structured: { title: "ab" } } })
    expect(result[1]?.payload).toMatchObject({ properties: { delta: "c" } })
  })

  test("preserves updates after session deletion", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (payload: Event) => enqueueServerEvent(events, { directory: "/repo", payload })

    enqueue(progress("old"))
    enqueue({
      type: "session.next.deleted",
      properties: { timestamp: 1, sessionID: "session" },
    } as Event)
    enqueue(progress("new"))

    expect(events.map((event) => event.payload.type)).toEqual([
      "session.next.tool.progress",
      "session.next.deleted",
      "session.next.tool.progress",
    ])
  })

  test("does not coalesce edge-triggered session statuses", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (status: "retry" | "busy") =>
      enqueueServerEvent(events, {
        directory: "/repo",
        payload: {
          type: "session.status",
          properties: {
            sessionID: "session",
            status: status === "retry" ? { type: "retry", attempt: 1, message: "retry", next: 1 } : { type: "busy" },
          },
        } as Event,
      })

    enqueue("retry")
    enqueue("busy")

    expect(events).toHaveLength(2)
  })
})
