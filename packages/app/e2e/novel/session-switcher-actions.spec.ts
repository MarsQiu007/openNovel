import { expect, test, type Locator, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { APP_READY_TIMEOUT } from "../utils/waits"

// retire-sessions-page：归档/导出动作从已退役的会话列表页迁移到书内右栏切换器，
// 会话行内动作菜单提供级联归档（含子代理）与导出会话 JSON。
const directory = "/home/user/SwitcherActions"
const novelID = "novel-e2e-switcher-actions"
const mainID = "ses_switcher_actions_main"
const otherID = "ses_switcher_actions_other"
const childAID = "ses_switcher_actions_child_a"
const childBID = "ses_switcher_actions_child_b"
const mainTitle = "Main writing thread"
const otherTitle = "Plot discussion"
const childATitle = "Inspect continuity"
const childBTitle = "Audit pacing"
const now = Date.now()

type SessionRecord = { id: string } & Record<string, unknown>

async function setupWorkspace(page: Page) {
  // 归档状态在测试内变更：右栏切换器经 /api/session 拉取列表，归档后该会话应从列表消失
  const archived = new Set<string>()
  const all: SessionRecord[] = [
    { id: mainID, slug: "main", projectID: "proj-switcher-actions", directory, title: mainTitle, version: "dev", time: { created: now, updated: now } },
    { id: otherID, slug: "other", projectID: "proj-switcher-actions", directory, title: otherTitle, version: "dev", time: { created: now - 1_000, updated: now - 1_000 } },
    { id: childAID, slug: "child-a", projectID: "proj-switcher-actions", directory, title: childATitle, version: "dev", time: { created: now - 2_000, updated: now - 2_000 }, parentID: mainID },
    { id: childBID, slug: "child-b", projectID: "proj-switcher-actions", directory, title: childBTitle, version: "dev", time: { created: now - 3_000, updated: now - 3_000 }, parentID: mainID },
  ]
  await mockOpenNovelServer(page, {
    sessions: () => all.filter((session) => !archived.has(session.id)),
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-switcher-actions", directory },
    pageMessages: () => ({ items: [] }),
    onArchive: (sessionID) => archived.add(sessionID),
  })
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID,
    boundSessionIDs: [mainID, otherID, childAID, childBID],
  })
}

async function openSwitcherMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Novel sessions" })
  await expect(trigger).toBeVisible({ timeout: APP_READY_TIMEOUT })
  await trigger.click()
  const menu = page.locator('[data-component="menu-v2-content"]')
  await expect(menu).toBeVisible()
  return menu
}

/** 打开某个会话行的动作菜单（hover 显现行内「⋯」按钮，点击后取菜单内容） */
async function openRowActions(page: Page, menu: Locator, rowTitle: string) {
  const row = menu.locator("div.group\\/switcher-row").filter({ hasText: rowTitle })
  await row.hover()
  await row.locator('[data-action="novel-switcher-actions"]').click()
  const actions = page.locator('[data-component="menu-v2-content"]').last()
  await expect(actions).toBeVisible()
  return actions
}

test.use({ viewport: { width: 1440, height: 900 } })

test("archives the current session with cascade from the switcher row actions", async ({ page }) => {
  await setupWorkspace(page)
  await page.goto(novelWorkspaceURL(directory, novelID, mainID), { waitUntil: "load" })

  const menu = await openSwitcherMenu(page)
  const actions = await openRowActions(page, menu, mainTitle)
  await actions.locator('[data-action="novel-switcher-archive"]').click()

  // 含 2 个子代理：先确认级联归档
  const dialog = page.locator('[data-component="dialog-v2"]')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toContainText("2")
  await dialog.getByRole("button").last().click() // 确认按钮为危险样式，位于 dialog footer 末位（避免依赖中英文案）

  // 归档的是当前打开会话：面板导航回工作台并按既有规则自动回跳到剩余会话
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${otherID}$`), { timeout: 15_000 })
  await page.keyboard.press("Escape")
  const reopened = await openSwitcherMenu(page)
  await expect(reopened.getByRole("menuitemradio", { name: otherTitle })).toBeVisible()
  await expect(reopened.getByRole("menuitemradio", { name: mainTitle })).toHaveCount(0)
})

test("archives a single child session from the switcher row actions", async ({ page }) => {
  await setupWorkspace(page)
  await page.goto(novelWorkspaceURL(directory, novelID, childAID), { waitUntil: "load" })

  const menu = await openSwitcherMenu(page)
  await expect(menu.getByRole("menuitemradio", { name: childATitle })).toBeVisible()
  const actions = await openRowActions(page, menu, childATitle)
  // 子代理无后代：不弹确认框，直接归档
  await actions.locator('[data-action="novel-switcher-archive"]').click()

  // 当前打开的子会话被归档：面板自动回跳到父会话
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${mainID}$`), { timeout: 15_000 })
  await page.keyboard.press("Escape")
  const reopened = await openSwitcherMenu(page)
  await expect(reopened.getByRole("menuitemradio", { name: mainTitle })).toBeVisible()
  await expect(reopened.getByRole("menuitemradio", { name: childATitle })).toHaveCount(0)
  // 父会话仍保留其余子代理（默认收起，展开后可见）
  await reopened.locator('[data-action="novel-switcher-toggle-children"]').click()
  await expect(reopened.getByRole("menuitemradio", { name: childBTitle })).toBeVisible()
})

test("exports a session JSON from the switcher row actions", async ({ page }) => {
  await setupWorkspace(page)
  await page.goto(novelWorkspaceURL(directory, novelID, mainID), { waitUntil: "load" })

  const menu = await openSwitcherMenu(page)
  const actions = await openRowActions(page, menu, mainTitle)
  const downloadPromise = page.waitForEvent("download")
  await actions.locator('[data-action="novel-switcher-export"]').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe(`session-${mainID}.json`)
})