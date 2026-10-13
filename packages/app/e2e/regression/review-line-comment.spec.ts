import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenNovel/ReviewLineCommentRegression"
const novelID = "novel_review_line_comment"
const sessionID = "ses_review_line_comment_regression"
const title = "Review line comment regression"

test.beforeEach(async ({ page }) => {
  await openReview(page)
})

test("opens the comment editor when code is clicked", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const line = review.getByText("export const value = 'after'", { exact: true })
  await expectAppVisible(line)
  await line.click()

  await expect(review.getByRole("textbox")).toBeVisible()
})

test("opens the comment editor when a line number is clicked", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const lineNumber = review.locator('[data-column-number="1"]').last()
  await expectAppVisible(lineNumber)
  await lineNumber.click()

  await expect(review.getByRole("textbox")).toBeVisible()
})

test("opens the comment editor for a line number range", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const start = review.locator('[data-column-number="1"]').last()
  const end = review.locator('[data-column-number="3"]').last()

  // 拖拽期间行号节点可能因重渲染脱靶导致 boundingBox 为 null，整体重试。
  await expect(async () => {
    await page.mouse.up()
    await expectAppVisible(start)
    await expectAppVisible(end)
    const from = await start.boundingBox()
    const to = await end.boundingBox()
    if (!from || !to) throw new Error("Missing line number bounds")
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
    await page.mouse.up()
    await expect(review.getByRole("textbox")).toBeVisible({ timeout: 500 })
  }).toPass()
})

test("shows a comment button when a line number is hovered", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const lineNumber = review.locator('[data-column-number="1"]').last()
  await expectAppVisible(lineNumber)

  const comment = review.getByRole("button", { name: "Comment", exact: true })
  await expect(async () => {
    await page.mouse.move(0, 0)
    await lineNumber.hover()
    await expect(comment).toBeVisible({ timeout: 500 })
    await comment.click({ timeout: 500 })
  }).toPass()
  await expect(review.getByRole("textbox")).toBeVisible()
})

test("stages a submitted line comment in the prompt context", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "GET") requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
  })

  const review = page.locator('[data-component="session-review"]')
  await review.getByText("export const value = 'after'", { exact: true }).click()
  await review.getByRole("textbox").fill("Use the existing value instead")
  await review.locator('[data-slot="line-comment-action"][data-variant="primary"]').click()

  await expect(review.getByText("Use the existing value instead", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Session" }).click()
  const context = page.getByText("Use the existing value instead", { exact: true }).last()
  await expect(context).toBeVisible()
  await expect(context.locator("..")).toContainText("review.ts:2")
  expect(requests).toEqual([])
})

async function openReview(page: Page) {
  // 会话页嵌入工作台右栏（session-book-only）：保持 <768px 以走移动端布局（Session/Changes 页签），
  // 宽度取 760 为左栏+右栏对话面板留出余量
  await page.setViewportSize({ width: 760, height: 900 })
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: "proj_review_line_comment_regression",
      worktree: directory,
      vcs: "git",
      name: "review-line-comment-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "review-line-comment-regression",
        projectID: "proj_review_line_comment_regression",
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    vcsDiff: [
      {
        file: "src/review.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch:
          "diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@ -1,3 +1,3 @@\n export const first = 1\n-export const value = 'before'\n+export const value = 'after'\n export const last = 3\n",
      },
    ],
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_review_line_comment_regression",
            sessionID,
            role: "user",
            time: { created: 1700000000000 },
            summary: { diffs: [] },
            agent: "build",
            model: { providerID: "opennovel", modelID: "test" },
          },
          parts: [
            {
              id: "prt_review_line_comment_regression",
              sessionID,
              messageID: "msg_review_line_comment_regression",
              type: "text",
              text: "Review this change.",
            },
          ],
        },
      ],
    }),
  })

  await page.addInitScript(() => {
    // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区；
    // 检视侧栏默认收起，需置为打开才能出现 Changes / All files 页签
    localStorage.setItem(
      "opennovel.global.dat:novel.workspace.layout.v1",
      JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
    )
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await expectSessionTitle(page, title)
  const diffResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/vcs/diff")
  await page.getByRole("tab", { name: "Changes" }).click()
  expect(await (await diffResponse).json()).toHaveLength(1)

  const review = page.locator('[data-component="session-review"]')
  await expectAppVisible(review)
  // 标题行为 Accordion 触发器，内部嵌套独立的 "Open file" 按钮（stopPropagation）；
  // 窄栏下行中心可能正好落在该按钮上导致 diff 不展开，改为点击文件名区域触发展开
  await review.locator('[data-slot="session-review-filename"]').first().click()
}
