import { expect, test, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { APP_READY_TIMEOUT } from "../utils/waits"

const directory = "/home/user/NovelProject"
const novelID = "novel-e2e-pane-width-001"
const now = Date.now()

const mockNovel = {
  id: novelID,
  title: "宽度走查",
  genre: "玄幻",
  synopsis: "pane width e2e",
  status: "draft",
  createdAt: now,
  updatedAt: now,
  styleGuide: { id: "sg-001", novelId: novelID, rules: {}, tone: "neutral", pov: "third", tense: "past" },
  stats: { chapterCount: 1, volumeCount: 1, characterCount: 0, wordCount: 100 },
}

const workspaceURL = `/${base64Encode(directory)}/novel/${novelID}`

async function openWorkspace(page: Page) {
  const sessions: Array<{ id: string } & Record<string, unknown>> = []
  await mockOpenNovelServer(page, {
    sessions,
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-pane-width", directory },
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
        body: JSON.stringify([{ id: "ch-001", novelId: novelID, title: "第一章", order: 1, status: "drafting", wordCount: 100, createdAt: now, updatedAt: now }]),
      })
    if (path === "/api/novel/session-bindings" || path.endsWith("/annotations"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })
  await page.route(/\/api\/sync\/run/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  )
  await page.goto(workspaceURL, { waitUntil: "load" })
}

async function dragBy(page: Page, handle: Locator, dx: number) {
  const box = await handle.boundingBox()
  if (!box) throw new Error("handle not visible")
  const startX = box.x + box.width / 2
  // 偏离垂直中心：中心区域被悬浮的边缘展开按钮（z-20，高 96px 居中）遮挡
  const startY = box.y + Math.min(200, box.height - 40)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY, { steps: 8 })
  await page.mouse.up()
}

async function widthOf(locator: Locator) {
  return (await locator.boundingBox())?.width ?? 0
}

