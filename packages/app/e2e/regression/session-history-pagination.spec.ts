import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"
import {
  resetV2FixtureCounters,
  v2AssistantMessage,
  v2Event,
  v2Text,
  v2UserMessage,
  type V2FixtureMessage,
  type V2SseFrame,
} from "../utils/v2-fixture"

// 历史分页（接班被删 session-timeline-history-root）：V2 wire 的 assistant 不带
// parentID，页首孤儿 assistant 由「prepend 历史页带来 user 根 + repairParentIDs
// 重锚」解决——父消息补拉没有单条 GET，恰经一次 cursor 历史页到达。覆盖两阶段
// 请求序列（limit 20 → limit 200 + cursor）、cursor 形状与挂起期间 SSE 锚点零位移。
const directory = "C:/OpenNovel/HistoryPagination"
const novelID = "novel_history_pagination"
const projectID = "proj_history_pagination"
const sessionID = "ses_history_pagination"
const title = "History pagination"
const model = { id: "claude-opus-4-6", providerID: "opennovel" }

test.use({ viewport: { width: 1440, height: 900 } })
test.beforeEach(() => resetV2FixtureCounters())

test("pages history in two phases and backfills the user root exactly once", async ({ page }) => {
  const requests: { cursor?: string; limit: number; phase: "start" | "end" }[] = []
  const singleMessageRequests: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (new RegExp(`^/api/session/${sessionID}/message/[^/]+$`).test(path)) singleMessageRequests.push(path)
  })
  await setup(page, {
    messages: rootFixture(),
    onMessages: (input) => requests.push({ cursor: input.cursor, limit: input.limit, phase: input.phase }),
  })

  // 首屏 20 条全为孤儿 assistant（user 根在更早历史）：不可见、不溢出，fill 效果
  // 自动触发第二阶段 limit 200 的 cursor 历史页，把 user 根 prepend 进来并重锚
  await expect.poll(() => requests.length).toBe(4)
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await scroller.evaluate((element) => (element.scrollTop = 0))
  await expect(page.locator('[data-timeline-part-id="msg_hist_000:text"]')).toHaveCount(1)
  await expect(page.locator('[data-timeline-part-id="prt_hist_001"]')).toHaveCount(1)

  expect(requests).toEqual([
    { cursor: undefined, limit: 20, phase: "start" },
    { cursor: undefined, limit: 20, phase: "end" },
    { cursor: "msg_hist_a02", limit: 200, phase: "start" },
    { cursor: "msg_hist_a02", limit: 200, phase: "end" },
  ])
  // 父消息补拉恰一次：user 根经历史页到达，单条消息 GET 全程零调用
  expect(singleMessageRequests).toEqual([])
})

test("keeps the scroll anchor unmoved by SSE while a history page is pending", async ({ page }) => {
  const requests: { cursor?: string; limit: number; phase: "start" | "end" }[] = []
  const history = Promise.withResolvers<void>()
  const transport = await setup(page, {
    messages: turnFixture(15),
    onMessages: (input) => requests.push(input),
    beforeMessagesResponse: (input) => (input.cursor ? history.promise : Promise.resolve()),
  })
  await expect(page.locator('[data-timeline-part-id="prt_hist_015"]')).toBeVisible()

  // 与真实用户一致：滚到顶部触发历史分页（请求挂起在 gate 上），锁定视口顶部 part
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await pointAtTimeline(page, scroller)
  const deadline = Date.now() + 60_000
  while (!requests.some((request) => request.cursor && request.phase === "start")) {
    if (Date.now() >= deadline) throw new Error("Timed out scrolling to the history boundary")
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(20)
  }
  for (let index = 0; index < 12; index++) {
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(20)
  }
  const keys = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    return [...element.querySelectorAll<HTMLElement>("[data-timeline-part-id]")]
      .filter((row) => {
        const rect = row.getBoundingClientRect()
        return rect.bottom > view.top && rect.top < view.bottom
      })
      .map((row) => row.dataset.timelinePartId)
      .filter((id): id is string => !!id)
      .slice(0, 3)
  })
  expect(keys.length).toBeGreaterThan(0)
  const positions = () =>
    scroller.evaluate((element, keys) => {
      const top = element.getBoundingClientRect().top
      return Object.fromEntries(
        keys.map((key) => {
          const row = element.querySelector<HTMLElement>(`[data-timeline-part-id="${key}"]`)
          if (!row) throw new Error(`Missing stable timeline key: ${key}`)
          return [key, Math.round((row.getBoundingClientRect().top - top) * devicePixelRatio) / devicePixelRatio]
        }),
      )
    }, keys)
  const before = await positions()

  // 挂起期间向最新 assistant 推送 text 链：视口锁定内容零位移
  const ssePartID = "prt_hist_sse"
  for (const frame of textChain("msg_hist_015_b", ssePartID, "SSE delivery during pending history"))
    await transport.send(frame)
  await settle(page)
  expect(await positions()).toEqual(before)
  expect(requests.some((request) => request.cursor && request.phase === "end")).toBe(false)

  // 放行历史页：prepend 锚定补偿后锁定内容位置保持，最早回合内容可达
  history.resolve()
  await expect.poll(() => requests.filter((request) => request.phase === "end")).toHaveLength(2)
  // prepend 锚定补偿需数帧收敛，轮询到位置复原
  await expect.poll(positions).toEqual(before)
  await scroller.evaluate((element) => (element.scrollTop = 0))
  await expect(page.locator('[data-timeline-part-id="prt_hist_001"]')).toBeVisible()
})

