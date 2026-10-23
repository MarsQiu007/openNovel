import type { Page, Route } from "@playwright/test"
import type { SessionMessage } from "@opennovel-ai/sdk/v2/client"

const emptyList = new Set([
  "/skill",
  "/command",
  "/lsp",
  "/formatter",
  "/vcs/status",
  "/vcs/diff",
  "/api/novel",
  "/api/novel/session-bindings",
])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/experimental/resource"])

export type MockSession = { id: string } & Record<string, unknown>

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  /** 会话列表；可传函数以支持会后变更（如归档后从 /api/session 列表消失） */
  sessions: MockSession[] | (() => MockSession[])
  /** V2 消息历史（升序）；/api/session/{id}/message 分页与 /{mid} 单条共用它 */
  v2Messages?: (sessionID: string) => SessionMessage[]
  onV2Messages?: (input: { sessionID: string; cursor?: string; phase: "start" | "end" }) => void
  beforeV2MessagesResponse?: (input: { sessionID: string; cursor?: string }) => Promise<void>
  v2Todos?: (sessionID: string) => unknown[]
  v2Permissions?: unknown[] | (() => unknown[])
  v2Questions?: unknown[] | (() => unknown[])
  v2Diff?: unknown[]
  /** PATCH /api/session/{id}（归档/改题）时回调，供测试更新会话列表状态 */
  onV2SessionUpdate?: (sessionID: string, body: { title?: string; time?: { archived?: number | null } }) => void
  /** question/permission 回复 POST 捕获，供 spec 断言请求体 */
  onV2Reply?: (input: { kind: "question" | "permission"; sessionID: string; requestID: string; body: unknown }) => void
  events?: () => unknown[]
  eventRetry?: number
  vcsDiff?: unknown[]
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
}

