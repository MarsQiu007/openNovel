/**
 * setting-review-hub 任务 5.5 — 设定收件箱 e2e 主路径。
 *
 * 打开设定树「整理」节点见收件箱（来源分组 + 待审徽标计数）→
 * 候选接受联动（条目移出列表、徽标计数递减）→
 * 暂存变更接受后留痕可见（成功横幅 + 接受请求落到服务端）。
 */
import { expect, test, type Page, type Route } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible } from "../utils/waits"

const directory = "/home/user/SettingReviewInbox"
const novelID = "novel-inbox-e2e"
const now = Date.now()

const candidateId = "pending-e2e-1"
const conflictId = "conflict-e2e-1"
const stagedId = "staged-e2e-1"

type InboxCounts = { candidates: number; conflicts: number; staged: number; total: number }

function inboxItems(input: { candidateAccepted: boolean; stagedAccepted: boolean }) {
  const items: Array<Record<string, unknown>> = []
  if (!input.candidateAccepted)
    items.push({
      id: candidateId,
      source: "candidate",
      kind: "world_entry",
      title: "藏经阁",
      targetId: null,
      summary: "候选条目：藏经阁",
      evidence: "importance=1",
      before: "",
      after: '{"category":"势力","title":"藏经阁","content":"藏经阁收藏青云门历代功法典籍。"}',
      status: "pending",
      createdAt: now,
      sourceChapterId: null,
      reviewNote: "",
    })
  items.push({
    id: conflictId,
    source: "conflict",
    kind: "number_inconsistency",
    title: "青云门",
    targetId: "entry-qingyun",
    summary: "正文称弟子三千，条目记为八百",
    evidence: "正文称弟子三千，条目记为八百",
    before: "",
    after: "",
    status: "unresolved",
    createdAt: now - 1,
    sourceChapterId: "chap-e2e-3",
    reviewNote: "",
  })
  if (!input.stagedAccepted)
    items.push({
      id: stagedId,
      source: "staged",
      kind: "update",
      title: "青云门",
      targetId: "entry-qingyun",
      summary: "补充门规设定",
      evidence: '{"conflict_id":"conflict-e2e-1"}',
      before: '{"title":"青云门"}',
      after: '{"title":"青云门","content":"青云门弟子三千。\\n\\n门规森严。"}',
      status: "pending",
      createdAt: now - 2,
      sourceChapterId: null,
      reviewNote: "",
    })
  return items
}

async function setupInboxRoutes(
  page: Page,
  state: { counts: InboxCounts; candidateAccepted: boolean; stagedAccepted: boolean; requests: string[] },
) {
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  // 后注册覆盖 mockNovelWorkspaceAPIs 的 /api/novel 空列表兜底
  await page.route(/\/api\/novel\/[^/]+\/review-inbox/, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    if (method === "GET" && path.endsWith("/counts")) return json(route, state.counts)
    if (method === "GET" && path.endsWith("/review-inbox"))
      return json(route, {
        items: inboxItems({ candidateAccepted: state.candidateAccepted, stagedAccepted: state.stagedAccepted }),
        total: state.counts.total,
        counts: state.counts,
      })
    if (method === "POST" && /\/candidates\/[^/]+\/accept$/.test(path)) {
      state.candidateAccepted = true
      state.counts.candidates -= 1
      state.counts.total -= 1
      state.requests.push(`POST ${path}`)
      return json(route, {
        ok: true,
        pendingId: candidateId,
        createdId: "entry-cangjingge",
        candidateType: "world_entry",
        displayTitle: "藏经阁",
        impact: { taskCount: 0, pendingCount: 0, blockedWriting: false },
      })
    }
    if (method === "POST" && /\/staged\/[^/]+\/accept$/.test(path)) {
      state.stagedAccepted = true
      state.counts.staged -= 1
      state.counts.total -= 1
      state.requests.push(`POST ${path}`)
      return json(route, {
        ok: true,
        stagedId,
        execution: {
          ok: true,
          errors: [],
          results: [
            {
              index: 0,
              action: "update",
              entityType: "world_entry",
              status: "success",
              entryIds: ["entry-qingyun"],
              changedFields: ["content"],
              historyCount: 1,
              cascadeTasks: 0,
            },
          ],
          remaining: [],
        },
      })
    }
    return json(route, { ok: false, error: "unexpected inbox route" })
  })
}

test("review inbox: badge decrement on candidate accept, staged accept leaves trace", async ({ page }) => {
  const state = {
    counts: { candidates: 1, conflicts: 1, staged: 1, total: 3 } as InboxCounts,
    candidateAccepted: false,
    stagedAccepted: false,
    requests: [] as string[],
  }

  await mockOpenNovelServer(page, {
    sessions: [],
    provider: { id: "opennovel", model: "gpt-4", provider: "opennovel" },
    directory,
    project: { id: "proj-inbox-e2e", directory },
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID })
  await setupInboxRoutes(page, state)

  await page.goto(novelWorkspaceURL(directory, novelID))
  await expectAppVisible(page.locator('[data-slot="novel-workspace-content"]'))

  // 打开设定树 → 「整理」节点渲染收件箱
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const organizationRow = page.getByRole("button", { name: /Organization/ })
  await expect(organizationRow).toBeVisible()
  await organizationRow.click()

  await expect(page.getByRole("heading", { name: "Review Inbox" })).toBeVisible()

  // 徽标显示待审总数 3（candidate + conflict + staged）
  await expect(organizationRow).toContainText("3")

  // 来源分组：三个来源各一张卡，冲突卡带说明，暂存卡带旧值/新值对照
  const candidateCard = page.locator('[data-testid="setting-inbox-card"][data-source="candidate"]')
  const conflictCard = page.locator('[data-testid="setting-inbox-card"][data-source="conflict"]')
  const stagedCard = page.locator('[data-testid="setting-inbox-card"][data-source="staged"]')
  await expect(candidateCard).toContainText("藏经阁")
  await expect(conflictCard).toContainText("正文称弟子三千，条目记为八百")
  await expect(stagedCard).toContainText("门规森严")

  // 候选接受联动：请求落服务端、横幅提示、条目移出列表、徽标计数递减
  await candidateCard.getByRole("button", { name: "Accept", exact: true }).click()
  await expect(page.getByText("Candidate accepted.")).toBeVisible()
  await expect(state.requests).toContain(`POST /api/novel/${novelID}/review-inbox/candidates/${candidateId}/accept`)
  await expect(candidateCard).toHaveCount(0)
  await expect(organizationRow).toContainText("2")

  // 暂存变更接受：留痕可见（接受请求 + 成功横幅 + 计数递减）
  await stagedCard.getByRole("button", { name: "Accept", exact: true }).click()
  await expect(page.getByText("Staged change accepted.")).toBeVisible()
  await expect(state.requests).toContain(`POST /api/novel/${novelID}/review-inbox/staged/${stagedId}/accept`)
  await expect(stagedCard).toHaveCount(0)
  await expect(organizationRow).toContainText("1")
})
