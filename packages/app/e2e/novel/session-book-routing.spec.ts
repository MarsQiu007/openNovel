import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs } from "../utils/novel-workspace"
import { expectSessionTitle } from "../utils/waits"

// session-book-only 会话宿主收敛回归：
// - 书架（/sessions）小说分组侧栏的会话行点击后落在书籍工作台对话面板（任务 2.3）
// - 历史独立会话路由深链：绑定会话 replace 进书内；未绑定遗留会话降级书架并提示（任务 4.1）
const directory = "/home/user/BookRouting"
const novelID = "novel-e2e-book-routing"
const boundID = "ses_book_routing_bound"
const orphanID = "ses_book_routing_orphan"
const boundTitle = "Bound book session"
const orphanTitle = "Legacy free session"
const serverKey = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("bookshelf session row opens the session in the book workspace", async ({ page }) => {
  await setup(page)
  await page.goto("/sessions")

  const row = page.locator('[data-component="novel-sidebar-session"]').first()
  await expect(row).toBeVisible()
  await expect(row).toContainText(boundTitle)
  await row.click()

  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${boundID}$`), { timeout: 15_000 })
  await expectSessionTitle(page, boundTitle)
})

test("legacy deep link redirects a bound session into its book workspace", async ({ page }) => {
  await setup(page)
  await page.goto(`/server/${base64Encode(serverKey)}/session/${boundID}`)

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
    pageMessages: () => ({ items: [] }),
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
