import { describe, expect, test } from "bun:test"
import type { retry } from "@opennovel-ai/core/util/retry"
import type {
  Message,
  OpenNovelClient,
  Part,
  Session,
  SessionMessage,
  SessionV2Info,
} from "@opennovel-ai/sdk/v2/client"
import { createServerSession } from "./server-session"

// V1 形状保留作事件/断言 fixture；V2 线上形状由 harness 转换（wireOne）。
// fake session.get 返回的 info 带 agent "build" / model {id:"model",providerID:"provider"}，
// 使适配器产出的 V1 形状与旧 fixture 默认值一致。

const session = (id: string, parentID?: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  title: id,
  version: "1",
  parentID,
  time: { created: 1, updated: 1 },
})

const v2Session = (id: string, parentID?: string): SessionV2Info => ({
  id,
  ...(parentID === undefined ? {} : { parentID }),
  projectID: "project",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  title: id,
  location: { directory: "/repo" },
})

type UserMessage = Extract<Message, { role: "user" }>
type AssistantMessage = Extract<Message, { role: "assistant" }>
type TextPart = Extract<Part, { type: "text" }>
type Page = { data: { data: SessionMessage[]; cursor: { next?: string } } }

const userMessage = (id: string, input: Partial<UserMessage> = {}): UserMessage => ({
  id,
  sessionID: "child",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
  ...input,
})

const assistantMessage = (id: string, parentID: string, input: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  sessionID: "child",
  role: "assistant",
  time: { created: Number(id.at(-1)), completed: Number(id.at(-1)) },
  parentID,
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/repo", root: "/repo" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  ...input,
})

const textPart = (messageID: string, input: Partial<TextPart> = {}): TextPart => ({
  id: "part",
  sessionID: "child",
  messageID,
  type: "text",
  text: "text",
  ...input,
})

// 拉取的 user 文本会被适配器合成为 `${messageID}:text` part，断言统一用这个 id
const userTextPart = (messageID: string, text = "text"): TextPart => ({
  id: `${messageID}:text`,
  sessionID: "child",
  messageID,
  type: "text",
  text,
})

// V1 fixture → V2 线上投影。assistant 的 parentID 不进线上形状（由页内顺序推导）。
function wireOne(info: Message, parts: Part[]): SessionMessage {
  if (info.role === "user") {
    const texts = parts.filter((part): part is TextPart => part.type === "text")
    if (texts.length > 1) throw new Error(`user message ${info.id} has multiple text parts`)
    return { id: info.id, time: { created: info.time.created }, text: texts[0]?.text ?? "", type: "user" }
  }
  return {
    id: info.id,
    time: {
      created: info.time.created,
      ...(info.time.completed === undefined ? {} : { completed: info.time.completed }),
    },
    type: "assistant",
    agent: info.agent,
    model: {
      id: info.modelID,
      providerID: info.providerID,
      ...(info.variant === undefined ? {} : { variant: info.variant }),
    },
    content: parts.map((part) => {
      if (part.type !== "text") throw new Error(`unsupported part type in wire: ${part.type}`)
      return { type: "text" as const, id: part.id, text: part.text }
    }),
    ...(info.finish === undefined ? {} : { finish: info.finish }),
    cost: info.cost,
    tokens: info.tokens,
  }
}

// items 按升序构造；端点返回 desc（最新在前），cursor.next 指向更旧方向
const response = (items: { info: Message; parts: Part[] }[] = [], next?: string): Page => ({
  data: {
    data: items.map((item) => wireOne(item.info, item.parts)).reverse(),
    cursor: next === undefined ? {} : { next },
  },
})

const deferredPage = () => Promise.withResolvers<Page>()

function messageClient(...responses: Array<Page | Promise<Page>>) {
  let index = 0
  const requests: unknown[] = []
  const waiting = new Map<number, () => void>()
  const client = {
    v2: {
      session: {
        get: async () => ({ data: { data: v2Session("child", "root") } }),
        messages: (input: unknown) => {
          requests.push(input)
          waiting.get(requests.length)?.()
          waiting.delete(requests.length)
          return responses[index++]
        },
        diff: async () => ({ data: { data: [] } }),
        todo: async () => ({ data: { data: [] } }),
        active: async () => ({ data: { data: {} } }),
      },
    },
  } as unknown as OpenNovelClient
  return Object.assign(client, {
    requests,
    requested(count: number) {
      if (requests.length >= count) return Promise.resolve()
      return new Promise<void>((resolve) => waiting.set(count, resolve))
    },
  })
}

