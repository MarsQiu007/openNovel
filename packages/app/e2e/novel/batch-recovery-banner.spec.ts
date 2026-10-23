import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL, type NovelWorkspaceMockInput } from "../utils/novel-workspace"

// agent-background-job-recovery D6：批量写作中断横幅
// - running 批量 + 发起会话不活跃（interrupted 派生）时工作台顶部出现横幅与进度
// - 「续跑」向批量绑定会话发送「继续批量写作」prompt 并跳转该会话
// - 「放弃」走 cancel 写面，记录转 cancelled 后横幅消失
const directory = "/home/user/BatchRecovery"
const novelID = "novel-e2e-batch-recovery"
const sessionID = "ses_batch_origin"

test.use({ viewport: { width: 1440, height: 900 } })

function batchRecord(overrides?: Record<string, unknown>) {
  return {
    novelId: novelID,
    sessionId: sessionID,
    startChapter: 3,
    total: 5,
    completed: 2,
    status: "running",
    interrupted: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  }
}

test("interrupted 批量任务在工作台顶部展示进度与续跑/放弃入口", async ({ page }) => {
  await setup(page, { writingBatch: () => batchRecord() })
  await page.goto(novelWorkspaceURL(directory, novelID), { waitUntil: "load" })

  const banner = page.locator('[data-slot="batch-recovery-banner"]')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await expect(banner).toContainText("批量写作中断")
  await expect(banner).toContainText("已完成 2/5 章")
})

test("running 但会话仍活跃（非 interrupted）时不展示横幅", async ({ page }) => {
  await setup(page, { writingBatch: () => batchRecord({ interrupted: false }) })
  await page.goto(novelWorkspaceURL(directory, novelID), { waitUntil: "load" })

  await expect(page.locator('[data-slot="novel-workspace-content"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-slot="batch-recovery-banner"]')).toHaveCount(0)
})

test("点击续跑向批量绑定会话发送继续批量写作 prompt 并跳转该会话", async ({ page }) => {
  const prompts: { sessionID: string; text?: string }[] = []
  await setup(page, {
    writingBatch: () => batchRecord(),
    onSessionPrompt: ({ sessionID: sid, body }) => prompts.push({ sessionID: sid, text: body.prompt?.text }),
  })
  await page.goto(novelWorkspaceURL(directory, novelID), { waitUntil: "load" })

  const banner = page.locator('[data-slot="batch-recovery-banner"]')
  await banner.getByRole("button", { name: "续跑" }).click()

  await expect.poll(() => prompts.length, { timeout: 10_000 }).toBe(1)
  expect(prompts[0]).toEqual({ sessionID, text: "继续批量写作" })
  await expect(page).toHaveURL(new RegExp(`/novel/${novelID}/session/${sessionID}$`), { timeout: 15_000 })
})

test("点击放弃走 cancel 写面，记录转 cancelled 后横幅消失", async ({ page }) => {
  let cancelled = false
  await setup(page, {
    writingBatch: () => (cancelled ? batchRecord({ status: "cancelled", interrupted: false }) : batchRecord()),
    onWritingBatchCancel: () => {
      cancelled = true
    },
  })
  await page.goto(novelWorkspaceURL(directory, novelID), { waitUntil: "load" })

  const banner = page.locator('[data-slot="batch-recovery-banner"]')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await banner.getByRole("button", { name: "放弃" }).click()

  await expect.poll(() => cancelled, { timeout: 10_000 }).toBe(true)
  await expect(banner).toHaveCount(0, { timeout: 15_000 })
})

async function setup(page: Page, input: Omit<NovelWorkspaceMockInput, "directory" | "novelID">) {
  await mockOpenNovelServer(page, {
    sessions: [
      {
        slug: "s",
        projectID: "proj-batch-recovery",
        directory,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
        id: sessionID,
        title: "Batch origin session",
      },
    ],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-batch-recovery", directory },
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID], ...input })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    // 横幅文案走 i18n：钉住 zh 使断言与 zh dict 对齐
    localStorage.setItem("opennovel.global.dat:language", JSON.stringify({ locale: "zh" }))
    localStorage.setItem(
      "opennovel.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, directory)
}
