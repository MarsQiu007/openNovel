/**
 * 回归测试：关系图抽屉内点删除 -> 确认弹窗点取消/确认 -> 界面不应卡死。
 *
 * 根因：corvu 抽屉（modal）与 Kobalte 全局弹窗（useDialog）是两套独立 modal 系统，
 * 都会操作 document.body.pointerEvents。Kobalte 弹窗打开时 FocusScope 抢焦点，
 * corvu 的 closeOnOutsideFocus 据此关闭抽屉，导致：
 * 1. 弹窗打开瞬间捕获 body=none（corvu 持有），随后抽屉被关、corvu 还原 body=""
 * 2. 点取消时 Kobalte 把陈旧的 "none" 写回 body，此时无任何 modal 存活 -> 界面卡死
 *
 * 修复：弹窗打开期间禁止抽屉的 closeOnOutsidePointer + closeOnOutsideFocus；
 *       并在最后一个弹窗关闭后兜底校准 body pointer-events。
 */
import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"

const directory = "/home/user/NovelProject"
const novelID = "novel-repro-freeze"
const now = Date.now()

const mockNovel = {
  id: novelID,
  title: "复现小说",
  genre: "玄幻",
  synopsis: "repro",
  status: "draft",
  createdAt: now,
  updatedAt: now,
  styleGuide: { id: "sg-001", novelId: novelID, rules: {}, tone: "neutral", pov: "third", tense: "past" },
  stats: { chapterCount: 0, volumeCount: 0, characterCount: 2, wordCount: 0 },
}

const mockCharacters = [
  { id: "char-001", novelId: novelID, name: "星尘", role: "protagonist", description: "主角", status: "active", createdAt: now },
  { id: "char-002", novelId: novelID, name: "月影", role: "supporting", description: "配角", status: "active", createdAt: now },
]

const mockRelationships = [
  { id: "rel-001", novelId: novelID, charAId: "char-001", charBId: "char-002", type: "师徒", description: "引导主角" },
]

async function setupNovelMocks(page: import("@playwright/test").Page) {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-repro", directory },
    pageMessages: () => ({ items: [] }),
  })

  await page.route(/\/api\/novel/, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

    if (method === "GET" && path === "/api/novel") return json([mockNovel])
    if (path === `/api/novel/${novelID}`) return json(mockNovel)
    if (path === `/api/novel/${novelID}/characters`) return json(mockCharacters)
    if (path === `/api/novel/${novelID}/relationships`) return json(mockRelationships)
    if (path === `/api/novel/${novelID}/chapters`) return json([])
    if (path === `/api/novel/${novelID}/volumes`) return json([])
    if (path === `/api/novel/${novelID}/outline`) return json([])
    if (path === `/api/novel/${novelID}/tension`) return json([])
    if (path === `/api/novel/${novelID}/plot-threads`) return json([])
    if (path === `/api/novel/${novelID}/foreshadowing`) return json([])
    if (path === `/api/novel/${novelID}/world-entries`) return json([])
    if (path === `/api/novel/${novelID}/character-states`) return json([])
    if (path.includes("/for-session/")) return json(mockNovel)
    if (method === "DELETE" && /^\/api\/novel\/[^/]+\/characters\/[^/]+$/.test(path)) return json({})
    return json({})
  })
}

/** 打开关系图抽屉：导航到关系页 -> Graph 视图 -> 点击月影节点 */
async function openCharacterDrawer(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "load" })
  await page.waitForTimeout(3000)
  await page.goto(`/${base64Encode(directory)}/novel/${novelID}`, { waitUntil: "load" })

  const relationsTab = page.getByRole("button", { name: "Relations", exact: true }).first()
  await relationsTab.waitFor({ state: "visible", timeout: 30_000 })
  await relationsTab.click()

  const graphBtn = page.getByRole("button", { name: "Graph", exact: true })
  await graphBtn.waitFor({ state: "visible", timeout: 10_000 })
  await graphBtn.click()
  await page.waitForTimeout(500)

  // :has(> circle) 精确定位到节点级 <g>（外层 transform 根 g 也含文本但不直接含 circle）
  const node = page.locator('svg g:has(> circle)', { hasText: "月影" }).first()
  await node.waitFor({ state: "visible", timeout: 15_000 })
  const box = await node.boundingBox()
  if (!box) throw new Error("node boundingBox is null")
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  await page.waitForSelector("[data-corvu-drawer-content]", { timeout: 10_000 })
  await page.waitForTimeout(600)
}

