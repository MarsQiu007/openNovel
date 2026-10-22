import { describe, expect, test } from "bun:test"
import type {
  FileDiff,
  PermissionV2Request,
  QuestionV2Request,
  SessionMessage,
  SessionMessageAssistant,
  SessionV2Info,
} from "@opennovel-ai/sdk/v2/client"
import {
  adaptDiff,
  adaptInfo,
  adaptMessages,
  adaptPermission,
  adaptQuestion,
  serializeToolContent,
} from "./v2-adapter"
import type { AdaptContext } from "./v2-adapter"

const ctx: AdaptContext = {
  sessionID: "ses_1",
  directory: "/repo",
  agent: "director",
  model: { providerID: "anthropic", modelID: "claude-sonnet-5-5", variant: "max" },
}

const info = (overrides: Partial<SessionV2Info> = {}): SessionV2Info => ({
  id: "ses_1",
  projectID: "pro_1",
  cost: 0.5,
  tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  time: { created: 100, updated: 200, archived: 300 },
  title: "Chapter 1",
  location: { directory: "/repo", workspaceID: "wrk_1" },
  subpath: "novel/a",
  parentID: "ses_0",
  agent: "director",
  model: { id: "claude-sonnet-5-5", providerID: "anthropic", variant: "max" },
  revert: { messageID: "msg_9", partID: "prt_9", snapshot: "snap", diff: "diff", files: [] },
  ...overrides,
})

describe("adaptInfo", () => {
  test("maps V2 info to legacy session shape", () => {
    const adapted = adaptInfo(info())
    expect(adapted).toMatchObject({
      id: "ses_1",
      slug: "ses_1",
      projectID: "pro_1",
      workspaceID: "wrk_1",
      directory: "/repo",
      path: "novel/a",
      parentID: "ses_0",
      title: "Chapter 1",
      agent: "director",
      model: { id: "claude-sonnet-5-5", providerID: "anthropic", variant: "max" },
      version: "",
      time: { created: 100, updated: 200, archived: 300 },
      revert: { messageID: "msg_9", partID: "prt_9", snapshot: "snap", diff: "diff" },
    })
    expect(adapted.revert && "files" in adapted.revert).toBe(false)
  })

  test("omits absent optional fields", () => {
    const adapted = adaptInfo(
      info({
        parentID: undefined,
        subpath: undefined,
        agent: undefined,
        model: undefined,
        revert: undefined,
        location: { directory: "/repo" },
      }),
    )
    expect("parentID" in adapted).toBe(false)
    expect("path" in adapted).toBe(false)
    expect("agent" in adapted).toBe(false)
    expect("model" in adapted).toBe(false)
    expect("revert" in adapted).toBe(false)
    expect("workspaceID" in adapted).toBe(false)
  })
})

describe("adaptDiff", () => {
  test("renames path to file", () => {
    const diffs: FileDiff[] = [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 2, patch: "@@" }]
    expect(adaptDiff(diffs)).toEqual([
      { file: "src/a.ts", status: "modified", additions: 1, deletions: 2, patch: "@@" },
    ])
  })
})

describe("adaptPermission", () => {
  const request: PermissionV2Request = {
    id: "per_1",
    sessionID: "ses_1",
    action: "bash",
    resources: ["bun test"],
    source: { type: "tool", messageID: "msg_1", callID: "prt_1" },
  }

  test("maps vocabulary and defaults", () => {
    expect(adaptPermission(request)).toEqual({
      id: "per_1",
      sessionID: "ses_1",
      permission: "bash",
      patterns: ["bun test"],
      always: [],
      metadata: {},
      tool: { messageID: "msg_1", callID: "prt_1" },
    })
  })

  test("keeps save list and metadata", () => {
    expect(adaptPermission({ ...request, save: ["bun *"], metadata: { reason: "x" } })).toMatchObject({
      always: ["bun *"],
      metadata: { reason: "x" },
    })
  })
})

describe("adaptQuestion", () => {
  test("passes through the isomorphic shape", () => {
    const request: QuestionV2Request = {
      id: "que_1",
      sessionID: "ses_1",
      questions: [{ question: "ok?", header: "h", options: [{ label: "yes", description: "d" }], multiple: false }],
      tool: { messageID: "msg_1", callID: "prt_1" },
    }
    expect(adaptQuestion(request)).toEqual(request)
  })
})

