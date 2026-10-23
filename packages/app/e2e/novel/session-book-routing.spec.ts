import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs } from "../utils/novel-workspace"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

// session-book-only + retire-sessions-page 入口收敛回归：
// - 会话列表页退役：/sessions 旧链接降级重定向到书架，不渲染独立会话列表视图
// - 书架进入的书籍工作台对话面板显示绑定会话（原小说分组侧栏入口迁移）
// - 历史独立会话路由深链：绑定会话 replace 进书内；未绑定遗留会话降级书架并提示
// - 深链解析期间：重定向宿主呈现加载占位而非整屏空白（session-direct-nav）
const directory = "/home/user/BookRouting"
const novelID = "novel-e2e-book-routing"
const boundID = "ses_book_routing_bound"
const orphanID = "ses_book_routing_orphan"
const boundTitle = "Bound book session"
const orphanTitle = "Legacy free session"
const serverKey = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("bookshelf entry opens the bound session in the book workspace", async ({ page }) => {
  await setup(page)
  await page.goto("/")
  // 书架渲染（左栏项目行可见）后从书架进入书籍工作台：
  // 右栏对话面板自动回跳到绑定会话（原小说分组侧栏入口已随列表页退役）
  await expectAppVisible(page.locator('[data-component="home-project-row"]').first())

  await page.goto(`/${base64Encode(directory)}/novel/${novelID}`, { waitUntil: "load" })
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${boundID}$`), { timeout: 15_000 })
  await expectSessionTitle(page, boundTitle)
})

test("retired sessions page link falls back to the bookshelf", async ({ page }) => {
  await setup(page)
  await page.goto("/sessions")

  // 旧会话列表页链接降级为书架，不渲染独立会话列表视图
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expectAppVisible(page.locator('[data-component="home-project-row"]').first())
  await expect(page.locator('[data-component="novel-sidebar-session"]')).toHaveCount(0)
  await expect(page.locator('[data-action="novel-sidebar-new-chat"]')).toHaveCount(0)
})

test("legacy deep link redirects a bound session into its book workspace", async ({ page }) => {
  await setup(page)
  await page.goto(`/server/${base64Encode(serverKey)}/session/${boundID}`)

  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${boundID}$`), { timeout: 15_000 })
  await expectSessionTitle(page, boundTitle)
})

test("legacy deep link shows a loading placeholder while resolving", async ({ page }) => {
  await setup(page)
  const release = await holdSessionBindings(page)
  await page.goto(`/server/${base64Encode(serverKey)}/session/${boundID}`)

  // bindings 响应挂起期间：重定向宿主呈现全尺寸加载占位（无整屏空白），而非空渲染
  const loading = page.locator('[data-slot="session-redirect-loading"]')
  await expect(loading).toBeVisible()
  await expect(loading.locator('[data-component="spinner"]')).toBeVisible()
  const box = await loading.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThan(200)

  release()
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${boundID}$`), { timeout: 15_000 })
  await expectSessionTitle(page, boundTitle)
})

test("legacy deep link falls back to the shelf for an unbound session", async ({ page }) => {
  await setup(page)
  await page.goto(`/server/${base64Encode(serverKey)}/session/${orphanID}`)

  await expect(page.getByText("会话未绑定书籍")).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/$/)
})

async function setup(page: Page) {
  const base = {
    slug: "s",
    projectID: "proj-book-routing",
    directory,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
  await mockOpenNovelServer(page, {
    sessions: [
      { ...base, id: boundID, slug: "bound", title: boundTitle },
      { ...base, id: orphanID, slug: "orphan", title: orphanTitle },
    ],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-book-routing", directory },
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [boundID] })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opennovel.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, directory)
}

/** 挂起 /api/novel/session-bindings 响应；返回 release 放行到既有 mock 响应（后注册路由优先，fallback 回落） */
async function holdSessionBindings(page: Page) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  await page.route(
    (url) => url.pathname === "/api/novel/session-bindings",
    async (route) => {
      await gate
      await route.fallback()
    },
  )
  return release
}
