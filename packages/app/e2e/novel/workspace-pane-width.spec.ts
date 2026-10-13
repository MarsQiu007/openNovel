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

  // 继续拖到拖拽上限：中心被压到保底缝后推挤右栏 380 → 320，左栏 = 1600 − 30 − 320 = 1250
  await dragBy(page, leftHandle, 700)
  await expectApproxWidth(left, 1250, 12)
  await expectApproxWidth(rail, 320)
  const leftBox = await left.boundingBox()
  const railBox = await rail.boundingBox()
  const mainWidth = railBox!.x - (leftBox!.x + leftBox!.width)
  expect(mainWidth).toBeLessThanOrEqual(60)
  expect(mainWidth).toBeGreaterThanOrEqual(1)

  // 缩窗：设定宽度 1250 被钳制到 1000 − 30 − 320 = 650
  await page.setViewportSize({ width: 1000, height: 900 })
  await expectApproxWidth(left, 650, 12)

  // 变宽：完整设定宽度自动恢复
  await page.setViewportSize({ width: 1600, height: 900 })
  await expectApproxWidth(left, 1250, 12)

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

  // 缩窗到 500：两栏钳制下限总和 220 + 320 + 30 = 570 > 500 → 动态钳制无法容纳，右栏自动收起
  await page.setViewportSize({ width: 500, height: 700 })
  await expect(rail).toBeHidden({ timeout: 5_000 })
  await expect(left).toBeVisible()

  // 手动展开优先于自动规则：500 − 30 − 288 = 182 < 最小宽 320 → 按最小宽度显示
  await page.locator('[data-edge-rail="right-collapsed"]').click()
  await expect(rail).toBeVisible()
  await expectApproxWidth(rail, 320)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})

test("pane width: dragging one pane pushes the other to its minimum and persists", async ({ page }) => {
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

  // 拖左栏至上限 1250：右栏被推挤至 320，主区剩约 30px
  await dragBy(page, leftHandle, 1300)
  await expectApproxWidth(left, 1250, 12)
  await expectApproxWidth(rail, 320)

  // 放大窗口：被推挤的右栏保持 320（固化，不回弹 380），左栏恢复完整设定宽 1250
  await page.setViewportSize({ width: 2000, height: 900 })
  await expectApproxWidth(rail, 320)
  await expectApproxWidth(left, 1250, 12)

  // 对称：拖右栏至上限 2000 − 30 − 220 = 1750，左栏被推挤至 220
  await dragBy(page, railHandle, -1430)
  await expectApproxWidth(rail, 1750, 12)
  await expectApproxWidth(left, 220)
  const leftBox = await left.boundingBox()
  const railBox = await rail.boundingBox()
  const mainWidth = railBox!.x - (leftBox!.x + leftBox!.width)
  expect(mainWidth).toBeLessThanOrEqual(60)
  expect(mainWidth).toBeGreaterThanOrEqual(1)

  expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
})