const retryImmediately: typeof retry = async (task, options = {}) => {
  const attempts = options.attempts ?? 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt === attempts - 1) throw error
    }
  }
}

function setup(sessions: Record<string, Session>) {
  const get: unknown[] = []
  const messages: unknown[] = []
  const client = {
    v2: {
      session: {
        get: async (input: unknown) => {
          get.push(input)
          const id = (input as { sessionID: string }).sessionID
          const found = sessions[id]
          return { data: found ? { data: v2Session(found.id, found.parentID) } : undefined }
        },
        messages: async (input: unknown) => {
          messages.push(input)
          return response()
        },
        diff: async () => ({ data: { data: [] } }),
        todo: async () => ({ data: { data: [] } }),
        active: async () => ({ data: { data: {} } }),
      },
    },
  } as unknown as OpenNovelClient
  return { get, messages, store: createServerSession(client) }
}

describe("server session", () => {
  test("resolves lineage by session ID without directory", async () => {
    const ctx = setup({ child: session("child", "root"), root: session("root") })

    const result = await ctx.store.lineage.resolve("child")

    expect(result.root.id).toBe("root")
    expect(ctx.get).toEqual([{ sessionID: "child" }, { sessionID: "root" }])
    expect(ctx.store.lineage.peek("child")).toEqual(result)
  })

  test("loads session content through the server client", async () => {
    const ctx = setup({ root: session("root") })

    await ctx.store.sync("root")

    expect(ctx.get).toEqual([{ sessionID: "root" }])
    expect(ctx.messages).toEqual([{ sessionID: "root", limit: 20, order: "desc" }])
    expect(ctx.store.data.message.root).toEqual([])
  })

  test("re-anchors assistant parents when history prepends their user root", async () => {
    const user = userMessage("message-1")
    const assistants = [assistantMessage("message-2", ""), assistantMessage("message-3", "")]
    const client = messageClient(
      response(
        assistants.map((info) => ({ info, parts: [] })),
        "older",
      ),
      response([{ info: user, parts: [] }]),
    )
    const store = createServerSession(client)

    await store.sync("child")

    expect(client.requests).toEqual([{ sessionID: "child", limit: 20, order: "desc" }])
    expect(store.data.message.child).toEqual(assistants)
    expect(store.history.more("child")).toBe(true)

    await store.history.loadMore("child")

    expect(client.requests[1]).toEqual({ sessionID: "child", limit: 200, order: "desc", cursor: "older" })
    expect(store.data.message.child).toEqual([
      user,
      ...assistants.map((info) => ({ ...info, parentID: user.id })),
    ])
    expect(store.history.more("child")).toBe(false)
  })

  test("keeps assistant history when its parent is gone from the completed timeline", async () => {
    const assistant = assistantMessage("message-2", "")
    const client = messageClient(response([{ info: assistant, parts: [] }], "older"), response())
    const store = createServerSession(client)

    await store.sync("child")
    await store.history.loadMore("child")

    expect(store.data.message.child).toEqual([assistant])
    expect(store.history.more("child")).toBe(false)
  })

  test("drops a cached parent when a complete refresh confirms it was deleted", async () => {
    const parent = userMessage("message-1")
    const part = userTextPart(parent.id)
    const assistant = assistantMessage("message-2", "")
    const client = messageClient(
      response([
        { info: parent, parts: [part] },
        { info: { ...assistant, parentID: parent.id }, parts: [] },
      ]),
      response([{ info: assistant, parts: [] }]),
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([assistant])
    expect(store.data.part[parent.id]).toBeUndefined()
  })

  test("lets an optimistic user anchor fetched assistants", async () => {
    const user = userMessage("message-1")
    const part = userTextPart(user.id)
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = messageClient(
      response(
        assistants.map((info) => ({ info: { ...info, parentID: "" }, parts: [] })),
        "older",
      ),
    )
    const store = createServerSession(client)
    store.optimistic.add({ sessionID: "child", message: user, parts: [part] })

    await store.sync("child")

    expect(client.requests).toHaveLength(1)
    expect(store.data.message.child).toEqual([user, ...assistants])

    store.optimistic.remove({ sessionID: "child", messageID: user.id })

    expect(store.data.message.child).toEqual(assistants)
  })

  test("derives assistant parents from the page while another user is cached", async () => {
    const unrelated = userMessage("message-0", { time: { created: 0 } })
    const user = userMessage("message-1")
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = messageClient(
      response([{ info: unrelated, parts: [] }]),
      response(
        [{ info: user, parts: [] }, ...assistants.map((info) => ({ info, parts: [] }))],
        "older",
      ),
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.requests).toHaveLength(2)
    expect(store.data.message.child).toEqual([unrelated, user, ...assistants])
  })

  test("refreshes a cached parent's parts from the prepended history page", async () => {
    const stale = userMessage("message-1")
    const stalePart = userTextPart(stale.id, "stale")
    const freshPart = userTextPart(stale.id, "fresh")
    const assistant = assistantMessage("message-2", stale.id)
    const client = messageClient(
      response([{ info: stale, parts: [stalePart] }]),
      response([{ info: { ...assistant, parentID: "" }, parts: [] }], "older"),
      response([{ info: stale, parts: [freshPart] }]),
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })
    await store.history.loadMore("child")

    expect(store.data.message.child).toEqual([stale, assistant])
    expect(store.data.part[stale.id]).toEqual([freshPart])
  })

  test("refreshes a confirmed optimistic parent while preserving pending parts", async () => {
    const stale = userMessage("message-1")
    const confirmed = userTextPart(stale.id, "stale")
    const refreshed = userTextPart(stale.id, "fresh")
    const pending = textPart(stale.id, { id: "pending", text: "pending" })
    const assistant = assistantMessage("message-2", stale.id)
    const client = messageClient(
      response([{ info: stale, parts: [confirmed] }]),
      response([{ info: { ...assistant, parentID: "" }, parts: [] }], "older"),
      response([{ info: stale, parts: [refreshed] }]),
    )
    const store = createServerSession(client)
    store.optimistic.add({ sessionID: "child", message: stale, parts: [confirmed, pending] })
    await store.sync("child")

    await store.sync("child", { force: true })
    await store.history.loadMore("child")

    expect(store.data.message.child).toEqual([stale, assistant])
    expect(store.data.part[stale.id]).toEqual([refreshed, pending])
  })

  test("uses a parent received by SSE during the replacement load", async () => {
    const pending = deferredPage()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const client = messageClient(pending.promise)
    const store = createServerSession(client)
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: user } })
    pending.resolve(response([{ info: { ...assistant, parentID: "" }, parts: [] }], "older"))
    await loading

    expect(store.data.message.child).toEqual([user, assistant])
  })

  test("uses a successful retry over events received by a failed attempt", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const user = userMessage("message-1")
    const live = { ...user, agent: "stale" }
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await client.requested(2)
    retried.resolve(
      response([{ info: user, parts: [] }, ...assistants.map((info) => ({ info, parts: [] }))], "older"),
    )
    await loading

    expect(client.requests).toHaveLength(2)
    expect(store.data.message.child).toEqual([user, ...assistants])
  })

  test("merges live events into the initial page", async () => {
    const pending = deferredPage()
    const user = userMessage("message-1")
    const live = userMessage("message-2", { time: { created: 2 } })
    const livePart = userTextPart(live.id, "live")
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: livePart, time: 2 } })
    pending.resolve(response([{ info: user, parts: [] }]))
    await loading

    expect(store.data.message.child).toEqual([user, live])
    expect(store.data.part[live.id]).toEqual([livePart])
  })

  test("preserves same-ID live updates over the initial page", async () => {
    const pending = deferredPage()
    const fetched = userMessage("message")
    const fetchedPart = userTextPart(fetched.id, "fetched")
    const live = { ...fetched, time: { created: 2 } }
    const livePart = { ...fetchedPart, text: "live" }
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: livePart, time: 2 } })
    pending.resolve(response([{ info: fetched, parts: [fetchedPart] }]))
    await loading

    expect(store.data.message.child).toEqual([live])
    expect(store.data.part[live.id]).toEqual([livePart])
  })

  test("preserves removals received during the initial load", async () => {
    const pending = deferredPage()
    const removed = userMessage("message-1")
    const kept = { ...removed, id: "message-2" }
    const part = userTextPart(kept.id, "removed")
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: removed.id } })
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: kept.id, partID: part.id },
    })
    pending.resolve(
      response([
        { info: removed, parts: [] },
        { info: kept, parts: [part] },
      ]),
    )
    await loading

    expect(store.data.message.child).toEqual([kept])
    expect(store.data.part[kept.id]).toBeUndefined()
  })

  test("keeps removal tracking isolated across load generations", async () => {
    const firstResponse = deferredPage()
    const secondResponse = deferredPage()
    const message = userMessage("message")
    const store = createServerSession(messageClient(firstResponse.promise, secondResponse.promise))
    const first = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "session.next.deleted", properties: { timestamp: 2, sessionID: "child" } })
    const second = store.sync("child")

    firstResponse.resolve(response())
    await first
    secondResponse.resolve(response([{ info: message, parts: [] }]))
    await second

    expect(store.data.message.child).toEqual([message])
  })

  test("tracks removals in a replacement load generation", async () => {
    const firstResponse = deferredPage()
    const secondResponse = deferredPage()
    const message = userMessage("message")
    const store = createServerSession(messageClient(firstResponse.promise, secondResponse.promise))
    const first = store.sync("child")
    store.apply({ type: "session.next.deleted", properties: { timestamp: 2, sessionID: "child" } })
    const second = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    firstResponse.resolve(response())
    await first
    secondResponse.resolve(response([{ info: message, parts: [] }]))
    await second

    expect(store.data.message.child).toEqual([])
  })

  test("preserves remove then re-add when a refresh omits the message", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const store = createServerSession(messageClient(response([{ info: message, parts: [] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.updated", properties: { info: message } })
    pending.resolve(response())
    await refreshing

    expect(store.data.message.child).toEqual([message])
  })

  test("preserves a re-added message without restoring removed parts", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id, "stale")
    const store = createServerSession(messageClient(response([{ info: message, parts: [] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.updated", properties: { info: message } })
    pending.resolve(response([{ info: message, parts: [part] }]))
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves optimistic parts re-added after removal during a refresh", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const stale = userTextPart(message.id, "stale")
    const part = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [] }]), pending.promise, response()),
    )
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    pending.resolve(response([{ info: message, parts: [stale] }]))
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])

    await store.sync("child", { force: true })
    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("drops stale event content omitted by a complete initial page", async () => {
    const stale = userMessage("stale")
    const store = createServerSession(messageClient(response()))
    store.apply({ type: "message.updated", properties: { info: stale } })

    await store.sync("child")

    expect(store.data.message.child).toEqual([])
  })

  test("preserves event content outside an incomplete initial page", async () => {
    const live = userMessage("message-1")
    const fetched = userMessage("message-2", { time: { created: 2 } })
    const store = createServerSession(messageClient(response([{ info: fetched, parts: [] }], "older")))
    store.apply({ type: "message.updated", properties: { info: live } })

    await store.sync("child")

    expect(store.data.message.child).toEqual([live, fetched])
  })

  test("does not restore removed optimistic content on refresh", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "removed")
    const kept = { ...message, id: "kept" }
    const keptPart = { ...part, id: "kept-part", messageID: kept.id }
    const store = createServerSession(messageClient(response([{ info: kept, parts: [] }])))
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.optimistic.add({ sessionID: "child", message: kept, parts: [keptPart] })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: kept.id, partID: keptPart.id },
    })
    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([kept])
    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part[kept.id]).toBeUndefined()
  })

  test("replaces confirmed optimistic content with the initial page", async () => {
    const optimistic = userMessage("message")
    const fetched = { ...optimistic, time: { created: 2 } }
    const store = createServerSession(messageClient(response([{ info: fetched, parts: [] }])))
    store.optimistic.add({ sessionID: "child", message: optimistic, parts: [] })

    await store.sync("child")

    expect(store.data.message.child).toEqual([fetched])
  })

  test("replaces a confirmed optimistic part with fetched content", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const optimistic = userTextPart(message.id, "optimistic")
    const fetched = userTextPart(message.id, "fetched")
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })
    pending.resolve(response([{ info: message, parts: [fetched] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([fetched])
  })

  test("rolls back only unconfirmed optimistic parts", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const confirmed = userTextPart(message.id, "confirmed")
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })

    pending.resolve(response([{ info: message, parts: [confirmed] }]))
    await loading
    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([confirmed])
  })

  test("updates confirmed optimistic parts from later pages", async () => {
    const message = userMessage("message")
    const confirmed = userTextPart(message.id, "first")
    const updated = userTextPart(message.id, "updated")
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [confirmed] }]), response([{ info: message, parts: [updated] }])),
    )
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })
    await store.sync("child")

    await store.sync("child", { force: true })
    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.part[message.id]).toEqual([updated])
  })

  test("does not restore a confirmed optimistic part after its removal event", async () => {
    const message = userMessage("message")
    const confirmed = userTextPart(message.id, "confirmed")
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [confirmed] }]), response([{ info: message, parts: [] }])),
    )
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })
    await store.sync("child")
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: confirmed.id },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([pendingPart])
  })

  test("clears delta buffers when removing optimistic content", () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "optimistic")
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("does not remove content confirmed by a message event", () => {
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: message } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not remove parts confirmed by part events", () => {
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("treats a part event as confirmation when it precedes the message event", () => {
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("clears stale parts when the initial page has none", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id, "stale")
    const store = createServerSession(messageClient(pending.promise))
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 1 } })
    const loading = store.sync("child")

    pending.resolve(response([{ info: message, parts: [] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("clears delta buffers for parts omitted by the initial page", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const kept = userTextPart(message.id, "kept")
    const removed: Part = { ...kept, id: "part-2", text: "removed" }
    const store = createServerSession(messageClient(pending.promise))
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: kept, time: 1 } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: removed, time: 1 } })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: removed.id, field: "text", delta: " delta" },
    })
    const loading = store.sync("child")

    pending.resolve(response([{ info: message, parts: [kept] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([kept])
    expect(store.data.part_text_accum_delta[removed.id]).toBeUndefined()
  })

  test("clears a stale delta buffer when a refresh replaces its part", async () => {
    const message = userMessage("message")
    const stale = userTextPart(message.id, "stale")
    const fetched = userTextPart(message.id, "fetched")
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [stale] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: stale.id, field: "text", delta: " delta" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[stale.id]).toBeUndefined()
  })

  test("preserves a non-durable delta received before refresh", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "stale")
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [{ ...part }] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "stale delta" }])
    expect(store.data.part_text_accum_delta[part.id]).toBe("stale delta")
  })

  test("accepts fetched text that intentionally replaces an accumulated prefix", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "abc")
    const fetched = userTextPart(message.id, "ab")
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "def" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("preserves an unpersisted delta suffix after partial server catch-up", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "a")
    const fetched = userTextPart(message.id, "ab")
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "bc" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "abc" }])
    expect(store.data.part_text_accum_delta[part.id]).toBe("abc")
  })

  test("clears delta state after exact server catch-up", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "a")
    const fetched = userTextPart(message.id, "ab")
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "b" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("uses the successful retry response over events from a failed attempt", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const message = userMessage("message")
    const stale = userTextPart(message.id, "stale")
    const intermediate = { ...stale, text: "intermediate" }
    const fetched = { ...stale, text: "fetched" }
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: stale, time: 1 } })
    const loading = store.sync("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: intermediate, time: 2 } })
    failed.reject(new Error("failed to fetch"))
    await client.requested(2)
    retried.resolve(response([{ info: message, parts: [fetched] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([fetched])
  })

  test("preserves non-durable deltas across message retries", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id, "stale")
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 1 } })
    const loading = store.sync("child")

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(2)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "stale delta" }])
  })

  test("preserves part removals across message retries", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: part.id },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves message removals across message retries", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves optimistic re-adds across message retries", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const message = userMessage("message")
    const stale = userTextPart(message.id, "stale")
    const optimistic = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const client = messageClient(response([{ info: message, parts: [stale] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [stale] }]))
    await loading

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([optimistic])
  })

  test("accepts part omission from a successful retry after an earlier delta", async () => {
    const failed = deferredPage()
    const retried = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("clears load-owned orphan parts when all retries fail", async () => {
    const first = deferredPage()
    const second = deferredPage()
    const third = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const client = messageClient(first.promise, second.promise, third.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child").catch((error) => error)

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    first.reject(new Error("failed to fetch"))
    await client.requested(2)
    second.reject(new Error("failed to fetch"))
    await client.requested(3)
    third.reject(new Error("failed to fetch"))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves live updates during a forced refresh", async () => {
    const pending = deferredPage()
    const stale = userMessage("message")
    const stalePart = userTextPart(stale.id, "stale")
    const store = createServerSession(messageClient(response([{ info: stale, parts: [stalePart] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })
    const live = { ...stale, time: { created: 2 } }

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: stale.id, partID: stalePart.id, field: "text", delta: " live" },
    })
    pending.resolve(response([{ info: stale, parts: [stalePart] }]))
    await refreshing

    expect(store.data.message.child).toEqual([live])
    expect(store.data.part[stale.id]).toEqual([{ ...stalePart, text: "stale live" }])
  })

  test("keeps fetched message metadata when only a part changes", async () => {
    const pending = deferredPage()
    const stale = userMessage("message")
    const fetched = { ...stale, time: { created: 2 } }
    const part = userTextPart(stale.id, "stale")
    const store = createServerSession(messageClient(response([{ info: stale, parts: [part] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: stale.id, partID: part.id, field: "text", delta: " live" },
    })
    pending.resolve(response([{ info: fetched, parts: [part] }]))
    await refreshing

    expect(store.data.message.child).toEqual([fetched])
    expect(store.data.part[stale.id]).toEqual([{ ...part, text: "stale live" }])
  })

  test("preserves a part update when a forced refresh omits its message", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const stale = userTextPart(message.id, "stale")
    const live = userTextPart(message.id, "live")
    const store = createServerSession(messageClient(response([{ info: message, parts: [stale] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    pending.resolve(response())
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([live])
  })

  test("ignores a late part update after its message is removed", async () => {
    const pending = deferredPage()
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    pending.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("ignores a late part update after a completed message removal", () => {
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = setup({ child: session("child") }).store
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not restore a completed message removal from a stale refresh", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [part] }])),
    )
    await store.sync("child")
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not restore a completed part removal from a stale refresh", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id)
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [part] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: part.id },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not cache skipped optimistic parts", () => {
    const message = userMessage("message")
    const part = { id: "part", sessionID: "child", messageID: message.id, type: "step-start" as const }
    const store = setup({ child: session("child") }).store

    store.optimistic.add({ sessionID: "child", message, parts: [part] })

    expect(store.data.part[message.id]).toEqual([])
  })

  test("clears stale delta buffers when replacing optimistic parts", () => {
    const message = userMessage("message")
    const stale = userTextPart(message.id, "stale")
    const optimistic = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [stale] })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: stale.id, field: "text", delta: " delta" },
    })

    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })

    expect(store.data.part_text_accum_delta[stale.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[optimistic.id]).toBeUndefined()
  })

  test("preserves removals during history prepend", async () => {
    const pending = deferredPage()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = { ...latest, id: "message-1", time: { created: 1 } }
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: older.id } })
    pending.resolve(response([{ info: older, parts: [] }]))
    await loading

    expect(store.data.message.child).toEqual([latest])
  })

  test("preserves loaded history during an incomplete refresh", async () => {
    const older = userMessage("message-1")
    const latest = userMessage("message-2", { time: { created: 2 } })
    const fresh = userMessage("message-3", { time: { created: 3 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: older, parts: [] },
            { info: latest, parts: [] },
          ],
          "older",
        ),
        response(
          [
            { info: latest, parts: [] },
            { info: fresh, parts: [] },
          ],
          "older",
        ),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([older, latest, fresh])
  })

  test("drops stale recent messages omitted by an incomplete refresh", async () => {
    const third = userMessage("message-3", { time: { created: 3 } })
    const fourth = userMessage("message-4", { time: { created: 4 } })
    const stale = userMessage("message-5", { time: { created: 5 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: fourth, parts: [] },
            { info: stale, parts: [] },
          ],
          "older",
        ),
        response(
          [
            { info: third, parts: [] },
            { info: fourth, parts: [] },
          ],
          "older",
        ),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([third, fourth])
  })

  test("uses message creation time for incomplete refresh boundaries", async () => {
    const older = userMessage("msg_z", { time: { created: 1 } })
    const boundary = userMessage("msg_m", { time: { created: 2 } })
    const stale = userMessage("msg_a", { time: { created: 3 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: older, parts: [] },
            { info: stale, parts: [] },
          ],
          "older",
        ),
        response([{ info: boundary, parts: [] }], "older"),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([boundary, older])
  })

  test("preserves a part update for a message being loaded from history", async () => {
    const pending = deferredPage()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const stale = userTextPart(older.id, "stale")
    const live = userTextPart(older.id, "live")
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    pending.resolve(response([{ info: older, parts: [stale] }]))
    await loading

    expect(store.data.part[older.id]).toEqual([live])
  })

  test("does not clear newer orphan parts after terminal history prepend", async () => {
    const pending = deferredPage()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const newer = userMessage("message-3", { time: { created: 3 } })
    const part = userTextPart(newer.id, "live")
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 3 } })
    pending.resolve(response([{ info: older, parts: [] }]))
    await loading
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: newer } })

    expect(store.data.part[newer.id]).toEqual([part])
  })

  test("accepts an authoritative history part after an earlier unknown-parent update", async () => {
    const pending = deferredPage()
    const history = deferredPage()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const part = userTextPart(older.id, "live")
    const store = createServerSession(messageClient(pending.promise, history.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    pending.resolve(response([{ info: latest, parts: [] }], "older"))
    await loading

    expect(store.data.part[older.id]).toEqual([part])

    const loadingHistory = store.history.loadMore("child")
    history.resolve(response([{ info: older, parts: [{ ...part, text: "stale" }] }]))
    await loadingHistory

    expect(store.data.part[older.id]).toEqual([{ ...part, text: "stale" }])
  })

  test("preserves an unknown-parent part removal across pages", async () => {
    const initial = deferredPage()
    const history = deferredPage()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const part = userTextPart(older.id)
    const store = createServerSession(messageClient(initial.promise, history.promise))
    const loading = store.sync("child")

    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: older.id, partID: part.id },
    })
    initial.resolve(response([{ info: latest, parts: [] }], "older"))
    await loading
    const loadingHistory = store.history.loadMore("child")
    history.resolve(response([{ info: older, parts: [part] }]))
    await loadingHistory

    expect(store.data.part[older.id]).toBeUndefined()
  })

  test("clears orphaned parts when a refresh drops a message", async () => {
    const message = userMessage("message")
    const part = userTextPart(message.id, "stale")
    const store = createServerSession(messageClient(response([{ info: message, parts: [part] }]), response()))
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("applies events without a directory store", () => {
    const ctx = setup({})
    ctx.store.apply({
      type: "session.next.created",
      properties: {
        timestamp: 1,
        sessionID: "root",
        projectID: "project",
        directory: "/repo",
        slug: "root",
        title: "root",
        version: "1",
      },
    })
    ctx.store.apply({ type: "session.status", properties: { sessionID: "root", status: { type: "busy" } } })

    expect(ctx.store.get("root")?.directory).toBe("/repo")
    expect(ctx.store.data.session_working("root")).toBe(true)
    expect(ctx.get).toEqual([])
  })

  test("preserves pinned session content under server-wide cache pressure", () => {
    const ctx = setup({})
    ctx.store.pin("active")
    ctx.store.optimistic.add({
      sessionID: "active",
      message: {
        id: "message",
        sessionID: "active",
        role: "assistant",
        time: { created: 1 },
        parentID: "parent",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "agent",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [],
    })

    for (let index = 0; index < 50; index++) {
      ctx.store.remember(session(`session-${index}`))
      ctx.store.apply({
        type: "session.status",
        properties: { sessionID: `session-${index}`, status: { type: "idle" } },
      })
    }

    expect(ctx.store.data.message.active?.map((message) => message.id)).toEqual(["message"])
    expect(ctx.store.data.session_status["session-0"]).toBeUndefined()
  })
})

describe("server session V2 events", () => {
  const created = (store: ReturnType<typeof createServerSession>, sessionID = "root") =>
    store.apply({
      type: "session.next.created",
      properties: {
        timestamp: 1,
        sessionID,
        projectID: "project",
        directory: "/repo",
        slug: sessionID,
        title: sessionID,
        agent: "build",
        model: { id: "model", providerID: "provider" },
        version: "1",
      },
    })

  test("merges session.next.updated title patches", () => {
    const ctx = setup({})
    created(ctx.store)

    ctx.store.apply({
      type: "session.next.updated",
      properties: { timestamp: 99, sessionID: "root", title: "renamed" },
    })

    expect(ctx.store.get("root")).toMatchObject({ title: "renamed", time: { created: 1, updated: 99 } })
  })

  test("evicts session caches on session.next.updated archived", () => {
    const ctx = setup({})
    created(ctx.store)
    ctx.store.apply({
      type: "message.updated",
      properties: { info: userMessage("message-1", { sessionID: "root" }) },
    })

    ctx.store.apply({
      type: "session.next.updated",
      properties: { timestamp: 99, sessionID: "root", archived: 100 },
    })

    expect(ctx.store.get("root")?.time.archived).toBe(100)
    expect(ctx.store.data.message.root).toBeUndefined()
  })

  test("maps session.next.retried to retry status", () => {
    const ctx = setup({})
    created(ctx.store)

    ctx.store.apply({
      type: "session.next.retried",
      properties: { timestamp: 50, sessionID: "root", attempt: 2, error: { message: "boom" } },
    })

    expect(ctx.store.data.session_status.root).toEqual({ type: "retry", attempt: 2, message: "boom", next: 50 })
  })

  test("clears retry back to busy on session.next.step.started and stores the skeleton", () => {
    const ctx = setup({})
    created(ctx.store)
    ctx.store.apply({
      type: "session.next.retried",
      properties: { timestamp: 50, sessionID: "root", attempt: 2, error: { message: "boom" } },
    })

    ctx.store.apply({
      type: "session.next.step.started",
      properties: {
        timestamp: 60,
        sessionID: "root",
        assistantMessageID: "msg_a1",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })

    expect(ctx.store.data.session_status.root).toEqual({ type: "busy" })
    expect(ctx.store.data.message.root?.[0]).toMatchObject({
      id: "msg_a1",
      role: "assistant",
      parentID: "",
      agent: "build",
      modelID: "model",
      providerID: "provider",
    })
  })

  test("stages and clears revert on session.next.revert events", () => {
    const ctx = setup({})
    created(ctx.store)

    ctx.store.apply({
      type: "session.next.revert.staged",
      properties: { timestamp: 70, sessionID: "root", revert: { messageID: "msg_1", partID: "prt_1" } },
    })

    expect(ctx.store.get("root")?.revert).toEqual({ messageID: "msg_1", partID: "prt_1" })

    ctx.store.apply({ type: "session.next.revert.cleared", properties: { timestamp: 71, sessionID: "root" } })

    expect(ctx.store.get("root")?.revert).toBeUndefined()
  })

  test("stores prompted prompts through the translator", () => {
    const ctx = setup({})
    created(ctx.store)

    ctx.store.apply({
      type: "session.next.prompted",
      properties: {
        timestamp: 10,
        sessionID: "root",
        messageID: "msg_u1",
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })

    expect(ctx.store.data.message.root?.[0]).toMatchObject({
      id: "msg_u1",
      role: "user",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    })
    expect(ctx.store.data.part.msg_u1).toEqual([
      { id: "msg_u1:text", sessionID: "root", messageID: "msg_u1", type: "text", text: "hello" },
    ])
  })

  test("stores compaction as a synthetic user with a compaction part", () => {
    const ctx = setup({})
    created(ctx.store)

    ctx.store.apply({
      type: "session.next.compaction.ended",
      properties: {
        timestamp: 20,
        sessionID: "root",
        messageID: "msg_c1",
        reason: "auto",
        text: "summary",
        recent: "recent",
      },
    })

    expect(ctx.store.data.message.root?.[0]).toMatchObject({ id: "msg_c1", role: "user" })
    expect(ctx.store.data.part.msg_c1).toEqual([
      { id: "msg_c1:compaction", sessionID: "root", messageID: "msg_c1", type: "compaction", auto: true },
    ])
  })

  test("reconciles session_status from the active set", async () => {
    const active = { data: { data: {} as Record<string, { type: "running" }> } }
    const client = {
      v2: {
        session: {
          get: async () => ({ data: undefined }),
          messages: async () => response(),
          diff: async () => ({ data: { data: [] } }),
          todo: async () => ({ data: { data: [] } }),
          active: async () => active,
        },
      },
    } as unknown as OpenNovelClient
    const store = createServerSession(client)
    store.apply({ type: "session.status", properties: { sessionID: "busy", status: { type: "busy" } } })
    store.apply({ type: "session.status", properties: { sessionID: "stale", status: { type: "busy" } } })
    store.apply({
      type: "session.next.retried",
      properties: { timestamp: 50, sessionID: "retry", attempt: 1, error: { message: "boom" } },
    })
    active.data.data = { busy: { type: "running" }, retry: { type: "running" }, fresh: { type: "running" } }

    await store.refreshActive()

    expect(store.data.session_status.busy).toEqual({ type: "busy" })
    expect(store.data.session_status.stale).toEqual({ type: "idle" })
    expect(store.data.session_status.retry).toEqual({ type: "retry", attempt: 1, message: "boom", next: 50 })
    expect(store.data.session_status.fresh).toEqual({ type: "busy" })
  })
})
