import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible } from "../utils/waits"

// chapter-sidebar-focus：章节侧栏跟随当前章节。
// 三个时机（刷新恢复定位 / 选中变化跟随 / 收起恢复补定位）视口都应落在当前章节行，
// 已可见行不产生额外滚动；选中行带 accent 指示条与强调文字，切换选中后样式随行迁移。
// 列表用 60 章 mock（chapterCount=60）：视口约容纳 20 行，选中远端行必然需要滚动。

const directory = "/home/user/ChapterSidebarFocus"
const soloBook = { novelID: "novel-e2e-sidebar-focus", title: "侧栏聚焦验证书" }
const chapterCount = 60

test.use({ viewport: { width: 1440, height: 900 } })

async function setup(page: Page) {
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-sidebar-focus", directory },
  })
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID: soloBook.novelID,
    novelTitle: soloBook.title,
    chapterCount,
  })
}

async function expectRowVisibleInList(page: Page, chapterID: string) {
  const list = page.locator('[data-testid="chapter-list-scroll"]')
  const row = page.locator(`[data-testid="chapter-row-${chapterID}"]`)
  try {
    await expect
      .poll(
        async () => {
          const listRect = await list.boundingBox()
          const rowRect = await row.boundingBox()
          if (!listRect || !rowRect) return "missing"
          const inside =
            rowRect.y >= listRect.y - 1 && rowRect.y + rowRect.height <= listRect.y + listRect.height + 1
          return inside ? "visible" : "off"
        },
        { timeout: 5_000 },
      )
      .toBe("visible")
  } catch (error) {
    const diag = await page.evaluate(
      ([rowId]) => {
        const list = document.querySelector('[data-testid="chapter-list-scroll"]')
        const row = document.querySelector(`[data-testid="chapter-row-${rowId}"]`)
        const listRect = list?.getBoundingClientRect()
        const rowRect = row?.getBoundingClientRect()
        return {
          listConnected: !!list?.isConnected,
          rowConnected: !!row?.isConnected,
          scrollTop: list instanceof HTMLElement ? list.scrollTop : null,
          scrollHeight: list instanceof HTMLElement ? list.scrollHeight : null,
          clientHeight: list instanceof HTMLElement ? list.clientHeight : null,
          listRect: listRect ? { y: listRect.y, height: listRect.height } : null,
          rowRect: rowRect ? { y: rowRect.y, height: rowRect.height } : null,
        }
      },
      [chapterID] as [string],
    )
    console.log("[diag]", JSON.stringify(diag))
    throw error
  }
}

/** 连续两帧读取列表 scrollTop，避开布局与定位的异步时序 */
function stableScrollTop(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(document.querySelector('[data-testid="chapter-list-scroll"]')!.scrollTop)),
        ),
      ),
  )
}

async function openWorkspace(page: Page, restoredChapter: string) {
  await page.addInitScript(
    ({ novelID, chapterID }) => {
      localStorage.setItem("opennovel.global.dat:novel.reading-progress", JSON.stringify({ [novelID]: chapterID }))
    },
    { novelID: soloBook.novelID, chapterID: restoredChapter },
  )
  await page.goto(novelWorkspaceURL(directory, soloBook.novelID))
  await expectAppVisible(page.locator('[data-slot="novel-workspace-content"]'))
}

test("restored reading progress lands the list viewport on the selected chapter", async ({ page }) => {
  await setup(page)
  await openWorkspace(page, "ch-e2e-055")

  await expectRowVisibleInList(page, "ch-e2e-055")
  const scrollTop = await page.locator('[data-testid="chapter-list-scroll"]').evaluate((el) => el.scrollTop)
  expect(scrollTop, "定位应来自列表滚动而非初始巧合").toBeGreaterThan(0)
})