async function expectApproxWidth(locator: Locator, target: number, tolerance = 8) {
  await expect
    .poll(() => widthOf(locator), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(target - tolerance)
  await expect
    .poll(() => widthOf(locator), { timeout: 5_000 })
    .toBeLessThanOrEqual(target + tolerance)
}

test.setTimeout(90_000)

test("pane width: dynamic cap beyond old constants, clamp on shrink, restore, dblclick reset", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const errors = trackPageErrors(page)
  await openWorkspace(page)

  const left = page.locator("aside.border-r")
  const rail = page.locator("aside.border-l")
  await expect(left).toHaveCount(1, { timeout: APP_READY_TIMEOUT })
  await expect(rail).toHaveCount(1)
  const leftHandle = page.locator('[data-component="resize-handle"][data-edge="end"]')
  await expect(leftHandle).toHaveCount(1)

  // 默认宽度 288 → 拖到 588，越过旧静态上限 400
  await expectApproxWidth(left, 288)
  await dragBy(page, leftHandle, 300)
  await expectApproxWidth(left, 588)

  // 继续拖入推挤区：中心被压到 160px 保底，右栏 380 → 332，左栏 = 1600 − 160 − 332 = 1108
  await dragBy(page, leftHandle, 520)
  await expectApproxWidth(left, 1108, 12)
  await expectApproxWidth(rail, 332)
  const leftBox = await left.boundingBox()
  const railBox = await rail.boundingBox()
  const mainWidth = railBox!.x - (leftBox!.x + leftBox!.width)
  expect(mainWidth).toBeLessThanOrEqual(190)
  expect(mainWidth).toBeGreaterThanOrEqual(130)

  // 缩窗：设定宽度 1108 被钳制到 1000 − 160 − 332 = 508
  await page.setViewportSize({ width: 1000, height: 900 })
  await expectApproxWidth(left, 508, 12)

  // 变宽：完整设定宽度自动恢复
  await page.setViewportSize({ width: 1600, height: 900 })
  await expectApproxWidth(left, 1108, 12)

  // 双击重置默认宽度
  await leftHandle.dblclick({ position: { x: 4, y: 200 } })
  await expectApproxWidth(left, 288)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("pane width: drag below min collapses, expand shows min width", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const errors = trackPageErrors(page)
  await openWorkspace(page)

  const left = page.locator("aside.border-r")
  await expect(left).toHaveCount(1, { timeout: APP_READY_TIMEOUT })
  const leftHandle = page.locator('[data-component="resize-handle"][data-edge="end"]')
  await expect(leftHandle).toHaveCount(1)

  await dragBy(page, leftHandle, -200)
  await expect(left).toBeHidden()

  await page.locator('[data-edge-rail="left-collapsed"]').click()
  await expect(left).toBeVisible()
  await expectApproxWidth(left, 220)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("pane width: auto collapse on narrow window, manual expand floors at min width", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const errors = trackPageErrors(page)
  await openWorkspace(page)

  const left = page.locator("aside.border-r")
  const rail = page.locator("aside.border-l")
  await expect(left).toHaveCount(1, { timeout: APP_READY_TIMEOUT })
  await expect(rail).toHaveCount(1)
  const railHandle = page.locator('[data-component="resize-handle"][data-edge="start"]')
  await expect(railHandle).toHaveCount(1)

  // 右栏拖宽到 680（edge=start，向左拖增大）
  await dragBy(page, railHandle, -300)
  await expectApproxWidth(rail, 680, 12)

  // 缩窗到 500：两栏钳制下限总和 220 + 320 + 160 = 700 > 500 → 动态钳制无法容纳，右栏自动收起
  await page.setViewportSize({ width: 500, height: 700 })
  await expect(rail).toBeHidden({ timeout: 5_000 })
  await expect(left).toBeVisible()

  // 手动展开优先于自动规则：500 − 160 − 288 = 52 < 最小宽 320 → 按最小宽度显示
  await page.locator('[data-edge-rail="right-collapsed"]').click()
  await expect(rail).toBeVisible()
  await expectApproxWidth(rail, 320)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("pane width: pushing beyond the other minimum collapses and persists", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const errors = trackPageErrors(page)
  await openWorkspace(page)

  const left = page.locator("aside.border-r")
  const rail = page.locator("aside.border-l")
  await expect(left).toHaveCount(1, { timeout: APP_READY_TIMEOUT })
  await expect(rail).toHaveCount(1)
  const leftHandle = page.locator('[data-component="resize-handle"][data-edge="end"]')
  const railHandle = page.locator('[data-component="resize-handle"][data-edge="start"]')
  await expect(leftHandle).toHaveCount(1)
  await expect(railHandle).toHaveCount(1)

  // 先进入推挤区：1600 − 160 − 1080 = 360，右栏被压过默认宽度但尚未收起
  await dragBy(page, leftHandle, 792)
  await expectApproxWidth(left, 1080, 12)
  await expectApproxWidth(rail, 360)
  const leftBox = await left.boundingBox()
  const railBox = await rail.boundingBox()
  const pushedMainWidth = railBox!.x - (leftBox!.x + leftBox!.width)
  expect(pushedMainWidth).toBeLessThanOrEqual(190)
  expect(pushedMainWidth).toBeGreaterThanOrEqual(130)

  // 越过右栏最小宽（1120）后自动收起；继续拖到 1600 − 160 = 1440，中心保留最小可见宽度
  await dragBy(page, leftHandle, 60)
  await expect(rail).toBeHidden({ timeout: 5_000 })
  await dragBy(page, leftHandle, 300)
  await expectApproxWidth(left, 1440, 12)
  await expect(rail).toBeHidden()

  // 松手已把推挤收起固化为手动收起；窗口变宽也不回弹
  await page.setViewportSize({ width: 2000, height: 900 })
  await expectApproxWidth(left, 1440, 12)
  await expect(rail).toBeHidden()

  // 手动展开右栏按最小宽恢复，左栏保留可恢复的完整设定宽度
  await page.locator('[data-edge-rail="right-collapsed"]').click()
  await expect(rail).toBeVisible()
  await expectApproxWidth(rail, 320)
  await expectApproxWidth(left, 1440, 12)

  // 对称：右栏越过左栏最小宽（2000 − 160 − 220 = 1620）后自动收起左栏
  await dragBy(page, railHandle, -1320)
  await expect(left).toBeHidden({ timeout: 5_000 })
  await expectApproxWidth(rail, 1640, 12)

  // 右栏继续拖到 2000 − 160 = 1840，中心保留最小可见宽度
  await dragBy(page, railHandle, -200)
  await expectApproxWidth(rail, 1840, 12)
  await expect(left).toBeHidden()

  // 手动展开左栏按最小宽恢复，右栏按动态上限钳制显示
  await page.locator('[data-edge-rail="left-collapsed"]').click()
  await expect(left).toBeVisible()
  await expectApproxWidth(left, 220)
  await expectApproxWidth(rail, 1620, 12)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})