export async function mockOpenNovelServer(page: Page, config: MockServerConfig) {
  // The app defaults to the dark scheme, but e2e fixtures were written against the
  // light scheme. Pin the scheme before the app loads so tests are deterministic;
  // tests that assert a specific scheme override this via their own init scripts.
  await page.addInitScript(() => {
    localStorage.setItem("opennovel-color-scheme", "light")
  })
  const cursors = new Map<string, string>()
  let nextCursor = 0
  const createdSessions: MockSession[] = []
  const staticRoutes: Record<string, unknown> = {
    "/provider": config.provider,
    "/path": {
      state: config.directory,
      config: config.directory,
      worktree: config.directory,
      directory: config.directory,
      home: "C:/OpenNovel",
    },
    "/project": [config.project],
    "/project/current": config.project,
    "/vcs": { branch: "main", default_branch: "main" },
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.port !== targetPort && url.port !== appPort) return route.fallback()

    const path = url.pathname
    const method = route.request().method()
    if (path === "/global/event" || path === "/event") return sse(route, config.events?.(), config.eventRetry)
    if (path === "/global/health") return json(route, { healthy: true })
    if (path === "/api/session" && method === "POST") {
      // 懒创建流（如 novel journey）：登记进会话列表，后续 GET /api/session/{id} 才能命中
      const body = (route.request().postDataJSON() ?? {}) as MockSession
      const session = { title: body.id ?? "session", ...body, id: body.id ?? `ses_mock_${++nextCursor}` }
      createdSessions.push(session)
      return json(route, { data: v2Session(session, config.directory) })
    }
    if (path === "/api/session")
      return json(route, {
        data: currentSessions(config, createdSessions).map((session) => v2Session(session, config.directory)),
        cursor: {},
      })
    // app 启动固定读取面：空信封而非 404——smoke 断言把任何 404 资源错误计为失败
    if (path === "/api/session/active") return json(route, { data: {} })
    if (path === "/api/agent") return json(route, { data: [] })
    if (path === "/api/command") return json(route, { data: [] })
    if (path === "/experimental/capabilities") return json(route, { backgroundSubagents: false })
    if (path === "/api/permission/request")
      return json(route, {
        location: { directory: config.directory },
        data: typeof config.v2Permissions === "function" ? config.v2Permissions() : (config.v2Permissions ?? []),
      })
    if (path === "/api/question/request")
      return json(route, {
        location: { directory: config.directory },
        data: typeof config.v2Questions === "function" ? config.v2Questions() : (config.v2Questions ?? []),
      })
    if (path === "/vcs/diff" && config.vcsDiff) return json(route, config.vcsDiff)
    if (path === "/file" && config.fileList)
      return json(route, await config.fileList(url.searchParams.get("path") ?? ""))
    if (path === "/file/content" && config.fileContent)
      return json(route, await config.fileContent(url.searchParams.get("path") ?? ""))
    if (path === "/find/file" && config.findFiles)
      return json(
        route,
        await config.findFiles({
          query: url.searchParams.get("query") ?? "",
          dirs: url.searchParams.get("dirs") ?? undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        }),
      )
    if (path === "/api/reference")
      return json(route, {
        location: {
          directory: config.directory,
          project: { id: (config.project as { id?: string }).id, directory: config.directory },
        },
        data: [],
      })
    if (path === "/api/novel/session-bindings" || path === "/api/technique" || path.endsWith("/annotations")) {
      return json(route, [])
    }
    if (path === "/api/sync/run") return json(route, { results: [] })
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])

    const projectMatch = path.match(/^\/project\/([^/]+)$/)
    if (projectMatch) return json(route, config.project)

    const replyMatch = path.match(/^\/api\/session\/([^/]+)\/(question|permission)\/([^/]+)\/reply$/)
    if (replyMatch && method === "POST") {
      config.onV2Reply?.({
        kind: replyMatch[2] as "question" | "permission",
        sessionID: replyMatch[1]!,
        requestID: replyMatch[3]!,
        body: route.request().postDataJSON(),
      })
      return json(route, { data: {} })
    }

    const messageMatch = path.match(/^\/api\/session\/([^/]+)\/message\/([^/]+)$/)
    if (messageMatch) {
      const message = (config.v2Messages?.(messageMatch[1]!) ?? []).find((item) => item.id === messageMatch[2])
      if (!message) return json(route, { error: "Message not found" }, undefined, 404)
      return json(route, { data: message })
    }

    const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const sessionID = messagesMatch[1]!
      const token = url.searchParams.get("cursor") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onV2Messages?.({ sessionID, cursor: before, phase: "start" })
      await config.beforeV2MessagesResponse?.({ sessionID, cursor: before })
      const all = config.v2Messages?.(sessionID) ?? []
      const ordered = url.searchParams.get("order") === "desc" ? [...all].reverse() : all
      const start = before ? ordered.findIndex((item) => item.id === before) + 1 : 0
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const pageItems = ordered.slice(start, start + limit)
      const last = pageItems[pageItems.length - 1]
      const hasMore = start + limit < ordered.length && last !== undefined
      const cursor = hasMore ? `cursor_${++nextCursor}` : undefined
      if (cursor && last) cursors.set(cursor, last.id)
      config.onV2Messages?.({ sessionID, cursor: before, phase: "end" })
      return json(route, { data: pageItems, cursor: cursor ? { next: cursor } : {} })
    }

    const todoMatch = path.match(/^\/api\/session\/([^/]+)\/todo$/)
    if (todoMatch) return json(route, { data: config.v2Todos?.(todoMatch[1]!) ?? [] })

    const diffMatch = path.match(/^\/api\/session\/([^/]+)\/diff$/)
    if (diffMatch) return json(route, { data: config.v2Diff ?? [] })

    const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
    if (sessionMatch) {
      const sessionID = sessionMatch[1]!
      if (method === "PATCH") {
        const body = route.request().postDataJSON() as { title?: string; time?: { archived?: number | null } }
        config.onV2SessionUpdate?.(sessionID, body)
        const session = currentSessions(config, createdSessions).find((item) => item.id === sessionID)
        return json(route, { data: v2Session(session ?? { id: sessionID }, config.directory) })
      }
      const session = currentSessions(config, createdSessions).find((item) => item.id === sessionID)
      if (!session) return json(route, { error: "Session not found" }, undefined, 404)
      return json(route, { data: v2Session(session, config.directory) })
    }

    // 显式 404：未 mock 的 server 路由不再返回 {} 静默吞错（消息两路由与 x.data! 消费者已在上游覆盖）
    if (url.port === targetPort && targetPort !== appPort)
      return json(route, { error: "Not mocked", path }, undefined, 404)
    return route.fallback()
  })
}

/** 读取会话列表当前值（支持函数形态以便测试内变更后重查；含 POST 懒创建的会话） */
function currentSessions(config: MockServerConfig, created: MockSession[] = []): MockSession[] {
  const base = typeof config.sessions === "function" ? config.sessions() : config.sessions
  return [...base, ...created]
}

function v2Session(session: { id: string } & Record<string, unknown>, fallbackDirectory: string) {
  const time = session.time && typeof session.time === "object" ? session.time : {}
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: "created" in time && typeof time.created === "number" ? time.created : 0,
      updated: "updated" in time && typeof time.updated === "number" ? time.updated : 0,
      ...(session.time && typeof session.time === "object" && "archived" in session.time
        ? { archived: session.time.archived }
        : {}),
    },
    title: session.title ?? session.id,
    location: {
      directory: typeof session.directory === "string" ? session.directory : fallbackDirectory,
      ...(typeof session.workspaceID === "string" ? { workspaceID: session.workspaceID } : {}),
    },
    ...(typeof session.path === "string" ? { subpath: session.path } : {}),
  }
}

function json(route: Route, body: unknown, headers?: Record<string, string>, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}
