import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectSessionTitle } from "../utils/waits"

// 独立会话路由已退役为重定向宿主（session-book-only）：检视面板随 SessionPage
// 嵌在书籍工作台右栏对话面板，本 spec 直接在工作台路由上验证文件侧栏保活。
const directory = "C:/OpenNovel/FileBrowserSidebar"
const novelID = "novel_file_browser_sidebar"
const projectID = "proj_file_browser_sidebar"
const sessionID = "ses_file_browser_sidebar"
const title = "File browser sidebar"
const files = Array.from({ length: 80 }, (_, index) => `file-${String(index).padStart(2, "0")}.ts`)
// Marks the file-browser sidebar DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// The file-browser sidebar must stay mounted across preview/pinned file-tab
// switches. Remounting resets scroll and filter state.
test("keeps the file-browser sidebar mounted when switching file tabs", async ({ page }) => {
  await setup(page)

  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")

  const sidebar = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  await expect(sidebar).toBeVisible()
  await expect(panel.getByRole("button", { name: "file-00.ts" })).toBeVisible()

  await panel.getByRole("button", { name: "file-00.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-00.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:file-00.ts", { exact: true })).toBeVisible()

  const viewport = panel.locator('[data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  const scrolled = await viewport.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await writeProbe(page)

  await panel.getByRole("button", { name: "file-79.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-79.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:file-79.ts", { exact: true })).toBeVisible()
  expect(await readProbe(page)).toBe(PROBE)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrolled)

  await panel.getByRole("button", { name: "file-78.ts" }).dblclick()
  await expect(panel.getByRole("tab", { name: "file-78.ts" })).toHaveAttribute("data-selected", "")
  await panel.getByRole("button", { name: "file-79.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-79.ts" })).toHaveAttribute("data-selected", "")
  await panel.getByRole("tab", { name: "file-78.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-78.ts" })).toHaveAttribute("data-selected", "")
  expect(await readProbe(page)).toBe(PROBE)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrolled)
})

type Probed = HTMLElement & { __e2eProbe?: string }

async function writeProbe(page: Page) {
  await page.locator('#review-panel [data-component="session-review-v2-sidebar-root"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page
    .locator('#review-panel [data-component="session-review-v2-sidebar-root"]')
    .evaluate((el) => (el as Probed).__e2eProbe)
}

async function setup(page: Page) {
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "file-browser-sidebar",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opennovel",
          name: "OpenNovel",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opennovel"],
      default: { providerID: "opennovel", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    vcsDiff: [],
    fileList: (path) => {
      if (path) return []
      return files.map((name) => ({
        name,
        path: name,
        absolute: `${directory}/${name}`,
        type: "file" as const,
        ignored: false,
      }))
    },
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    pageMessages: () => ({ items: [] }),
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })

  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opennovel.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opennovel.global.dat:layout",
        JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
      )
      localStorage.setItem(
        "opennovel.global.dat:review-panel-v2",
        JSON.stringify({ sidebarOpened: true, sidebarWidth: 240, expandMode: "collapse" }),
      )
      // 会话页嵌在右栏：拉宽对话面板以接近旧独立页的可用宽度
      localStorage.setItem(
        "opennovel.global.dat:novel.workspace.layout.v1",
        JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
      )
    },
    { directory, sessionID },
  )
}
