import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

// book-open-transition：书籍打开首帧收敛回归。
// 三个入口（书架点击 / 标签切换 / 关闭标签落相邻书）都应从加载门直达最终会话视图，
// 全程不出现被替换的中间态（懒创建空态、默认现场、二次加载门）；持久化现场（阅读进度 /
// 左栏模式 / 右栏面板 / 展开态）在首个内容帧即恢复；张力不阻塞首帧；绑定会话查询失败时
// 呈现失败占位而非懒创建空态，重试恢复后照常自动回跳；书内切换会话不重挂工作台。
//
// 中间态观测：addInitScript 注入 MutationObserver，记录 novel-workspace-loading /
// novel-workspace-content / novel-chat-empty 三类观测标记的出现 / 消失序列（附带出现
// 时刻的地址与首帧快照）。断言「内容帧首次出现时地址已是最终会话地址」可同时捕捉
// 「先开门再回跳」与「空态闪烁」两种退化形态。

const directory = "/home/user/BookTransition"
const dirBase = `/${base64Encode(directory)}`

const bookA = {
  novelID: "novel-e2e-transition-a",
  title: "首帧收敛验证书 A",
  boundID: "ses_transition_a",
  boundTitle: "Transition book A session",
}
const bookB = {
  novelID: "novel-e2e-transition-b",
  title: "相邻标签验证书 B",
  boundID: "ses_transition_b",
  boundTitle: "Transition book B session",
}
// 无绑定会话的书：隔离「恢复现场」与「张力按需加载」断言（会话模式会强制右栏回对话）
const soloBook = { novelID: "novel-e2e-transition-solo", title: "无会话验证书" }

type BookSpec = { novelID: string; title: string; boundID?: string; boundTitle?: string; extraBoundIDs?: string[] }

const slotLoading = "novel-workspace-loading"
const slotContent = "novel-workspace-content"
const slotChatEmpty = "novel-chat-empty"

type SlotSnapshot = { worldSidebar: boolean; structurePanel: boolean }
type SlotEvent = { slot: string; appear: boolean; url: string; snapshot?: SlotSnapshot }

test.use({ viewport: { width: 1440, height: 900 } })

test("bookshelf entry reaches the bound session view without intermediate frames", async ({ page }) => {
  await setup(page, [bookA])
  await observeSlots(page)
  await page.goto("/")

  const card = page.locator('[data-component="home-book-card"]', { hasText: bookA.title })
  await expectAppVisible(card)
  await card.click()

  await expect(page).toHaveURL((url) => url.pathname === sessionPath(bookA), { timeout: 15_000 })
  await expectSessionTitle(page, bookA.boundTitle)

  const events = await readSlotEvents(page)
  expect(events.filter((event) => event.slot === slotChatEmpty)).toHaveLength(0)
  // 每个内容帧都在地址定址到绑定会话后出现：不存在"先开门再回跳"的中间态
  const contentEvents = appeared(events).filter((event) => event.slot === slotContent)
  expect(contentEvents.length).toBeGreaterThan(0)
  for (const event of contentEvents) expect(new URL(event.url).pathname).toBe(sessionPath(bookA))
})

test("opening a book does not request tension; the rail panel loads it on demand", async ({ page }) => {
  await setup(page, [soloBook])
  await observeSlots(page)
  const tensionRequests: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path === `/api/novel/${soloBook.novelID}/tension`) tensionRequests.push(path)
  })

  await page.goto(novelWorkspaceURL(directory, soloBook.novelID))
  await expectAppVisible(page.locator(`[data-slot="${slotContent}"]`))
  expect(tensionRequests).toHaveLength(0)

  await page.getByRole("button", { name: "Tension", exact: true }).click()
  await expect.poll(() => tensionRequests.length, { timeout: 10_000 }).toBeGreaterThan(0)
})

test("first content frame restores left mode and rail panel", async ({ page }) => {
  await setup(page, [soloBook])
  await page.addInitScript((novelID: string) => {
    localStorage.setItem("opennovel.global.dat:novel.workspace.state.v1", JSON.stringify({ [novelID]: { leftMode: "world" } }))
    localStorage.setItem("opennovel.global.dat:novel.workspace.layout.v1", JSON.stringify({ railPanel: "structure" }))
  }, soloBook.novelID)
  await observeSlots(page)
  await page.goto(novelWorkspaceURL(directory, soloBook.novelID))

  await expectAppVisible(page.locator('[data-slot="world-sidebar"]'))
  await expectAppVisible(page.locator('[data-slot="structure-panel"]'))
  await expect(page).toHaveURL((url) => url.pathname === bookPath(soloBook.novelID))

  // 首个内容帧的快照即已恢复现场：不存在先默认态后补恢复的闪烁
  const content = appeared(await readSlotEvents(page)).filter((event) => event.slot === slotContent)
  expect(content).toHaveLength(1)
  expect(content[0]?.snapshot).toEqual({ worldSidebar: true, structurePanel: true })
})