test("selection changes scroll the chapter row into view", async ({ page }) => {
  await setup(page)
  await openWorkspace(page, "ch-e2e-005")

  // 初始选中行已在视口内：切换到视口外远端行，视口应跟随
  const nextButton = page.getByRole("button", { name: "Next Chapter" })
  for (let i = 0; i < 25; i++) await nextButton.click()
  await expectRowVisibleInList(page, "ch-e2e-030")

  // 已完全可见的行（视口中央附近）被点击时，nearest 语义下视口不产生额外滚动
  const fullyVisibleId = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="chapter-list-scroll"]')!
    const rect = list.getBoundingClientRect()
    const row = [...list.querySelectorAll<HTMLElement>("[data-testid^='chapter-row-']")].find((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= rect.top && r.bottom <= rect.bottom && r.height > 0
    })
    return row?.getAttribute("data-testid") ?? null
  })
  expect(fullyVisibleId, "应能找到至少一行完全可见的行").not.toBeNull()
  const before = await stableScrollTop(page)
  await page.locator(`[data-testid="${fullyVisibleId}"]`).click()
  await expectRowVisibleInList(page, fullyVisibleId!.replace("chapter-row-", ""))
  const after = await stableScrollTop(page)
  expect(after, "已可见行的选中不应产生额外滚动").toBe(before)
})

test("chapter switch keeps the workspace mounted while detail and annotations load", async ({ page }) => {
  // 黑闪回归：详情/批注端点延迟 800ms 撑开加载窗口。切章时这两个查询 key 变化，
  // 若无 keepPreviousData，isLoading 翻真使 solid-query 内部 resource 挂起、冒泡布局层
  // Suspense 把整个工作台子树摘插（黑闪 + 侧栏从头重滚）。断言窗口内容器节点身份不变。
  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-sidebar-focus", directory },
  })
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID: soloBook.novelID,
    novelTitle: soloBook.title,
    chapterCount,
    chapterDetailDelayMs: 800,
    annotationsDelayMs: 800,
  })
  await openWorkspace(page, "ch-e2e-005")

  const heading = page.getByRole("heading", { name: "第5章" })
  await expect(heading).toBeVisible()

  await page.evaluate(() => {
    const el = document.querySelector('[data-slot="novel-workspace-content"]')
    ;(window as unknown as { __e2eMain: Element | null }).__e2eMain = el
  })

  await page.getByRole("button", { name: "Next Chapter" }).click()

  // 延迟窗口内（数据未到达）：旧标题仍在渲染、工作台容器仍是同一挂接节点
  await page.waitForTimeout(400)
  const stable = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="novel-workspace-content"]')
    const ref = (window as unknown as { __e2eMain: Element | null }).__e2eMain
    return ref !== null && el === ref && ref.isConnected
  })
  expect(stable, "切章加载窗口内工作台不得摘插重挂（全屏黑闪来源）").toBe(true)
  await expect(heading).toBeVisible()

  // 数据到达后标题更新为新章
  await expect(page.getByRole("heading", { name: "第6章" })).toBeVisible({ timeout: 5_000 })
})

