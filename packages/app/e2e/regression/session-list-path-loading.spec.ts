import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenNovelServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

test("shows loaded sessions before the directory path request resolves", async ({ page }) => {
  await mockOpenNovelServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
  })

  let releasePath!: () => void
  const pathBlocked = new Promise<void>((resolve) => {
    releasePath = resolve
  })
  await page.route("**/path?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("directory")) return route.fallback()
    await pathBlocked
    return route.fallback()
  })

  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opennovel.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  // retire-sessions-page：旧会话列表页链接降级为书架，且降级重定向不依赖 /path 请求返回
  await page.goto("/sessions")
  try {
    await page.waitForURL(/\/$/, { timeout: 15_000 })
    // 书架就绪（标题与项目列可见），且旧会话列表 UI 不渲染——降级重定向不依赖 /path 返回
    await expectAppVisible(page.getByText("Bookshelf").first())
    await expectAppVisible(page.locator('[data-component="home-project-row"]').first())
    await expect(page.locator('[data-action="novel-sidebar-new-chat"]')).toHaveCount(0)
  } finally {
    releasePath()
  }
})
