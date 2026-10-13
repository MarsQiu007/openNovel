import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT } from "../utils/waits"

const directory = "/home/user/SubagentSwitcher"
const novelID = "novel-e2e-subagent-switcher"
const mainID = "ses_subagent_switcher_main"
const childID = "ses_subagent_switcher_child"
const mainTitle = "Main writing session"
const childTitle = "Inspect chapter two continuity"
const now = Date.now()

const mockNovel = {
  id: novelID,
  title: "子代理切换走查",
  genre: "玄幻",
  synopsis: "subagent switcher e2e",
  status: "draft",
  createdAt: now,
  updatedAt: now,
  styleGuide: { id: "sg-sub", novelId: novelID, rules: {}, tone: "neutral", pov: "third", tense: "past" },
  stats: { chapterCount: 1, volumeCount: 1, characterCount: 0, wordCount: 100 },
}

const workspaceURL = `/${base64Encode(directory)}/novel/${novelID}`

async function openWorkspaceSession(page: Page, sessionID: string) {
  const sessions = [
    {
      id: mainID,
      slug: "main",
      projectID: "proj-subagent-switcher",
      directory,
      title: mainTitle,
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    {
      id: childID,
      slug: "child",
      projectID: "proj-subagent-switcher",
      directory,
      title: childTitle,
      version: "dev",
      time: { created: 1700000001000, updated: 1700000001000 },
      parentID: mainID,
    },
  ]
  await mockOpenNovelServer(page, {
    sessions,
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-subagent-switcher", directory },
    pageMessages: () => ({ items: [] }),
  })
  await page.route(/\/api\/novel/, async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === "GET" && (path === "/api/novel" || path === `/api/novel/${novelID}`))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([mockNovel]) })
    if (method === "GET" && path.endsWith("/volumes"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    if (method === "GET" && path.endsWith("/chapters"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "ch-sub-001", novelId: novelID, title: "第一章", order: 1, status: "drafting", wordCount: 100, createdAt: now, updatedAt: now },
        ]),
      })
    // 章节详情：编辑器统计字数依赖 content 字段，缺省会让 countWords 收到 undefined 崩溃
    if (method === "GET" && path.endsWith("/chapters/ch-sub-001"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "ch-sub-001",
          novelId: novelID,
          title: "第一章",
          order: 1,
          status: "drafting",
          content: "",
          wordCount: 0,
          createdAt: now,
          updatedAt: now,
        }),
      })
    if (path === "/api/novel/session-bindings")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { sessionID: mainID, novelID, novelTitle: mockNovel.title },
          { sessionID: childID, novelID, novelTitle: mockNovel.title },
        ]),
      })
    if (path.endsWith("/annotations"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })
  await page.route(/\/api\/sync\/run/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  )
  await page.goto(`${workspaceURL}/session/${sessionID}`, { waitUntil: "load" })
}

async function openSwitcherMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Novel sessions" })
  await expect(trigger).toBeVisible({ timeout: APP_READY_TIMEOUT })
  await trigger.click()
  const menu = page.locator('[data-component="menu-v2-content"]')
  await expect(menu).toBeVisible()
  return menu
}

test.use({ viewport: { width: 1440, height: 900 } })

test("switcher nests subagent sessions collapsed and opens them in-book", async ({ page }) => {
  await openWorkspaceSession(page, mainID)

  const menu = await openSwitcherMenu(page)
  // 顶层只列主会话，子代理默认折叠不可见
  await expect(menu.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()
  await expect(menu.getByRole("menuitemradio")).toHaveCount(1)
  await expect(menu.getByRole("menuitemradio", { name: childTitle })).toHaveCount(0)
  await expect(menu.locator('[data-action="novel-switcher-toggle-children"]')).toHaveCount(1)

  // 展开后子项可见，与主会话视觉区分（分支图标 + 斜体弱化 + 缩进）
  await menu.locator('[data-action="novel-switcher-toggle-children"]').click()
  const child = menu.getByRole("menuitemradio", { name: childTitle })
  await expect(child).toHaveCount(1)
  await expect(child.locator("span.italic")).toBeVisible()
  await expect(child.locator('use[href="#opennovel-v2-icon-branch"]')).toHaveCount(1)
  await expect(child).toHaveClass(/pl-10/)

  // 点击子项：书内打开子会话路由，prompt 禁用态生效
  await child.click()
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${childID}$`), { timeout: 15_000 })
  await expect(page.getByText("Subagent sessions cannot be prompted.")).toBeVisible()

  // 当前打开子会话时切换器触发器显示子会话标题，且下拉自动展开父收纳
  const trigger2 = page.getByRole("button", { name: "Novel sessions" })
  await expect(trigger2).toContainText(childTitle)
  // 选中导航后下拉可能保持展开（切换器既有行为，主会话切换相同），先收起再重开
  await page.keyboard.press("Escape")
  const reopened = await openSwitcherMenu(page)
  await expect(reopened.getByRole("menuitemradio", { name: childTitle })).toBeVisible()
  await expect(reopened.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()
})