test("reading/writing tab switch keeps the workspace and sidebar mounted", async ({ page }) => {
  // 侧栏闪跳回归：tab 切换走 setSearchParams（searchParams 导航），同属路由 transition 会翻
  // isRouting。首帧门曾对所有 transition 置位 openingRouting，整个工作台子树摘插重挂
  //（侧栏滚动归零 + settle 重滚 = 闪跳）。断言切换后工作台容器与侧栏列表节点身份不变。
  await setup(page)
  await openWorkspace(page, "ch-e2e-040")

  // 远端章节选中使侧栏产生滚动（remount / 摘插后滚动被清零的观测基础）
  const list = page.locator('[data-testid="chapter-list-scroll"]')
  await expectRowVisibleInList(page, "ch-e2e-040")
  const scrollBaseline = await list.evaluate((el) => el.scrollTop)
  expect(scrollBaseline).toBeGreaterThan(0)

  await page.evaluate(() => {
    const win = window as unknown as { __e2eTabNodes: { main: Element | null; list: Element | null } }
    win.__e2eTabNodes = {
      main: document.querySelector('[data-slot="novel-workspace-content"]'),
      list: document.querySelector('[data-testid="chapter-list-scroll"]'),
    }
  })
  const nodesStable = () =>
    page.evaluate(() => {
      const win = window as unknown as { __e2eTabNodes: { main: Element | null; list: Element | null } }
      const { main, list } = win.__e2eTabNodes
      return (
        main !== null &&
        list !== null &&
        main.isConnected &&
        list.isConnected &&
        main === document.querySelector('[data-slot="novel-workspace-content"]') &&
        list === document.querySelector('[data-testid="chapter-list-scroll"]')
      )
    })

  await page.getByRole("button", { name: "Writing", exact: true }).click()
  await expect.poll(nodesStable, { timeout: 5_000, intervals: [100, 200, 400] }).toBe(true)
  // 地址落地晚于响应式更新（navigateEnd 批），轮询等其落定
  await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("tab=writing")
  // 侧栏滚动必须原样保留：视图查询冷挂载挂起曾冒泡全局 Suspense 把整树移出文档，
  // 滚动容器偏移被浏览器无声清零（settle 不补滚——其依赖未变），侧栏回顶
  const scrollAfterWriting = await list.evaluate((el) => el.scrollTop)
  expect(scrollAfterWriting, "切写作后侧栏滚动不得清零").toBe(scrollBaseline)

  await page.getByRole("button", { name: "Reading", exact: true }).click()
  await expect.poll(nodesStable, { timeout: 5_000, intervals: [100, 200, 400] }).toBe(true)
  await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("tab=reading")
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrollAfterWriting)
})

test("partially visible row selection does not complete the scroll", async ({ page }) => {
  await setup(page)
  await openWorkspace(page, "ch-e2e-005")

  // 显式构造跨边行：把视口中部一行滚到骑在列表底边上（行中心高于底边 6px，可正常点击）
  const partialId = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="chapter-list-scroll"]')!
    const rect = list.getBoundingClientRect()
    const rows = [...list.querySelectorAll<HTMLElement>("[data-testid^='chapter-row-']")].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height > 0 && r.top > rect.top + 100 && r.bottom < rect.bottom
    })
    const row = rows[Math.floor(rows.length / 2)]
    if (!row) return null
    const r = row.getBoundingClientRect()
    list.scrollTop += r.top + r.height / 2 - 6 - rect.bottom
    return row.getAttribute("data-testid")
  })
  expect(partialId, "应能构造出一行部分可见的行").not.toBeNull()

  const before = await stableScrollTop(page)
  await page.locator(`[data-testid="${partialId}"]`).click()
  const after = await stableScrollTop(page)
  expect(after, "部分可见行的选中不应被补全滚动（行被推到视口底边）").toBe(before)
})

test("collapsed sidebar catches up to the selection after re-expanding", async ({ page }) => {
  await setup(page)
  await openWorkspace(page, "ch-e2e-010")

  await page.getByRole("button", { name: "Toggle nav" }).click()
  await expect(page.locator('[data-testid="chapter-list-scroll"]')).toBeHidden()

  // 收起期间连跳到视口外远端章节，行内定位在无布局下是 no-op
  const nextButton = page.getByRole("button", { name: "Next Chapter" })
  for (let i = 0; i < 25; i++) await nextButton.click()

  await page.getByRole("button", { name: "Toggle nav" }).click()
  await expect(page.locator('[data-testid="chapter-list-scroll"]')).toBeVisible()
  await expectRowVisibleInList(page, "ch-e2e-035")
})

test("selected row carries the accent indicator and it migrates on selection change", async ({ page }) => {
  await setup(page)
  await openWorkspace(page, "ch-e2e-005")

  const row5 = page.locator('[data-testid="chapter-row-ch-e2e-005"]')
  const row10 = page.locator('[data-testid="chapter-row-ch-e2e-010"]')
  await expect(row5).toHaveClass(/border-v2-background-bg-accent/)
  await expect(row10).not.toHaveClass(/border-v2-background-bg-accent/)

  await row10.getByText("第10章", { exact: true }).click()
  await expect(row10).toHaveClass(/border-v2-background-bg-accent/)
  await expect(row5).not.toHaveClass(/border-v2-background-bg-accent/)
})
