import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@opennovel-ai/sdk/v2/client"
import { createV2Translator } from "./v2-translator"
import type { TranslatorContext } from "./v2-translator"

const ev = (type: string, properties: Record<string, unknown>) =>
  ({ id: "evt", type, properties }) as unknown as GlobalEvent["payload"]

const ctx: TranslatorContext = {
  agent: "director",
  model: { providerID: "anthropic", modelID: "claude-sonnet-5-5" },
  directory: "/repo",
}

const make = (context?: (sessionID: string) => TranslatorContext | undefined) =>
  createV2Translator({ context: context ?? (() => ctx) })

const prompted = (messageID = "msg_u1", sessionID = "ses_1") =>
  ev("session.next.prompted", {
    timestamp: 100,
    sessionID,
    messageID,
    prompt: { text: "write chapter" },
    delivery: "steer",
  })

const stepStarted = (assistantMessageID = "msg_a1", sessionID = "ses_1") =>
  ev("session.next.step.started", {
    timestamp: 110,
    sessionID,
    assistantMessageID,
    agent: "director",
    model: { id: "claude-sonnet-5-5", providerID: "anthropic", variant: "max" },
  })

describe("prompted", () => {
  test("emits user message and parts", () => {
    const translator = make()
    const out = translator.translate(
      ev("session.next.prompted", {
        timestamp: 100,
        sessionID: "ses_1",
        messageID: "msg_u1",
        prompt: {
          text: "hi",
          files: [{ uri: "file:///repo/a.md", mime: "text/plain" }],
          agents: [{ name: "writer" }],
        },
        delivery: "steer",
      }),
    )
    expect(out[0]).toMatchObject({
      type: "message.updated",
      properties: {
        sessionID: "ses_1",
        info: { id: "msg_u1", role: "user", agent: "director", time: { created: 100 } },
      },
    })
    const parts = out.slice(1).map((item) => (item.type === "message.part.updated" ? item.properties.part : null))
    expect(parts.map((part) => part?.type)).toEqual(["text", "file", "agent"])
  })

  test("step.started parents to the prompted user message", () => {
    const translator = make()
    translator.translate(prompted())
    const out = translator.translate(stepStarted())
    expect(out[0]).toMatchObject({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_a1",
          role: "assistant",
          parentID: "msg_u1",
          agent: "director",
          modelID: "claude-sonnet-5-5",
          providerID: "anthropic",
          variant: "max",
          mode: "director",
          path: { cwd: "/repo", root: "/repo" },
          time: { created: 110 },
        },
      },
    })
  })

  test("step.started falls back to context lastUserID", () => {
    const translator = make(() => ({ ...ctx, lastUserID: "msg_prev" }))
    const out = translator.translate(stepStarted())
    if (out[0]?.type !== "message.updated" || out[0].properties.info.role !== "assistant") {
      throw new Error("expected assistant message")
    }
    expect(out[0].properties.info.parentID).toBe("msg_prev")
  })
})

describe("text and reasoning parts", () => {
  test("text lifecycle emits started placeholder, delta, and full text", () => {
    const translator = make()
    translator.translate(stepStarted())
    const started = translator.translate(
      ev("session.next.text.started", {
        timestamp: 111,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        textID: "prt_t1",
      }),
    )
    expect(started[0]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { id: "prt_t1", type: "text", text: "" }, time: 111 },
    })

    const delta = translator.translate(
      ev("session.next.text.delta", {
        timestamp: 112,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        textID: "prt_t1",
        delta: "chunk",
      }),
    )
    expect(delta[0]).toEqual({
      type: "message.part.delta",
      properties: { sessionID: "ses_1", messageID: "msg_a1", partID: "prt_t1", field: "text", delta: "chunk" },
    })

    const ended = translator.translate(
      ev("session.next.text.ended", {
        timestamp: 113,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        textID: "prt_t1",
        text: "full",
      }),
    )
    expect(ended[0]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { id: "prt_t1", type: "text", text: "full" } },
    })
  })

  test("reasoning carries start time from started to ended", () => {
    const translator = make()
    translator.translate(stepStarted())
    translator.translate(
      ev("session.next.reasoning.started", {
        timestamp: 111,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        reasoningID: "prt_r1",
      }),
    )
    const ended = translator.translate(
      ev("session.next.reasoning.ended", {
        timestamp: 115,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        reasoningID: "prt_r1",
        text: "thinking",
      }),
    )
    expect(ended[0]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { id: "prt_r1", type: "reasoning", text: "thinking", time: { start: 111, end: 115 } } },
    })
  })
})

describe("tool calls", () => {
  const called = () =>
    ev("session.next.tool.called", {
      timestamp: 120,
      sessionID: "ses_1",
      assistantMessageID: "msg_a1",
      callID: "prt_c1",
      tool: "bash",
      input: { cmd: "ls" },
      provider: { executed: false },
    })

  test("called then success produces completed state with carried input and start", () => {
    const translator = make()
    translator.translate(stepStarted())
    const running = translator.translate(called())
    expect(running[0]).toMatchObject({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_c1",
          type: "tool",
          callID: "prt_c1",
          tool: "bash",
          state: { status: "running", input: { cmd: "ls" }, time: { start: 120 } },
        },
      },
    })

    const done = translator.translate(
      ev("session.next.tool.success", {
        timestamp: 125,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        callID: "prt_c1",
        structured: { title: "List" },
        content: [{ type: "text", text: "ok" }],
        provider: { executed: false },
      }),
    )
    expect(done[0]).toMatchObject({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          state: {
            status: "completed",
            input: { cmd: "ls" },
            output: "ok",
            title: "List",
            metadata: { title: "List" },
            time: { start: 120, end: 125 },
          },
        },
      },
    })
  })

  test("failed maps the error message", () => {
    const translator = make()
    translator.translate(stepStarted())
    translator.translate(called())
    const out = translator.translate(
      ev("session.next.tool.failed", {
        timestamp: 126,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        callID: "prt_c1",
        error: { type: "unknown", message: "boom" },
        provider: { executed: false },
      }),
    )
    expect(out[0]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { state: { status: "error", error: "boom", time: { start: 120, end: 126 } } } },
    })
  })

  test("input streaming events are ignored", () => {
    const translator = make()
    expect(
      translator.translate(
        ev("session.next.tool.input.delta", {
          timestamp: 1,
          sessionID: "ses_1",
          assistantMessageID: "msg_a1",
          callID: "prt_c1",
          delta: "{",
        }),
      ),
    ).toEqual([])
  })
})