describe("serializeToolContent", () => {
  test("joins text and names files", () => {
    expect(
      serializeToolContent([
        { type: "text", text: "hello" },
        { type: "file", uri: "file:///a.png", mime: "image/png", name: "a.png" },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello\n[file] a.png\nworld")
  })
})

describe("adaptMessages", () => {
  const assistant = (overrides: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant => ({
    id: "msg_a1",
    time: { created: 120, completed: 130 },
    type: "assistant",
    agent: "director",
    model: { id: "claude-sonnet-5-5", providerID: "anthropic", variant: "max" },
    content: [
      { type: "text", id: "prt_t1", text: "answer" },
      {
        type: "tool",
        id: "prt_c1",
        name: "bash",
        state: {
          status: "completed",
          input: { cmd: "ls" },
          content: [{ type: "text", text: "done" }],
          structured: { title: "List files" },
        },
        time: { created: 121, ran: 122, completed: 123 },
      },
    ],
    finish: "stop",
    cost: 0.1,
    tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  })

  test("adapts user and assistant with parent chaining", () => {
    const page: SessionMessage[] = [
      { id: "msg_u1", time: { created: 110 }, text: "write", type: "user" },
      assistant(),
    ]
    const { session, part } = adaptMessages(page, ctx)
    expect(session).toHaveLength(2)

    const user = session[0]
    expect(user).toMatchObject({ id: "msg_u1", role: "user", agent: "director", model: ctx.model })
    expect(part[0]).toEqual({
      id: "msg_u1",
      part: [{ id: "msg_u1:text", sessionID: "ses_1", messageID: "msg_u1", type: "text", text: "write" }],
    })

    const reply = session[1]
    if (reply.role !== "assistant") throw new Error("expected assistant")
    expect(reply).toMatchObject({
      id: "msg_a1",
      parentID: "msg_u1",
      mode: "director",
      agent: "director",
      modelID: "claude-sonnet-5-5",
      providerID: "anthropic",
      path: { cwd: "/repo", root: "/repo" },
      variant: "max",
      finish: "stop",
      time: { created: 120, completed: 130 },
    })
    const tool = part[1]?.part.find((p) => p.type === "tool")
    if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("expected completed tool")
    expect(tool).toMatchObject({
      callID: "prt_c1",
      tool: "bash",
      state: {
        input: { cmd: "ls" },
        output: "done",
        title: "List files",
        time: { start: 122, end: 123 },
      },
    })
  })

  test("maps assistant error to UnknownError", () => {
    const { session } = adaptMessages([assistant({ error: { type: "unknown", message: "boom" } })], ctx)
    expect(session[0]).toMatchObject({ error: { name: "UnknownError", data: { message: "boom" } } })
  })

  test("keeps pending tool raw input when JSON parse fails", () => {
    const { part } = adaptMessages(
      [
        assistant({
          content: [
            { type: "tool", id: "prt_c1", name: "bash", state: { status: "pending", input: "{bad" }, time: { created: 1 } },
          ],
        }),
      ],
      ctx,
    )
    const tool = part[0]?.part[0]
    if (tool?.type !== "tool" || tool.state.status !== "pending") throw new Error("expected pending tool")
    expect(tool.state).toEqual({ status: "pending", input: {}, raw: "{bad" })
  })

  test("synthesizes compaction as user message with compaction part", () => {
    const { session, part } = adaptMessages(
      [{ id: "msg_c1", time: { created: 100 }, type: "compaction", reason: "auto", summary: "s", recent: "r" }],
      ctx,
    )
    expect(session[0]).toMatchObject({ id: "msg_c1", role: "user" })
    expect(part[0]?.part).toContainEqual({
      id: "msg_c1:compaction",
      sessionID: "ses_1",
      messageID: "msg_c1",
      type: "compaction",
      auto: true,
    })
  })

  test("drops non-rendered variants and chains parent across compaction", () => {
    const page: SessionMessage[] = [
      { id: "msg_s1", time: { created: 90 }, type: "agent-switched", agent: "director" },
      { id: "msg_c1", time: { created: 100 }, type: "compaction", reason: "manual", summary: "s", recent: "r" },
      assistant(),
    ]
    const { session } = adaptMessages(page, ctx)
    expect(session.map((item) => item.id)).toEqual(["msg_c1", "msg_a1"])
    const reply = session[1]
    if (reply.role !== "assistant") throw new Error("expected assistant")
    expect(reply.parentID).toBe("msg_c1")
  })

  test("adapts user file and agent attachments", () => {
    const page: SessionMessage[] = [
      {
        id: "msg_u1",
        time: { created: 110 },
        text: "look",
        type: "user",
        files: [
          {
            uri: "file:///repo/ch1.md?start=0&end=5",
            mime: "text/plain",
            name: "ch1.md",
            source: { start: 0, end: 5, text: "hello" },
          },
        ],
        agents: [{ name: "writer", source: { start: 1, end: 3, text: "@writer" } }],
      },
    ]
    const { part } = adaptMessages(page, ctx)
    expect(part[0]?.part).toEqual([
      { id: "msg_u1:text", sessionID: "ses_1", messageID: "msg_u1", type: "text", text: "look" },
      {
        id: "msg_u1:file:0",
        sessionID: "ses_1",
        messageID: "msg_u1",
        type: "file",
        mime: "text/plain",
        filename: "ch1.md",
        url: "file:///repo/ch1.md?start=0&end=5",
        source: { type: "file", path: "/repo/ch1.md", text: { value: "hello", start: 0, end: 5 } },
      },
      {
        id: "msg_u1:agent:0",
        sessionID: "ses_1",
        messageID: "msg_u1",
        type: "agent",
        name: "writer",
        source: { value: "@writer", start: 1, end: 3 },
      },
    ])
  })
})
