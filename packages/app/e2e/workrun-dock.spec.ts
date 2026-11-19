import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"

// 工作队列区块（session-workrun-dock）四操作回归：进入会话展示 active 队列、
// UI 挂起/恢复经后端事件流驱动状态徽章翻转、刷新后持久态仍正确。
// 依赖外部播种（e2e/utils/workrun-seed.ts）：OPENNOVEL_TEST_DB 直写隔离库并建
// 书籍绑定（自由会话路由已下线，经书籍工作台路由访问），
// OPENNOVEL_TEST_SESSION_ID 为播种后的会话 ID，OPENNOVEL_TEST_DIRECTORY 为其归属目录。

const sessionID = process.env.OPENNOVEL_TEST_SESSION_ID
const directory = process.env.OPENNOVEL_TEST_DIRECTORY ?? "D:\\AI\\Codes\\openNovel"
const novelID = process.env.OPENNOVEL_TEST_NOVEL_ID
const goal = "逐章审查《永夜之城》第一卷，输出批注与修订建议"

test.skip(!sessionID || !novelID, "需要 OPENNOVEL_TEST_SESSION_ID / OPENNOVEL_TEST_NOVEL_ID（先跑 e2e/utils/workrun-seed.ts）")

const dock = (page: import("@playwright/test").Page) => page.locator('[data-component="session-workrun-dock"]')

test.describe("session workrun dock", () => {
  test("renders the seeded queue, pauses and resumes through the event stream", async ({ page }) => {
    await page.goto(`/${base64Encode(directory)}/novel/${novelID}/session/${sessionID}`)

    // 1. 展示：active 队列完整渲染（goal、徽章计数、进度注记、5 个条目）
    const dockEl = dock(page)
    await expect(dockEl).toBeVisible()
    await expect(dockEl).toHaveAttribute("data-status", "active")
    await expect(dockEl.locator('[data-slot="session-workrun-goal"]')).toHaveText(goal)
    await expect(dockEl.locator('[data-slot="session-workrun-status"]')).toContainText("2/5")
    await expect(dockEl.locator('[data-slot="session-workrun-progress"]')).toContainText("视角漂移")
    const items = dockEl.locator('[data-slot="session-workrun-items"] > li')
    await expect(items).toHaveCount(5)
    await expect(items.nth(2)).toHaveAttribute("data-state", "in_progress")

    // 2. 挂起：点击后状态徽章翻转、按钮切换为恢复（事件流驱动，无刷新）；done 计数不变
    await dockEl.locator('[data-action="session-workrun-pause"]').click()
    await expect(dockEl).toHaveAttribute("data-status", "paused")
    await expect(dockEl.locator('[data-slot="session-workrun-status"]')).toContainText("2/5")
    const resume = dockEl.locator('[data-action="session-workrun-resume"]')
    await expect(resume).toBeVisible()

    // 3. 持久态：刷新后 fetch 拉回 paused，仍可恢复
    await page.reload()
    await expect(dockEl).toHaveAttribute("data-status", "paused")

    // 4. 恢复：回到 active，计数徽章按 done 条目重新计算
    await resume.click()
    await expect(dockEl).toHaveAttribute("data-status", "active")
    await expect(dockEl.locator('[data-action="session-workrun-pause"]')).toBeVisible()
    await expect(dockEl.locator('[data-slot="session-workrun-items"] > li')).toHaveCount(5)
  })
})
