import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { installSseTransport, type SseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"
import {
  resetV2FixtureCounters,
  validateV2Timeline,
  v2AssistantMessage,
  v2Compaction,
  v2CompactionLifecycle,
  v2Event,
  v2Text,
  v2UserMessage,
  type V2FixtureMessage,
  type V2SseFrame,
} from "../utils/v2-fixture"

// 压缩全生命周期投影（5.5）：queued/running/failed/interrupted 状态卡与 completed 分隔线
// 在历史加载与实时流之间共享同一行身份；重复 delta 幂等、错误可读、操作可触发、
// 水位刷新事件落会话 store、SSE 断线重连后状态机仍可推进。
const directory = "C:/OpenNovel/CompactionLifecycle"
const novelID = "novel_compaction_lifecycle"
const projectID = "proj_compaction_lifecycle"
const sessionID = "ses_compaction_lifecycle"
const title = "Compaction lifecycle"
const model = { id: "claude-opus-4-6", providerID: "opennovel" }

test.use({ viewport: { width: 1440, height: 900 } })
test.beforeEach(() => resetV2FixtureCounters())

const statusCard = (page: Page) => page.locator('[data-slot="session-turn-compaction-status"]')
const compactionDetails = (page: Page) => page.locator('[data-slot="session-turn-compaction-details"]')

test("walks queued to running to completed on one stable card with an expandable summary", async ({ page }) => {
  const transport = await setup(page)
  const frames = v2CompactionLifecycle({
    directory,
    sessionID,
    messageID: "msg_compaction_walk",
    reason: "auto",
    text: "Compacted summary body",
    chunks: 2,
    terminal: "ended",
    endedUsage: { input: 6000, output: 400, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const [queued, started, ...rest] = frames

  await transport.send(queued)
  const card = statusCard(page)
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute("data-status", "queued")
  await expect(card).toContainText("Compaction queued")
  await expect(card).toContainText("Will run at the next safe boundary")
  await expect(card).toContainText("Automatic")
  await expect(card.getByRole("button", { name: "Cancel" })).toBeVisible()

  await transport.send(started)
  await expect(card).toHaveAttribute("data-status", "running")
  await expect(card).toContainText("Compacting context")
  await expect(card.getByRole("button", { name: "Stop" })).toBeVisible()

  // 重复投递全部 delta 两遍：单卡不变、无重复卡片、无跨消息串写（此时仅一条压缩消息）
  const deltas = rest.filter((frame) => frame.payload.type === "session.next.compaction.delta")
  for (let round = 0; round < 2; round++) for (const frame of deltas) await transport.send(frame)
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute("data-status", "running")

  const ended = rest.find((frame) => frame.payload.type === "session.next.compaction.ended")
  await transport.send(ended!)

  await expect(statusCard(page)).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="CompactionStatus"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
  await expect(compactionDetails(page)).toHaveCount(1)
  await compactionDetails(page).locator("summary").click()
  await expect(compactionDetails(page)).toContainText("Compacted summary body")
  await expect(compactionDetails(page)).toContainText("Summary cost: 6,000 in / 400 out")
})

test("shows a readable failure and re-queues compaction from the retry action", async ({ page }) => {
  let compacted = 0
  const transport = await setup(page, {
    onV2Compact: () => {
      compacted += 1
    },
  })
  const frames = v2CompactionLifecycle({
    directory,
    sessionID,
    messageID: "msg_compaction_failed",
    reason: "manual",
    text: "unused",
    chunks: 1,
    terminal: "failed",
    failedError: { type: "provider", message: "Compaction failed visibly" },
  })
  await transport.burst(frames)

  const card = statusCard(page)
  await expect(card).toHaveAttribute("data-status", "failed")
  await expect(card).toContainText("Compaction failed")
  await expect(card).toContainText("Compaction failed visibly")
  await expect(card).toContainText("Manual")

  await card.getByRole("button", { name: "Retry" }).click()
  await expect.poll(() => compacted).toBe(1)
})

test("cancels a queued compaction from the card action", async ({ page }) => {
  let cancelled: { sessionID: string; body: { messageID?: string } } | undefined
  const transport = await setup(page, {
    onV2CompactCancel: (input) => {
      cancelled = input
    },
  })
  const frames = v2CompactionLifecycle({
    directory,
    sessionID,
    messageID: "msg_compaction_cancel",
    reason: "auto",
    text: "unused",
    chunks: 1,
    terminal: "interrupted",
    interruptedCause: "restart",
  })
  // 只发 queued 帧，让卡片停在可撤销状态
  await transport.send(frames[0])

  await statusCard(page).getByRole("button", { name: "Cancel" }).click()
  await expect
    .poll(() => cancelled?.body.messageID)
    .toBe("msg_compaction_cancel")
  await expect.poll(() => cancelled?.sessionID).toBe(sessionID)
})

test("loads historical compaction states and keeps them stable after reload", async ({ page }) => {
  const messages = [
    v2UserMessage({ id: "msg_hist_01_user", text: "First prompt", created: 1700000000000 }),
    v2AssistantMessage({
      id: "msg_hist_02_assistant",
      content: [v2Text("First response")],
      created: 1700000001000,
      completed: 1700000002000,
      model,
    }),
    v2Compaction({
      id: "msg_hist_03_compaction",
      reason: "auto",
      summary: "Historical summary",
      recent: "recent context",
      status: "completed",
      created: 1700000003000,
      usage: { input: 4200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
    v2UserMessage({ id: "msg_hist_04_user", text: "Second prompt", created: 1700000004000 }),
    v2AssistantMessage({
      id: "msg_hist_05_assistant",
      content: [v2Text("Second response")],
      created: 1700000005000,
      completed: 1700000006000,
      model,
    }),
    v2Compaction({
      id: "msg_hist_06_compaction",
      reason: "manual",
      summary: "",
      recent: "",
      status: "failed",
      error: { type: "provider", message: "Historical compaction failed" },
      created: 1700000007000,
    }),
    v2Compaction({
      id: "msg_hist_07_compaction",
      reason: "manual",
      summary: "",
      recent: "",
      status: "interrupted",
      cause: "user",
      created: 1700000008000,
    }),
  ]
  validateV2Timeline(messages)
  await setup(page, { messages })

  const assertTimeline = async () => {
    await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
    await expect(compactionDetails(page)).toContainText("Historical summary")
    await expect(page.locator('[data-timeline-row="CompactionStatus"]')).toHaveCount(2)
    const cards = statusCard(page)
    await expect(cards.nth(0)).toHaveAttribute("data-status", "failed")
    await expect(cards.nth(0)).toContainText("Historical compaction failed")
    await expect(cards.nth(1)).toHaveAttribute("data-status", "interrupted")
    await expect(cards.nth(1)).toContainText("Compaction stopped")
    await expect(page.locator('[data-slot="session-turn-compaction-status"][data-status="running"]')).toHaveCount(0)
  }

  await assertTimeline()

  await page.reload()
  await expectSessionTitle(page, title)
  await assertTimeline()
})

test("applies a live watermark refresh and surfaces preparation state in the ring tooltip", async ({ page }) => {
  const transport = await setup(page)
  await transport.send(
    v2Event(directory, "session.context.watermark", {
      timestamp: 1700000009000,
      sessionID,
      watermark: {
        model,
        window: 200000,
        measured: 100000,
        estimated: 20000,
        total: 120000,
        ratio: 0.6,
        trigger: { share: 0.2, tokens: 160000 },
        source: "measured",
        preparing: true,
      },
    }),
  )

  const ring = page.getByRole("button", { name: "View context usage" })
  await expect(ring).toBeVisible()
  await ring.hover()
  const tooltip = page.locator('[data-component="tooltip-v2"]')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText("Preparing summary")
  await expect(tooltip).toContainText("60%")
  await expect(tooltip).toContainText("120,000")
  await expect(tooltip).toContainText("160,000")
})

test("keeps the lifecycle machine drivable after an SSE disconnect and reconnect", async ({ page }) => {
  const transport = await setup(page)
  const first = await transport.waitForConnection()
  const frames = v2CompactionLifecycle({
    directory,
    sessionID,
    messageID: "msg_compaction_reconnect",
    reason: "auto",
    text: "Post reconnect summary",
    chunks: 1,
    terminal: "ended",
  })

  await transport.send(frames[0])
  await expect(statusCard(page)).toHaveAttribute("data-status", "queued")

  await transport.error("compaction reconnect probe")
  await transport.waitForConnection({ after: first.id })

  await transport.send(frames[1])
  await expect(statusCard(page)).toHaveAttribute("data-status", "running")
  for (const frame of frames.slice(2)) await transport.send(frame)
  await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
  await expect(compactionDetails(page)).toContainText("Post reconnect summary")
})

test("does not duplicate compaction rows when scrolled out and back into view", async ({ page }) => {
  // store 按消息 ID 字典序排序（server-session reconcileFetched），fixture ID 必须随时间线单调递增
  const messages = [v2UserMessage({ id: "msg_scroll_01", text: "Scroll prompt", created: 1700000000000 })]
  messages.push(
    ...Array.from({ length: 12 }, (_, index) => index + 1).flatMap((n) => [
      v2UserMessage({
        id: `msg_scroll_${String(2 * n).padStart(2, "0")}`,
        text: `scroll turn ${n} prompt`,
        created: 1700000000000 + n * 2000,
      }),
      v2AssistantMessage({
        id: `msg_scroll_${String(2 * n + 1).padStart(2, "0")}`,
        content: [v2Text(`scroll turn ${n} response`)],
        created: 1700000000000 + n * 2000 + 500,
        completed: 1700000000000 + n * 2000 + 1000,
        model,
      }),
    ]),
  )
  messages.push(
    v2Compaction({
      id: "msg_scroll_26",
      reason: "auto",
      summary: "Scrolled historical summary",
      recent: "recent context",
      status: "completed",
      created: 1700000026000,
    }),
    v2AssistantMessage({
      id: "msg_scroll_27",
      content: [v2Text("after compaction response")],
      created: 1700000027000,
      completed: 1700000027100,
      model,
    }),
  )
  validateV2Timeline(messages)
  await setup(page, { messages })

  const scroller = page.locator('.scroll-view__viewport:not(:has(.scroll-view__viewport))', {
    has: page.locator("[data-timeline-row]"),
  })
  // 虚拟滚动只渲染可视窗口：compaction 位于历史末尾，先滚到底再断言
  await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
  await expect(compactionDetails(page)).toHaveCount(1)
  await scroller.evaluate((element) => (element.scrollTop = 0))
  await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))

  await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
  await expect(compactionDetails(page)).toHaveCount(1)
  await expect(statusCard(page)).toHaveCount(0)
})

async function setup(
  page: Page,
  options: {
    messages?: V2FixtureMessage[]
    active?: Record<string, unknown> | (() => Record<string, unknown>)
    onV2Compact?: (input: { sessionID: string }) => void
    onV2CompactCancel?: (input: { sessionID: string; body: { messageID?: string } }) => void
  } = {},
): Promise<SseTransport<V2SseFrame>> {
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
      name: "compaction-lifecycle",
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
        slug: "compaction-lifecycle",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    v2Messages: () => options.messages ?? [],
    v2Active: options.active,
    onV2Compact: options.onV2Compact,
    onV2CompactCancel: options.onV2CompactCancel,
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
