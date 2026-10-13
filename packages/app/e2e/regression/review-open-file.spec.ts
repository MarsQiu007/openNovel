import { expect, test } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectSessionTitle } from "../utils/waits"

// 独立会话路由已退役为重定向宿主（session-book-only）：检视面板随 SessionPage
// 嵌在书籍工作台右栏对话面板，本 spec 直接在工作台路由上验证文件打开/搜索。
const directory = "C:/OpenNovel/ReviewOpenFile"
const novelID = "novel_review_open_file"
const projectID = "proj_review_open_file"
const sessionID = "ses_review_open_file"
const title = "Review open file"

test.use({ viewport: { width: 1440, height: 900 } })

test("opens and searches project files inline", async ({ page }) => {
  const searches: { query: string; dirs?: string; limit?: number }[] = []
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "open-file-project",
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
    vcsDiff: [fileDiff("src/changed.ts")],
    fileList: (path) => {
      if (path) return []
      return [
        fileNode("README.md"),
        { name: "src", path: "src", absolute: `${directory}/src`, type: "directory", ignored: false },
      ]
    },
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    findFiles: (input) => {
      searches.push(input)
      return input.query === "nested" ? ["src/nested.ts"] : []
    },
    pageMessages: () => ({ items: [] }),
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
  await page.addInitScript(
    ({ directory, sessionID }) => {
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
        JSON.stringify({ sidebarOpened: false, sidebarWidth: 240, expandMode: "collapse" }),
      )
      // 会话页嵌在右栏：拉宽对话面板以接近旧独立页的可用宽度
      localStorage.setItem(
        "opennovel.global.dat:novel.workspace.layout.v1",
        JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
      )
    },
    { directory, sessionID },
  )

  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
  const sidebarToggle = panel.getByRole("button", { name: "Toggle file tree" })
  const contextButton = page.getByRole("button", { name: "View context usage" })
  await contextButton.click()
  await expect(panel.getByRole("tab", { name: "Context" })).toHaveAttribute("data-selected", "")
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeDisabled()
  await expect(sidebar).toBeVisible()
  await contextButton.click()
  await expect(panel.getByRole("tab", { name: "Context" })).toHaveAttribute("data-selected", "")
  await expect(sidebar).toBeHidden()
  await panel.getByRole("button", { name: "Open file" }).click()
  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await expect(filter).toBeFocused()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("open-file-project", { exact: true })).toBeVisible()

  await panel.getByRole("button", { name: "README.md" }).click()
  await expect(panel.getByRole("tab", { name: "README.md" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
  await expect(sidebar).toHaveCount(0)

  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "README.md" })).toHaveCount(0)
  await expect(sidebar).toBeVisible()
  await filter.fill("nested")
  const result = panel.getByRole("option", { name: /nested\.ts/ })
  await expect(result).toBeVisible()
  const resultID = await result.getAttribute("id")
  expect(resultID).toBeTruthy()
  await expect(filter).toHaveAttribute("aria-activedescendant", resultID!)
  await filter.press("Enter")
  await expect(panel.getByRole("tab", { name: "nested.ts" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:src/nested.ts", { exact: true })).toBeVisible()
  expect(searches).toContainEqual({ query: "nested", dirs: "false", limit: 200 })

  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "nested.ts" })).toHaveCount(1)
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeDisabled()
  await panel.getByRole("tab", { name: /Review/ }).click()
  await expect(sidebarToggle).toBeEnabled()
  await panel.getByRole("tab", { name: "Open file" }).click()
  await page.keyboard.press("Control+w")
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveCount(0)
  await expect(panel.getByRole("tab", { name: "nested.ts" })).toHaveAttribute("data-selected", "")
})

function fileNode(path: string) {
  return {
    name: path,
    path,
    absolute: `${directory}/${path}`,
    type: "file",
    ignored: false,
  }
}

function fileDiff(file: string) {
  return {
    file,
    before: "before\n",
    after: "after\n",
    additions: 1,
    deletions: 1,
    status: "modified",
  }
}
