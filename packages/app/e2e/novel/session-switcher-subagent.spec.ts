import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer, type MockSession } from "../utils/mock-server"
import { installSseTransport, type SseTransport } from "../utils/sse-transport"
import { v2Event, type V2SseFrame } from "../utils/v2-fixture"
import { APP_READY_TIMEOUT } from "../utils/waits"

const directory = "/home/user/SubagentSwitcher"
const novelID = "novel-e2e-subagent-switcher"
const mainID = "ses_subagent_switcher_main"
const childID = "ses_subagent_switcher_child"
const grandchildID = "ses_subagent_switcher_grandchild"
const mainTitle = "Main writing session"
const childTitle = "Inspect chapter two continuity"
const grandchildTitle = "Verify grandchild nesting"
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

function mainSession(): MockSession {
  return {
    id: mainID,
    slug: "main",
    projectID: "proj-subagent-switcher",
    directory,
    title: mainTitle,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function childSession(): MockSession {
  return {
    id: childID,
    slug: "child",
    projectID: "proj-subagent-switcher",
    directory,
    title: childTitle,
    version: "dev",
    time: { created: 1700000001000, updated: 1700000001000 },
    parentID: mainID,
  }
}

function grandchildSession(): MockSession {
  return {
    id: grandchildID,
    slug: "grandchild",
    projectID: "proj-subagent-switcher",
    directory,
    title: grandchildTitle,
    version: "dev",
    time: { created: 1700000002000, updated: 1700000002000 },
    parentID: childID,
  }
}

async function openWorkspaceSession(
  page: Page,
  sessionID: string,
  options?: {
    sessions?: MockSession[]
    boundSessionIDs?: string[]
    v2Active?: Record<string, unknown> | (() => Record<string, unknown>)
  },
) {
  await mockOpenNovelServer(page, {
    sessions: options?.sessions ?? [mainSession(), childSession()],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-subagent-switcher", directory },
    v2Active: options?.v2Active,
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
        body: JSON.stringify(
          (options?.boundSessionIDs ?? [mainID, childID]).map((boundID) => ({
            sessionID: boundID,
            novelID,
            novelTitle: mockNovel.title,
          })),
        ),
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

test("switcher shows subagent sessions expanded by default and opens them in-book", async ({ page }) => {
  await openWorkspaceSession(page, mainID)

  const menu = await openSwitcherMenu(page)
  // 默认展开：打开下拉即见主会话与子代理，无需先点展开控件
  await expect(menu.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: childTitle })).toBeVisible()
  await expect(menu.getByRole("menuitemradio")).toHaveCount(2)
  await expect(menu.locator('[data-action="novel-switcher-toggle-children"]')).toHaveCount(1)

  // 手动收起保持收起
  await menu.locator('[data-action="novel-switcher-toggle-children"]').click()
  await expect(menu.getByRole("menuitemradio", { name: childTitle })).toHaveCount(0)
  await expect(menu.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()

  // 再次展开：子项可见，与主会话视觉区分（分支图标 + 斜体弱化 + 缩进）
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

  // 当前打开子会话时切换器触发器显示子会话标题；重开后下拉保持展开
  const trigger2 = page.getByRole("button", { name: "Novel sessions" })
  await expect(trigger2).toContainText(childTitle)
  await page.keyboard.press("Escape")
  const reopened = await openSwitcherMenu(page)
  await expect(reopened.getByRole("menuitemradio", { name: childTitle })).toBeVisible()
  await expect(reopened.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()

  // 活动位置不被手动收起遮挡：当前会话在主会话子树中，点击收起控件不隐藏活动条目
  await reopened.locator('[data-action="novel-switcher-toggle-children"]').click()
  await expect(reopened.getByRole("menuitemradio", { name: childTitle })).toBeVisible()
  await expect(reopened.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()
})

test("switcher shows nested grandchildren expanded by default and lists subagents without own binding rows", async ({ page }) => {
  // 仅主会话持有绑定行：子代理（含孙级）自身无绑定行，仍应照常收录并嵌套展示
  await openWorkspaceSession(page, mainID, {
    sessions: [mainSession(), childSession(), grandchildSession()],
    boundSessionIDs: [mainID],
  })

  const menu = await openSwitcherMenu(page)
  // 默认展开到孙级：两级子代理均无需手动展开
  await expect(menu.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: childTitle })).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: grandchildTitle })).toBeVisible()
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3)
  const toggles = menu.locator('[data-action="novel-switcher-toggle-children"]')
  await expect(toggles).toHaveCount(2)

  // 手动收起一级子代理：孙级隐藏，子代理行保留
  await toggles.nth(1).click()
  await expect(menu.getByRole("menuitemradio", { name: grandchildTitle })).toHaveCount(0)
  await expect(menu.getByRole("menuitemradio", { name: childTitle })).toBeVisible()

  // 重新展开：孙级可见，嵌套缩进递增且与主会话视觉区分
  await toggles.nth(1).click()
  const grandchild = menu.getByRole("menuitemradio", { name: grandchildTitle })
  await expect(grandchild).toBeVisible()
  await expect(grandchild.locator("span.italic")).toBeVisible()
  await expect(grandchild.locator('use[href="#opennovel-v2-icon-branch"]')).toHaveCount(1)

  // 点击孙级：书内打开孙级会话路由，prompt 禁用态生效
  await grandchild.click()
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${grandchildID}$`), { timeout: 15_000 })
  await expect(page.getByText("Subagent sessions cannot be prompted.")).toBeVisible()

  // 当前打开孙级：触发器显示孙级标题，重开后祖先链展开（孙级与父级均可见）
  const trigger = page.getByRole("button", { name: "Novel sessions" })
  await expect(trigger).toContainText(grandchildTitle)
  await page.keyboard.press("Escape")
  const reopened = await openSwitcherMenu(page)
  await expect(reopened.getByRole("menuitemradio", { name: grandchildTitle })).toBeVisible()
  await expect(reopened.getByRole("menuitemradio", { name: childTitle })).toBeVisible()
})

test("switcher marks running subagents and clears the indicator when they finish", async ({ page }) => {
  // busy/idle 在 V2 无状态推送：v2Active 闭包翻转 + session.next.* 事件触发的 active 对账
  let childBusy = true
  const transport = await installSseTransport<V2SseFrame>(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: 20,
  })
  await openWorkspaceSession(page, mainID, {
    v2Active: () => ({ [mainID]: { busy: true }, ...(childBusy ? { [childID]: { busy: true } } : {}) }),
  })

  const menu = await openSwitcherMenu(page)
  // 运行中的子代理带行内指示；主会话运行不显示（指示是子代理专属标记）
  const dots = menu.locator('[data-action="novel-switcher-working-dot"]')
  await expect(dots).toHaveCount(1)
  await expect(menu.getByRole("menuitemradio", { name: childTitle }).locator('[data-action="novel-switcher-working-dot"]')).toBeVisible()

  // 时间线上方横条同步出现：列出运行中子代理（标题 + 运行指示）
  const bar = page.locator('[data-action="active-subagent-bar"]')
  const entry = page.locator('[data-action="active-subagent-entry"]')
  await expect(bar).toBeVisible()
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText(childTitle)

  // 收起下拉后点击横条条目：进入子会话查看输出
  await page.keyboard.press("Escape")
  await entry.click()
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${childID}$`), { timeout: 15_000 })
  await expect(page.getByText("Subagent sessions cannot be prompted.")).toBeVisible()
  // 子会话无直接子代理：不渲染横条
  await expect(page.locator('[data-action="active-subagent-bar"]')).toHaveCount(0)

  // 子代理结束：指示消失（无需刷新），切回主会话后横条整体消失
  childBusy = false
  await transport.send(
    v2Event(directory, "session.next.step.ended", {
      timestamp: Date.now(),
      sessionID: childID,
      assistantMessageID: "msg_sub_switcher_end",
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )
  const reopened = await openSwitcherMenu(page)
  await expect(reopened.locator('[data-action="novel-switcher-working-dot"]')).toHaveCount(0)
  await reopened.getByRole("menuitemradio", { name: mainTitle }).click()
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${mainID}$`), { timeout: 15_000 })
  await expect(page.locator('[data-action="active-subagent-bar"]')).toHaveCount(0)
})
