import type { Page, Route } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"

/**
 * 书籍工作台 e2e 公共 mock 工具（session-book-only）：独立会话路由退役后，
 * 会话页宿主统一为 `/:dir/novel/:novelID/session/:id`，这些 spec 直接在
 * 工作台路由上导航，需要额外 mock 小说 API 系列（/api/novel*、/api/sync/run）。
 */

/** 工作台路由（书内会话面板）URL 构造 */
export function novelWorkspaceURL(directory: string, novelID: string, sessionID?: string) {
  const base = `/${base64Encode(directory)}/novel/${novelID}`
  return sessionID ? `${base}/session/${sessionID}` : base
}

export type NovelWorkspaceMockInput = {
  directory: string
  novelID: string
  novelTitle?: string
  /** 绑定到该书的会话（session-bindings 返回项的 sessionID 列表） */
  boundSessionIDs?: string[]
  /** 章节列表条数；>0 时补章节详情 mock（编辑器字数统计依赖 content 字段，缺省会崩） */
  chapterCount?: number
}

/**
 * 注册小说 API 路由。需在 mockOpenNovelServer 之后调用——Playwright 后注册的
 * 路由优先匹配，覆盖其 /api/novel 空列表兜底。
 */
export async function mockNovelWorkspaceAPIs(page: Page, input: NovelWorkspaceMockInput) {
  const now = Date.now()
  const title = input.novelTitle ?? "E2E 走查书籍"
  const novel = {
    id: input.novelID,
    title,
    genre: "玄幻",
    synopsis: "novel workspace e2e",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    styleGuide: {
      id: `sg-${input.novelID}`,
      novelId: input.novelID,
      rules: {},
      tone: "neutral",
      pov: "third",
      tense: "past",
    },
    stats: {
      chapterCount: input.chapterCount ?? 0,
      volumeCount: 0,
      characterCount: 0,
      wordCount: 0,
    },
  }
  const chapters = Array.from({ length: input.chapterCount ?? 0 }, (_, index) => ({
    id: `ch-e2e-${String(index + 1).padStart(3, "0")}`,
    novelId: input.novelID,
    title: `第${index + 1}章`,
    order: index + 1,
    status: "drafting",
    wordCount: 0,
    createdAt: now,
    updatedAt: now,
  }))
  await page.route(/\/api\/novel/, async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === "GET" && (path === "/api/novel" || path === `/api/novel/${input.novelID}`))
      return json(route, [novel])
    if (method === "GET" && path.endsWith("/volumes")) return json(route, [])
    if (method === "GET" && path.endsWith("/chapters")) return json(route, chapters)
    if (method === "GET" && /\/chapters\/[^/]+$/.test(path))
      return json(route, { ...chapters[0], content: "", wordCount: 0 })
    if (path === "/api/novel/session-bindings")
      return json(
        route,
        (input.boundSessionIDs ?? []).map((sessionID) => ({
          sessionID,
          novelID: input.novelID,
          novelTitle: title,
        })),
      )
    if (path.endsWith("/annotations")) return json(route, [])
    return json(route, [])
  })
  await page.route(/\/api\/sync\/run/, async (route) => json(route, { results: [] }))
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}