let clock = 1700000100000
const nextTime = () => (clock += 1000)

function textChain(assistantMessageID: string, textID: string, text: string): V2SseFrame[] {
  const base = () => ({ timestamp: nextTime(), sessionID, assistantMessageID, textID })
  return [
    v2Event(directory, "session.next.text.started", base()),
    v2Event(directory, "session.next.text.delta", { ...base(), delta: text }),
    v2Event(directory, "session.next.text.ended", { ...base(), text }),
  ]
}

/** user 根 + 21 条 assistant：首屏 limit 20 全为孤儿 assistant，user 根待历史页补拉 */
function rootFixture(): V2FixtureMessage[] {
  return [
    v2UserMessage({ id: "msg_hist_000", text: "root prompt", created: 1700000000000 }),
    ...Array.from({ length: 21 }, (_, index) =>
      v2AssistantMessage({
        id: `msg_hist_a${String(index + 1).padStart(2, "0")}`,
        created: 1700000001000 + index * 1000,
        completed: 1700000001500 + index * 1000,
        model,
        agent: "build",
        content: [v2Text(`rooted response ${index + 1}`, `prt_hist_${String(index + 1).padStart(3, "0")}`)],
      }),
    ),
  ]
}

/** N 个完整回合（user+assistant 成对）：首屏 limit 20 含完整回合，更老回合待 cursor 页 */
function turnFixture(turns: number): V2FixtureMessage[] {
  return Array.from({ length: turns }, (_, index) => index + 1).flatMap((n) => {
    const id = String(n).padStart(3, "0")
    return [
      v2UserMessage({ id: `msg_hist_${id}_a`, text: `turn ${n} prompt`, created: 1700000000000 + n * 10_000 }),
      v2AssistantMessage({
        id: `msg_hist_${id}_b`,
        created: 1700000001000 + n * 10_000,
        completed: 1700000002000 + n * 10_000,
        model,
        agent: "build",
        content: [v2Text(`turn ${n} response ${"filler ".repeat(60)}`, `prt_hist_${id}`)],
      }),
    ]
  })
}

async function setup(
  page: Page,
  options: {
    messages: V2FixtureMessage[]
    onMessages?: (input: { cursor?: string; limit: number; phase: "start" | "end" }) => void
    beforeMessagesResponse?: (input: { sessionID: string; cursor?: string }) => Promise<void>
  },
) {
  const transport = await installSseTransport<V2SseFrame>(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: 20,
  })
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "history-pagination",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opennovel",
          name: "OpenNovel",
          models: {
            "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
          },
        },
      ],
      connected: ["opennovel"],
      default: { providerID: "opennovel", modelID: "claude-opus-4-6" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "history-pagination",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    v2Messages: () => options.messages,
    onV2Messages: options.onMessages,
    beforeV2MessagesResponse: options.beforeMessagesResponse,
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
  await page.addInitScript(() => {
    // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区
    localStorage.setItem(
      "opennovel.global.dat:novel.workspace.layout.v1",
      JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
    )
  })
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  return transport
}

async function pointAtTimeline(page: Page, scroller: ReturnType<Page["locator"]>) {
  const box = await scroller.boundingBox()
  if (!box) throw new Error("Timeline scroller is not visible")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
      ),
  )
}
