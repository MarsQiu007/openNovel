import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { Session } from "@opennovel-ai/sdk/v2/client"
import { createDirSyncContext } from "./directory-sync"

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_1",
  slug: "ses_1",
  projectID: "pro_1",
  directory: "D:/novels/book",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title: "t",
  version: "",
  time: { created: 1, updated: 1 },
  ...overrides,
})

const harness = (directory: string) => {
  const cache = new Map<string, Session>()
  const [store, setStore] = createStore({
    status: "ready",
    limit: 10,
    project: "pro_1",
    path: { directory },
    session: [] as Session[],
    config: {} as Record<string, unknown>,
  })
  const serverSync = {
    session: {
      get: (id: string) => cache.get(id),
      remember: (value: Session) => void cache.set(value.id, value),
      data: {},
      set: () => {},
      reconcile: () => {},
      sync: async () => {},
      evict: () => {},
      diff: { subscribe: () => () => {} },
      todo: { subscribe: () => () => {} },
      history: { subscribe: () => () => {} },
      optimistic: { add: () => {}, remove: () => {} },
    },
    child: () => [store, setStore],
    data: { project: [] },
    mcp: { toggle: () => {} },
  }
  const serverSDK = {
    client: {},
    createClient: () => ({ v2: { session: { list: async () => ({ data: { data: [] } }) } } }),
  }
  return createRoot(() =>
    createDirSyncContext(
      directory,
      serverSync as unknown as Parameters<typeof createDirSyncContext>[1],
      serverSDK as unknown as Parameters<typeof createDirSyncContext>[2],
    ),
  )
}

describe("createDirSyncContext session scoping", () => {
  test("matches forward-slash info in backslash scope", () => {
    const ctx = harness("D:\\novels\\book")
    ctx.session.remember(session())
    expect(ctx.session.get("ses_1")?.id).toBe("ses_1")
    expect(ctx.data.session).toHaveLength(1)
  })

  test("matches info in trailing-slash scope", () => {
    const ctx = harness("D:/novels/book/")
    ctx.session.remember(session())
    expect(ctx.session.get("ses_1")?.id).toBe("ses_1")
  })

  test("does not return sessions from a different directory", () => {
    const ctx = harness("D:/novels/other")
    ctx.session.remember(session())
    expect(ctx.session.get("ses_1")).toBeUndefined()
    expect(ctx.data.session).toHaveLength(0)
  })

  test("does not index sessions from a different directory", () => {
    const ctx = harness("D:\\novels\\other")
    ctx.session.remember(session({ directory: "D:/novels/book" }))
    expect(ctx.data.session).toHaveLength(0)
  })
})
