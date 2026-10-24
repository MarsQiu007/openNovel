/**
 * agent-memory-ui 任务 2.6 — 记忆面板 e2e 主路径。
 *
 * 打开设定树「记忆」节点见面板（待办徽标）→ 状态过滤 → 批准联动
 * （卡片移出过滤列表、徽标计数递减）→ 登记手记（请求落服务端、列表可见新卡）。
 */
import { expect, test, type Page, type Route } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible } from "../utils/waits"

const directory = "/home/user/MemoryPanel"
const novelID = "novel-memory-e2e"
const now = Date.now()

type MemoryCounts = { pending: number; reviewed: number; stale: number; total: number }
type MemoryItem = Record<string, unknown>

const pendingFact: MemoryItem = {
  id: "fact-pending-1",
  factType: "timeline",
  entityHint: "沈辞",
  text: "沈辞在第三章获得玄铁剑",
  quote: "剑身黝黑，入手微凉。",
  chapterId: "chap-1",
  chapterOrder: 1,
  status: "pending",
  retiredInto: null,
  confidence: 50,
  proofCount: 1,
  createdBy: "observer",
  createdAt: now,
  updatedAt: now,
}

const approvedFact: MemoryItem = {
  ...pendingFact,
  id: "fact-approved-1",
  text: "青云门位于青州北境",
  quote: null,
  status: "approved",
}

function listBody(state: { counts: MemoryCounts; items: MemoryItem[] }, url: URL) {
  const status = url.searchParams.get("status")
  const q = url.searchParams.get("q")
  const items = state.items.filter((item) => {
    if (status && item.status !== status) return false
    if (q && !String(item.text).includes(q) && !String(item.quote ?? "").includes(q)) return false
    return true
  })
  return { items, total: items.length, counts: state.counts }
}

async function setupMemoryRoutes(
  page: Page,
  state: { counts: MemoryCounts; items: MemoryItem[]; requests: string[] },
) {
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  // 后注册覆盖 mockNovelWorkspaceAPIs 的 /api/novel 空列表兜底
  await page.route(/\/api\/novel\/[^/]+\/memory-(facts|maintenance)/, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    if (method === "GET" && path.endsWith("/counts")) return json(route, state.counts)
    if (method === "GET" && path.endsWith("/memory-maintenance"))
      return json(route, { zombieFacts: [], planned: [], retiredStats: { facts: 0, techniques: 0 }, stalledThreshold: 10 })
    if (method === "GET" && path.endsWith("/memory-facts")) return json(route, listBody(state, url))
    if (method === "POST" && /\/memory-facts\/[^/]+\/approve$/.test(path)) {
      const fact = state.items.find((item) => item.id === "fact-pending-1")
      if (fact) fact.status = "approved"
      state.counts.pending -= 1
      state.counts.total -= 1
      state.requests.push(`POST ${path}`)
      return json(route, { ok: true, factId: "fact-pending-1", status: "approved" })
    }
    if (method === "POST" && path.endsWith("/memory-facts")) {
      const body = route.request().postDataJSON() as { text: string; quote?: string }
      state.items.unshift({
        ...pendingFact,
        id: "fact-note-1",
        factType: "note",
        entityHint: null,
        text: body.text,
        quote: body.quote ?? null,
        chapterId: null,
        chapterOrder: null,
        status: "pending",
        createdBy: "author",
      })
      state.counts.pending += 1
      state.counts.total += 1
      state.requests.push(`POST ${path}`)
      return json(route, { ok: true, factId: "fact-note-1", status: "pending" })
    }
    return json(route, { ok: false, error: "unexpected memory route" })
  })
}

test("memory panel: filter → approve decrements badge; author note appears in list", async ({ page }) => {
  const state = {
    counts: { pending: 1, reviewed: 0, stale: 0, total: 1 } as MemoryCounts,
    items: [pendingFact, approvedFact].map((item) => ({ ...item })),
    requests: [] as string[],
  }

  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-memory-e2e", directory },
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, chapterCount: 1 })
  await setupMemoryRoutes(page, state)

  await page.goto(novelWorkspaceURL(directory, novelID))
  await expectAppVisible(page.locator('[data-slot="novel-workspace-content"]'))

  // 打开设定树 → 「记忆」节点渲染面板
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const memoryRow = page.getByRole("button", { name: /Memory/ })
  await expect(memoryRow).toBeVisible()
  await memoryRow.click()
  await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible()

  // 徽标显示待办总数 1（pending）
  await expect(memoryRow).toContainText("1")

  // 默认全部：两张卡可见；状态过滤 Pending 后只剩待审卡
  await expect(page.locator('[data-testid="memory-fact-card"]')).toHaveCount(2)
  await page.getByRole("button", { name: "Pending", exact: true }).click()
  const pendingCard = page.locator('[data-testid="memory-fact-card"][data-status="pending"]')
  await expect(page.locator('[data-testid="memory-fact-card"]')).toHaveCount(1)
  await expect(pendingCard).toContainText("沈辞在第三章获得玄铁剑")
  await expect(pendingCard).toContainText("剑身黝黑，入手微凉。")

  // 批准联动：请求落服务端、成功横幅、卡片移出过滤列表、徽标递减
  await pendingCard.getByRole("button", { name: "Approve", exact: true }).click()
  await expect(page.getByText("Approved.")).toBeVisible()
  await expect(state.requests).toContain(`POST /api/novel/${novelID}/memory-facts/fact-pending-1/approve`)
  await expect(page.locator('[data-testid="memory-fact-card"]')).toHaveCount(0)
  await expect(memoryRow).not.toContainText("1")

  // 登记手记：陈述必填提交 → 请求落服务端；切回全部过滤可见新卡（作者手记标记）
  await page.getByRole("button", { name: "Add note", exact: true }).click()
  await page.getByPlaceholder("Fact statement (required)…").fill("主角的真实身份是前朝遗孤")
  await page.getByRole("button", { name: "Register", exact: true }).click()
  await expect(state.requests).toContain(`POST /api/novel/${novelID}/memory-facts`)
  await page.getByRole("button", { name: "All", exact: true }).click()
  const noteCard = page.locator('[data-testid="memory-fact-card"][data-id="fact-note-1"]')
  await expect(noteCard).toContainText("主角的真实身份是前朝遗孤")
  await expect(noteCard).toContainText("Author note")
})