test.describe("relations drawer + confirm dialog freeze", () => {
  test("cancel delete should keep drawer interactive (not freeze UI)", async ({ page }) => {
    const errors = trackPageErrors(page)
    await setupNovelMocks(page)
    await openCharacterDrawer(page)

    // 点删除 -> 确认弹窗
    const deleteBtn = page.locator("[data-corvu-drawer-content]").getByRole("button", { name: "Delete", exact: true })
    await deleteBtn.click()
    await page.waitForSelector("[data-component='dialog-v2']", { timeout: 10_000 })
    await page.waitForTimeout(400)

    // 点取消
    await page.getByRole("button", { name: "Cancel", exact: true }).last().click()
    await page.waitForTimeout(1500)

    // 抽屉应仍然打开且可交互
    const drawerState = await page.evaluate(() => {
      const el = document.querySelector("[data-corvu-drawer-content]") as HTMLElement | null
      return {
        drawerPresent: !!el,
        drawerPointerEvents: el ? getComputedStyle(el).pointerEvents : null,
        dialogPresent: !!document.querySelector("[data-component='dialog-v2']"),
      }
    })
    expect(drawerState.drawerPresent, "drawer should remain open after cancel").toBe(true)
    expect(drawerState.drawerPointerEvents, "drawer content should be clickable").toBe("auto")
    expect(drawerState.dialogPresent, "confirm dialog should be closed").toBe(false)

    // 功能性验证：抽屉内的关闭按钮应可点击并关闭抽屉
    const closeBtn = page.locator("[data-corvu-drawer-content]").getByRole("button").filter({ hasText: /close/i }).first()
    if (await closeBtn.count()) {
      await closeBtn.click()
    } else {
      // 退而求其次：点击抽屉遮罩关闭
      await page.mouse.click(50, 200)
    }
    await page.waitForTimeout(800)

    // 抽屉关闭后 body pointer-events 应还原（不卡死）
    const bodyPe = await page.evaluate(() => document.body.style.pointerEvents)
    expect(bodyPe, "body pointer-events should be restored after drawer closes").not.toBe("none")

    expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
  })

  test("confirm delete should close drawer and restore body (not freeze UI)", async ({ page }) => {
    const errors = trackPageErrors(page)
    await setupNovelMocks(page)
    await openCharacterDrawer(page)

    const deleteBtn = page.locator("[data-corvu-drawer-content]").getByRole("button", { name: "Delete", exact: true })
    await deleteBtn.click()
    await page.waitForSelector("[data-component='dialog-v2']", { timeout: 10_000 })
    await page.waitForTimeout(400)

    // 点确认删除（Delete 按钮在确认弹窗内）
    await page.getByRole("button", { name: "Delete", exact: true }).last().click()
    await page.waitForTimeout(1500)

    // 抽屉和弹窗都应关闭，body 应还原
    const state = await page.evaluate(() => ({
      drawerPresent: !!document.querySelector("[data-corvu-drawer-content]"),
      dialogPresent: !!document.querySelector("[data-component='dialog-v2']"),
      bodyPe: document.body.style.pointerEvents,
    }))
    expect(state.dialogPresent, "confirm dialog should be closed").toBe(false)
    expect(state.bodyPe, "body pointer-events should be restored after confirm").not.toBe("none")

    expect(errors.filter((e) => !e.includes("ExperimentalWarning"))).toHaveLength(0)
  })
})