test("first content frame restores reading progress and expanded panel address", async ({ page }) => {
  await setup(page, [soloBook])
  await page.addInitScript((novelID: string) => {
    localStorage.setItem("opennovel.global.dat:novel.reading-progress", JSON.stringify({ [novelID]: "ch-e2e-002" }))
    localStorage.setItem("opennovel.global.dat:novel.workspace.layout.v1", JSON.stringify({ expanded: "structure" }))
  }, soloBook.novelID)
  await observeSlots(page)
  const chapterDetailRequests: string[] = []
  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(/\/(ch-[^/]+)$/)
    if (match) chapterDetailRequests.push(match[1]!)
  })

  await page.goto(novelWorkspaceURL(directory, soloBook.novelID))
  await expectAppVisible(page.locator('[data-slot="structure-panel"]'))
  await expect.poll(() => chapterDetailRequests.length, { timeout: 10_000 }).toBeGreaterThan(0)

  // 首个单章请求即恢复的进度章：不先落入默认首章再被替换
  expect(chapterDetailRequests[0]).toBe("ch-e2e-002")
  expect(chapterDetailRequests).not.toContain("ch-e2e-001")

  const content = appeared(await readSlotEvents(page)).filter((event) => event.slot === slotContent)
  expect(content).toHaveLength(1)
  const url = new URL(content[0]!.url)
  expect(url.pathname).toBe(bookPath(soloBook.novelID))
  // 展开态地址在门内以 replace 同步：首个内容帧即带最终查询串
  expect(url.searchParams.get("tab")).toBe("panel:structure")
})

test("tab switch and tab close land on the adjacent book's session view directly", async ({ page }) => {
  await setup(page, [bookA, bookB])
  await observeSlots(page)

  // 阶段一：直接打开 A，完整门序列为「加载 → 内容帧（已定址会话）」
  await page.goto(novelWorkspaceURL(directory, bookA.novelID))
  await expect(page).toHaveURL((url) => url.pathname === sessionPath(bookA), { timeout: 15_000 })
  await expectSessionTitle(page, bookA.boundTitle)
  const phase1 = await readSlotEvents(page)
  expect(phase1.filter((event) => event.slot === slotChatEmpty)).toHaveLength(0)
  for (const event of appeared(phase1).filter((item) => item.slot === slotContent))
    expect(new URL(event.url).pathname).toBe(sessionPath(bookA))

  // 阶段二：打开 B 后双标签并存（A 标签跨页面加载保留）
  await page.goto(novelWorkspaceURL(directory, bookB.novelID))
  await expect(page).toHaveURL((url) => url.pathname === sessionPath(bookB), { timeout: 15_000 })
  await expectSessionTitle(page, bookB.boundTitle)
  await expect(page.locator("[data-titlebar-tab-slot]")).toHaveCount(2)

  // 标签切换入口：点击 A 标签直达 A 的会话视图
  const tabA = page.locator(`[data-titlebar-tab-slot][data-tab-key*="${bookA.novelID}"]`)
  await tabA.locator("a[data-titlebar-tab-link]").click()
  await expect(page).toHaveURL((url) => url.pathname === sessionPath(bookA), { timeout: 15_000 })
  await expectSessionTitle(page, bookA.boundTitle)

  // 关闭标签入口：关闭 A 落相邻书 B，直达 B 的会话视图
  await tabA.locator('[data-slot="tab-close"] button').click()
  await expect(page).toHaveURL((url) => url.pathname === sessionPath(bookB), { timeout: 15_000 })
  await expectSessionTitle(page, bookB.boundTitle)
  await expect(page.locator("[data-titlebar-tab-slot]")).toHaveCount(1)
  await expect(tabA).toHaveCount(0)

  // 两个入口的内容帧都在地址定址后出现：无懒创建空态、无"先默认后替换"
  const phase2 = await readSlotEvents(page)
  const contentPaths = appeared(phase2)
    .filter((event) => event.slot === slotContent)
    .map((event) => new URL(event.url).pathname)
  expect(contentPaths).toEqual([sessionPath(bookB), sessionPath(bookA), sessionPath(bookB)])
  expect(phase2.filter((event) => event.slot === slotChatEmpty)).toHaveLength(0)
})

test("bindings failure keeps the lazy empty state away and recovers by retry", async ({ page }) => {
  await setup(page, [bookA])
  let failBindings = true
  await page.route(
    (url) => url.pathname === "/api/novel/session-bindings",
    (route) => (failBindings ? route.fulfill({ status: 500, body: "bindings down" }) : route.fallback()),
  )
  await observeSlots(page)
  await page.goto(novelWorkspaceURL(directory, bookA.novelID))

  // 自愈重试耗尽后呈现失败占位与重试入口：全程不呈现懒创建空态
  const failure = page.locator('[data-slot="novel-chat-bindings-error"]')
  await expectAppVisible(failure)
  await expect(failure.getByText("会话列表加载失败")).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === bookPath(bookA.novelID))
  expect((await readSlotEvents(page)).filter((event) => event.slot === slotChatEmpty)).toHaveLength(0)

  // 恢复后：重试成功 → 自动回跳到绑定会话（空态始终不出现）
  failBindings = false
  await failure.getByRole("button", { name: "重试" }).click()
  await expect(page).toHaveURL((url) => url.pathname === sessionPath(bookA), { timeout: 15_000 })
  await expectSessionTitle(page, bookA.boundTitle)
  const events = await readSlotEvents(page)
  expect(events.filter((event) => event.slot === slotChatEmpty)).toHaveLength(0)
  const lastContent = appeared(events)
    .filter((event) => event.slot === slotContent)
    .at(-1)
  expect(lastContent && new URL(lastContent.url).pathname).toBe(sessionPath(bookA))
})

