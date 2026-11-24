import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

type QueryOptions = { queryFn?: () => unknown }
type QueryFactory = () => QueryOptions

let useNovelDetail: typeof import("./novel-queries").useNovelDetail
let useNovelForSession: typeof import("./novel-queries").useNovelForSession
const sdk = () => ({ directory: "D:/project" })

function isQueryResult(value: unknown): value is { options?: QueryFactory } {
  return typeof value === "object" && value !== null && "options" in value
}

function queryFromHook(hook: () => unknown) {
  let query: { options?: QueryFactory } | undefined
  const dispose = createRoot((dispose) => {
    const result = hook()
    if (isQueryResult(result)) query = result
    return dispose
  })
  const factory = query?.options
  if (!factory) throw new Error("createQuery options required")
  return { options: [factory()], dispose }
}
const novelNotFound = new Error("Request failed", {
  cause: {
    status: 404,
    body: {
      name: "NovelNotFoundError",
      data: { message: "小说不存在", novelId: "nov_missing" },
    },
  },
})
const serverError = new Error("Request failed", {
  cause: {
    status: 500,
    body: { name: "ServerError", data: { message: "database unavailable" } },
  },
})
const calls: Array<{ method: string; input: Record<string, unknown> }> = []
let detailError: Error | undefined

beforeAll(async () => {
  mock.module("@tanstack/solid-query", () => ({
    createQuery: (options: QueryFactory) => ({ options, data: undefined, error: undefined, isLoading: false }),
    keepPreviousData: undefined,
    useMutation: () => ({}),
    useQueryClient: () => ({}),
  }))
  mock.module("./sdk", () => ({ useSDK: () => sdk }))
  mock.module("./server-sdk", () => ({
    useServerSDK: () => () => ({ server: { http: { username: "", password: "" } }, url: "http://localhost" }),
  }))
  mock.module("@opennovel-ai/client", () => ({
    OpenNovel: {
      make: () => ({
        "server.novel": {
          detail: async (input: Record<string, unknown>) => {
            calls.push({ method: "detail", input })
            throw detailError ?? novelNotFound
          },
          "for-session": async (input: Record<string, unknown>) => {
            calls.push({ method: "for-session", input })
            throw novelNotFound
          },
        },
      }),
    },
  }))
  mock.module("@/utils/server", () => ({ authTokenFromCredentials: () => undefined }))
  mock.module("@/utils/v2-adapter", () => ({ adaptInfo: (value: unknown) => value }))

  const novelQueries = await import("./novel-queries")
  useNovelDetail = novelQueries.useNovelDetail
  useNovelForSession = novelQueries.useNovelForSession
})

describe("novel queries", () => {
  test("normalizes detail NotFound as an empty success state", async () => {
    calls.length = 0
    const { options, dispose } = queryFromHook(() => useNovelDetail(() => "nov_missing"))
    try {
      const queryFn = options[0]?.queryFn
      if (!queryFn) throw new Error("queryFn required")
      await expect(queryFn()).resolves.toBeNull()
      expect(calls).toEqual([
        { method: "detail", input: { novelID: "nov_missing", location: { directory: "D:/project" } } },
      ])
    } finally {
      dispose()
    }
  })

  test("normalizes for-session NotFound as no binding", async () => {
    calls.length = 0
    const { options, dispose } = queryFromHook(() => useNovelForSession(() => "ses_missing"))
    try {
      const queryFn = options[0]?.queryFn
      if (!queryFn) throw new Error("queryFn required")
      await expect(queryFn()).resolves.toBeNull()
      expect(calls).toEqual([
        { method: "for-session", input: { sessionID: "ses_missing", location: { directory: "D:/project" } } },
      ])
    } finally {
      dispose()
    }
  })

  test("keeps non-404 detail errors unchanged", async () => {
    detailError = serverError
    calls.length = 0
    const { options, dispose } = queryFromHook(() => useNovelDetail(() => "nov_missing"))
    try {
      const queryFn = options[0]?.queryFn
      if (!queryFn) throw new Error("queryFn required")
      await expect(queryFn()).rejects.toBe(serverError)
    } finally {
      detailError = undefined
      dispose()
    }
  })
})