describe("step settlement", () => {
  test("step.ended settles cost, tokens, finish and completion time", () => {
    const translator = make()
    translator.translate(stepStarted())
    const out = translator.translate(
      ev("session.next.step.ended", {
        timestamp: 130,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        finish: "stop",
        cost: 0.2,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      }),
    )
    expect(out[0]).toMatchObject({
      type: "message.updated",
      properties: {
        info: {
          finish: "stop",
          cost: 0.2,
          tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
          time: { created: 110, completed: 130 },
        },
      },
    })
  })

  test("step.failed attaches UnknownError", () => {
    const translator = make()
    translator.translate(stepStarted())
    const out = translator.translate(
      ev("session.next.step.failed", {
        timestamp: 130,
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        error: { type: "unknown", message: "provider down" },
      }),
    )
    expect(out[0]).toMatchObject({
      type: "message.updated",
      properties: { info: { error: { name: "UnknownError", data: { message: "provider down" } } } },
    })
  })

  test("settlement for an unknown assistant is dropped", () => {
    const translator = make()
    expect(
      translator.translate(
        ev("session.next.step.ended", {
          timestamp: 130,
          sessionID: "ses_1",
          assistantMessageID: "msg_missing",
          finish: "stop",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ),
    ).toEqual([])
  })
})

describe("compaction", () => {
  test("ended synthesizes a user message plus compaction part and re-anchors parent", () => {
    const translator = make()
    translator.translate(prompted())
    const out = translator.translate(
      ev("session.next.compaction.ended", {
        timestamp: 140,
        sessionID: "ses_1",
        messageID: "msg_c1",
        reason: "auto",
        text: "summary",
        recent: "recent",
      }),
    )
    expect(out[0]).toMatchObject({
      type: "message.updated",
      properties: { info: { id: "msg_c1", role: "user" } },
    })
    expect(out[1]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { id: "msg_c1:compaction", type: "compaction", auto: true } },
    })

    const next = translator.translate(stepStarted("msg_a2"))
    if (next[0]?.type !== "message.updated" || next[0].properties.info.role !== "assistant") {
      throw new Error("expected assistant message")
    }
    expect(next[0].properties.info.parentID).toBe("msg_c1")
  })
})

describe("permission and question", () => {
  test("permission.v2.asked adapts vocabulary", () => {
    const translator = make()
    const out = translator.translate(
      ev("permission.v2.asked", {
        id: "per_1",
        sessionID: "ses_1",
        action: "bash",
        resources: ["bun test"],
      }),
    )
    expect(out[0]).toEqual({
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: ["bun test"],
        always: [],
        metadata: {},
      },
    })
  })

  test("permission.v2.replied passes through", () => {
    const translator = make()
    expect(
      translator.translate(
        ev("permission.v2.replied", { sessionID: "ses_1", requestID: "per_1", reply: "always" }),
      ),
    ).toEqual([
      { type: "permission.replied", properties: { sessionID: "ses_1", requestID: "per_1", reply: "always" } },
    ])
  })

  test("question trio maps to legacy events", () => {
    const translator = make()
    const asked = translator.translate(
      ev("question.v2.asked", {
        id: "que_1",
        sessionID: "ses_1",
        questions: [{ question: "ok?", header: "h", options: [], multiple: false }],
      }),
    )
    expect(asked[0]?.type).toBe("question.asked")
    expect(
      translator.translate(
        ev("question.v2.replied", { sessionID: "ses_1", requestID: "que_1", answers: [["yes"]] }),
      )[0],
    ).toEqual({
      type: "question.replied",
      properties: { sessionID: "ses_1", requestID: "que_1", answers: [["yes"]] },
    })
    expect(
      translator.translate(ev("question.v2.rejected", { sessionID: "ses_1", requestID: "que_1" }))[0],
    ).toEqual({ type: "question.rejected", properties: { sessionID: "ses_1", requestID: "que_1" } })
  })
})

describe("evict", () => {
  test("drops session state", () => {
    const translator = make()
    translator.translate(prompted())
    translator.translate(stepStarted())
    translator.evict("ses_1")
    expect(
      translator.translate(
        ev("session.next.step.ended", {
          timestamp: 130,
          sessionID: "ses_1",
          assistantMessageID: "msg_a1",
          finish: "stop",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ),
    ).toEqual([])
  })
})

describe("native vocabulary", () => {
  test("returns empty for events handled natively by the caller", () => {
    const translator = make()
    expect(
      translator.translate(ev("session.next.updated", { timestamp: 1, sessionID: "ses_1", title: "t" })),
    ).toEqual([])
    expect(
      translator.translate(
        ev("session.next.retried", {
          timestamp: 1,
          sessionID: "ses_1",
          attempt: 2,
          error: { message: "x", isRetryable: true },
        }),
      ),
    ).toEqual([])
  })
})