test("session switch inside a book keeps the workspace mounted", async ({ page }) => {
  const dual = {
    ...bookA,
    novelID: "novel-e2e-transition-dual",
    title: "双会话验证书",
    boundTitle: "Dual first session",
    extraBoundIDs: ["ses_transition_second"],
  }
  await setup(page, [dual])
  await observeSlots(page)
  await page.goto(novelWorkspaceURL(directory, dual.novelID))
  await expect(page).toHaveURL((url) => url.pathname === sessionPath(dual), { timeout: 15_000 })
  await expectAppVisible(page.locator(`[data-slot="${slotContent}"]`))

  // 切换器内切换会话：工作台保持挂载（无卸载重挂的中间态），地址直达目标会话
  await page.getByLabel("Novel sessions").click()
  await page.getByText("ses_transition_second").click()
  await expect(page).toHaveURL(
    (url) => url.pathname === `${dirBase}/novel/${dual.novelID}/session/ses_transition_second`,
    { timeout: 15_000 },
  )

  const contentEvents = appeared(await readSlotEvents(page)).filter((event) => event.slot === slotContent)
  expect(contentEvents).toHaveLength(1)
  expect(new URL(contentEvents[0]!.url).pathname).toBe(sessionPath(dual))
})

const sessionPath = (book: BookSpec) => `${dirBase}/novel/${book.novelID}/session/${book.boundID}`
const bookPath = (novelID: string) => `${dirBase}/novel/${novelID}`

function appeared(events: SlotEvent[]) {
  return events.filter((event) => event.appear)
}

async function setup(page: Page, books: BookSpec[]) {
  const base = {
    slug: "s",
    projectID: "proj-book-transition",
    directory,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
  await mockOpenNovelServer(page, {
    sessions: books.flatMap((book) =>
      [book.boundID, ...(book.extraBoundIDs ?? [])].flatMap((id) =>
        id ? [{ ...base, id, slug: id, title: id === book.boundID ? (book.boundTitle ?? id) : id }] : [],
      ),
    ),
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-book-transition", directory },
    pageMessages: () => ({ items: [] }),
  })
  for (const book of books) {
    await mockNovelWorkspaceAPIs(page, {
      directory,
      novelID: book.novelID,
      novelTitle: book.title,
      boundSessionIDs: [book.boundID, ...(book.extraBoundIDs ?? [])].filter((id): id is string => !!id),
      chapterCount: 2,
    })
  }
  if (books.length > 1) {
    // 多书场景：每个单书 mock 只回自己的 bindings，这里合并覆盖（后注册路由优先），
    // 否则后注册的那本书会吞掉所有书的 session-bindings 响应。
    const bindings = books.flatMap((book) =>
      [book.boundID, ...(book.extraBoundIDs ?? [])].flatMap((id) =>
        id ? [{ sessionID: id, novelID: book.novelID, novelTitle: book.title }] : [],
      ),
    )
    await page.route(
      (url) => url.pathname === "/api/novel/session-bindings",
      (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bindings) }),
    )
  }
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opennovel.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree, expanded: true }] },
        lastProject: { local: worktree },
      }),
    )
  }, directory)
}

async function observeSlots(page: Page) {
  await page.addInitScript((slots: string[]) => {
    const timeline: SlotEvent[] = []
    const present: Record<string, boolean> = {}
    const scan = () => {
      for (const slot of slots) {
        const hit = !!document.querySelector(`[data-slot="${slot}"]`)
        if (hit === (present[slot] ?? false)) continue
        present[slot] = hit
        timeline.push({
          slot,
          appear: hit,
          url: location.href,
          snapshot:
            hit && slot === "novel-workspace-content"
              ? {
                  worldSidebar: !!document.querySelector('[data-slot="world-sidebar"]'),
                  structurePanel: !!document.querySelector('[data-slot="structure-panel"]'),
                }
              : undefined,
        })
      }
    }
    ;(window as unknown as { __slotTimeline: SlotEvent[] }).__slotTimeline = timeline
    new MutationObserver(scan).observe(document, { childList: true, subtree: true })
    scan()
  }, [slotLoading, slotContent, slotChatEmpty])
}

async function readSlotEvents(page: Page): Promise<SlotEvent[]> {
  return await page.evaluate(() => (window as unknown as { __slotTimeline?: SlotEvent[] }).__slotTimeline ?? [])
}
