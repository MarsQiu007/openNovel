import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"

// 工作队列区块（session-workrun-dock）回归：进入会话展示队列、
// UI 挂起/恢复经后端事件流驱动状态徽章翻转、刷新后持久态仍正确、
// 头部收纳/展开切换条目区可见性。
// 依赖外部播种（e2e/utils/workrun-seed.ts）：OPENNOVEL_TEST_DB 直写隔离库并建
// 书籍绑定（自由会话路由已下线，经书籍工作台路由访问），
// OPENNOVEL_TEST_SESSION_ID 为播种后的会话 ID，OPENNOVEL_TEST_DIRECTORY 为其归属目录。
// 播种的 active 队列在测试后端首次请求构建 location 层时经 D9 启动对账翻为
// paused、被杀的进行中单元回退 pending（进度注记保留）——首屏断言按对账后语义。

const sessionID = process.env.OPENNOVEL_TEST_SESSION_ID
const directory = process.env.OPENNOVEL_TEST_DIRECTORY ?? "D:\\AI\\Codes\\openNovel"
const novelID = process.env.OPENNOVEL_TEST_NOVEL_ID
const goal = "逐章审查《永夜之城》第一卷，输出批注与修订建议"

test.skip(!sessionID || !novelID, "需要 OPENNOVEL_TEST_SESSION_ID / OPENNOVEL_TEST_NOVEL_ID（先跑 e2e/utils/workrun-seed.ts）")

const dock = (page: import("@playwright/test").Page) => page.locator('[data-component="session-workrun-dock"]')

test.describe("session workrun dock", () => {
  test("renders the seeded queue, pauses and resumes through the event stream", async ({ page }) => {
    await page.goto(`/${base64Encode(directory)}/novel/${novelID}/session/${sessionID}`)

    // 1. 展示：D9 对账后 paused 队列完整渲染（goal、徽章计数、进度注记保留、5 个条目、
    //    被杀的进行中单元已回退待处理）
    const dockEl = dock(page)
    await expect(dockEl).toBeVisible()
    await expect(dockEl).toHaveAttribute("data-status", "paused")
    await expect(dockEl.locator('[data-slot="session-workrun-goal"]')).toHaveText(goal)
    await expect(dockEl.locator('[data-slot="session-workrun-status"]')).toContainText("2/5")
    await expect(dockEl.locator('[data-slot="session-workrun-progress"]')).toContainText("视角漂移")
    const items = dockEl.locator('[data-slot="session-workrun-items"] > li')
    await expect(items).toHaveCount(5)
    await expect(items.nth(2)).toHaveAttribute("data-state", "pending")

    // 2. 恢复：点击后状态徽章翻转、按钮切换为挂起（事件流驱动，无刷新）；done 计数不变。
    //    恢复编排（steer 合成恢复指令 + 执行唤醒）由 resume 端点委托 core resumeWorkRun
    await dockEl.locator('[data-action="session-workrun-resume"]').click()
    await expect(dockEl).toHaveAttribute("data-status", "active")
    await expect(dockEl.locator('[data-slot="session-workrun-status"]')).toContainText("2/5")
    await expect(dockEl.locator('[data-action="session-workrun-pause"]')).toBeVisible()
    await expect(page.getByText("队列已恢复执行", { exact: false })).toBeVisible({ timeout: 20000 })

    // 3. 挂起：回到 paused，按钮切换为恢复
    await dockEl.locator('[data-action="session-workrun-pause"]').click()
    await expect(dockEl).toHaveAttribute("data-status", "paused")
    await expect(dockEl.locator('[data-action="session-workrun-resume"]')).toBeVisible()

    // 4. 持久态：刷新后 fetch 拉回 paused，仍可恢复
    await page.reload()
    await expect(dockEl).toHaveAttribute("data-status", "paused")

    // 5. 再次恢复：回到 active
    await dockEl.locator('[data-action="session-workrun-resume"]').click()
    await expect(dockEl).toHaveAttribute("data-status", "active")

    // 6. 收纳/展开：chevron 收纳隐藏条目与进度注记，再展开恢复（唯一开关，避免头部中心点击落点歧义）
    await dockEl.locator('[data-action="session-workrun-collapse"][data-collapsed="false"]').click()
    await expect(dockEl.locator('[data-slot="session-workrun-items"]')).toHaveCount(0)
    await expect(dockEl.locator('[data-slot="session-workrun-progress"]')).toHaveCount(0)
    await expect(dockEl.locator('[data-action="session-workrun-pause"]')).toBeVisible()
    await dockEl.locator('[data-action="session-workrun-collapse"][data-collapsed="true"]').click()
    await expect(dockEl.locator('[data-slot="session-workrun-items"] > li')).toHaveCount(5)
  })
})
