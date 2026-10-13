import { expect, test, type Page } from "@playwright/test"
import {
  assistantMessage,
  directory,
  messageUpdated,
  novelID,
  project,
  session,
  sessionID,
  status,
  textPart,
  title,
  userID,
  userMessage,
} from "../performance/timeline-stability/fixture"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const initialPageSize = 20
const historyPageSize = 200
const assistants = Array.from({ length: initialPageSize + 1 }, (_, index) =>
  assistantMessage([textPart(`prt_history_root_${index}`, `Assistant response ${index}`)], {
    id: `msg_${String(index + 1001).padStart(4, "0")}_history_root_assistant`,
    parentID: userID,
    created: 1700000001000 + index * 1_000,
    completed: index < initialPageSize,
  }),
)
const messages = [userMessage(), ...assistants]
const lastAssistant = assistants.at(-1)!
const lastPartID = assistants.at(-1)!.parts[0]!.id
const userPartID = `prt_${userID}_text`
const completed = {
  ...lastAssistant.info,
  time: { ...lastAssistant.info.time, completed: lastAssistant.info.time.created + 15_000 },
}
const scenarios = [
  { name: "completion", info: completed, idleFirst: false, interrupted: false },
  {
    name: "interruption",
    info: { ...completed, error: { name: "MessageAbortedError", data: { message: "Stopped" } } },
    idleFirst: true,
    interrupted: true,
  },
] as const

// 会话页嵌入工作台右栏（session-book-only）：宽度需容纳左栏+右栏对话面板；高度保留原窄高视口意图
test.use({ viewport: { width: 1200, height: 1385 } })

for (const scenario of scenarios) {
  test(`keeps visible timeline content visible through ${scenario.name}`, async ({ page }) => {
    const requests: { before?: string; phase: "start" | "end" }[] = []
    const pages: { before?: string; limit: number }[] = []
    const roots: { sessionID: string; messageID: string }[] = []
    const sequence: string[] = []
    const history = Promise.withResolvers<void>()
    const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, {
      server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
      retry: 20,
    })
    await mockOpenNovelServer(page, {
      directory,
      project: project(),
      provider: {
        all: [
          {
            id: "opennovel",
            name: "OpenNovel",
            models: {
              "claude-opus-4-6": {
                id: "claude-opus-4-6",
                name: "Claude Opus 4.6",
                limit: { context: 200_000 },
              },
            },
          },
        ],
        connected: ["opennovel"],
        default: { providerID: "opennovel", modelID: "claude-opus-4-6" },
      },
      sessions: [session()],
      sessionStatus: { [sessionID]: { type: "busy" } },
      beforeMessagesResponse: (request) => (request.before ? history.promise : Promise.resolve()),
      onMessages: (request) => {
        requests.push(request)
        sequence.push(`messages:${request.phase}:${request.before ?? "latest"}`)
      },
      onMessage: (request) => {
        roots.push(request)
        sequence.push(`message:${request.messageID}`)
      },
      message: (requestedSessionID, messageID) => {
        if (requestedSessionID !== sessionID) return
        return messages.find((item) => item.info.id === messageID)
      },
      pageMessages: (_, limit, before) => {
        pages.push({ before, limit })
        const end = before ? messages.findIndex((message) => message.info.id === before) : messages.length
        const start = Math.max(0, end - limit)
        return {
          items: messages.slice(start, end),
          cursor: start > 0 ? messages[start]!.info.id : undefined,
        }
      },
    })
    await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
    await page.addInitScript(() => {
      // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区
      localStorage.setItem(
        "opennovel.global.dat:novel.workspace.layout.v1",
        JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
      )
    })
    await page.addInitScript(() => {
      const visibleParts = () => {
        const virtual = document.querySelector<HTMLElement>("[data-timeline-virtual-content]")
        const viewport = virtual?.closest<HTMLElement>(".scroll-view__viewport")
        const view = viewport?.getBoundingClientRect()
        if (!viewport || !view) return []
        return [...viewport.querySelectorAll<HTMLElement>("[data-timeline-part-id]")]
          .filter((part) => {
            const rect = part.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom
          })
          .flatMap((part) => (part.dataset.timelinePartId ? [part.dataset.timelinePartId] : []))
      }
      const state = {
        armed: false,
        hidden: false,
        visibleParts: [] as string[],
        samples: 0,
        stop: false,
        debug: null as unknown,
        arm() {
          // 只锁定视口最上方的少量 part：历史分页插入在锚点下方时，其余可见行按设计会整体下移，
          // 锁定这些行会在"插入位置下方的折叠边缘 part"上产生与滚动行为无关的抖动。
          state.visibleParts = visibleParts().slice(0, 3)
          state.armed = true
        },
      }
      ;(window as Window & { __historyRootProbe?: typeof state }).__historyRootProbe = state
      const sample = () => {
        if (state.armed) {
          const virtual = document.querySelector<HTMLElement>("[data-timeline-virtual-content]")
          const viewport = virtual?.closest<HTMLElement>(".scroll-view__viewport")
          const view = viewport?.getBoundingClientRect()
          const visible = (partID: string) => {
            const part = viewport?.querySelector<HTMLElement>(`[data-timeline-part-id="${CSS.escape(partID)}"]`)
            const rect = part?.getBoundingClientRect()
            return (
              !!rect && !!view && rect.width > 0 && rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom
            )
          }
          if (
            !state.hidden &&
            (!virtual || state.visibleParts.length === 0 || state.visibleParts.some((partID) => !visible(partID)))
          ) {
            state.hidden = true
            state.debug = {
              sample: state.samples,
              scrollTop: viewport?.scrollTop ?? null,
              missing: state.visibleParts.filter((partID) => !visible(partID)).slice(0, 5),
            }
          }
          state.samples++
        }
        if (!state.stop) requestAnimationFrame(() => setTimeout(sample, 0))
      }
      requestAnimationFrame(() => setTimeout(sample, 0))
    })

    await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
    await transport.waitForConnection()
    await expectSessionTitle(page, title)
    await expect(page.locator(`[data-timeline-part-id="${lastPartID}"]`)).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${userPartID}"]`)).toBeVisible()
    await expect.poll(() => requests.filter((request) => request.phase === "start").length).toBe(2)
    expect(requests.filter((request) => request.phase === "end")).toHaveLength(1)
    expect(sequence.slice(0, 4)).toEqual([
      "messages:start:latest",
      "messages:end:latest",
      `message:${userID}`,
      `messages:start:${messages.at(-initialPageSize)!.info.id}`,
    ])
    await expect(page.locator('[data-timeline-part-id^="prt_history_root_"]')).toHaveCount(initialPageSize)
    // 与真实用户一致：先滚到顶部（离开"跟随底部"模式，历史分页请求保持进行中），再捕获需要保持可见的内容
    const timelineViewport = page.locator(".scroll-view__viewport:has([data-timeline-virtual-content])")
    await timelineViewport.hover()
    await page.mouse.wheel(0, -100_000)
    await expect.poll(() => timelineViewport.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(1)
    await page.evaluate(() => {
      ;(
        window as Window & {
          __historyRootProbe?: { arm(): void }
        }
      ).__historyRootProbe!.arm()
    })
    await waitForProbeSamples(page, 0)
    expect(await visibleContentHidden(page)).toBe(false)
    const beforeHistory = await probeSamples(page)
    history.resolve()
    await expect(page.locator('[data-timeline-part-id^="prt_history_root_"]')).toHaveCount(assistants.length)
    await expect.poll(() => requests.filter((request) => request.phase === "end").length).toBe(2)
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
    await waitForProbeSamples(page, beforeHistory)
    expect(pages).toEqual([
      { before: undefined, limit: initialPageSize },
      { before: messages.at(-initialPageSize)!.info.id, limit: historyPageSize },
    ])
    expect(roots).toEqual([{ sessionID, messageID: userID }])

    const message = messageUpdated(scenario.info)
    const idle = status("idle")
    for (const event of scenario.idleFirst ? [idle, message] : [message, idle]) {
      const beforeEvent = await probeSamples(page)
      await transport.send(event)
      if (event === idle) await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
      if (event === message && scenario.interrupted)
        await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
      await waitForProbeSamples(page, beforeEvent)
      const current = await timelineState(page)
      expect(current, JSON.stringify(current)).toMatchObject({ virtual: true })
      expect(current.rows, JSON.stringify(current)).toBeGreaterThan(0)
    }

    expect(requests[0]).toEqual({ before: undefined, phase: "start", sessionID })
    expect(requests[1]).toEqual({ before: undefined, phase: "end", sessionID })
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="bottom-spacer"]')).toBeVisible()
    if (scenario.interrupted) await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
    const finalState = await page.evaluate(() => {
      const state = (window as Window & { __historyRootProbe?: { hidden: boolean; stop: boolean; debug: unknown } })
        .__historyRootProbe!
      state.stop = true
      return { hidden: state.hidden, debug: state.debug }
    })
    expect(finalState.hidden, JSON.stringify(finalState)).toBe(false)
  })
}

function timelineState(page: Page) {
  return page.evaluate(() => ({
    virtual: !!document.querySelector("[data-timeline-virtual-content]"),
    rows: document.querySelectorAll("[data-timeline-key]").length,
  }))
}

function probeSamples(page: Page) {
  return page.evaluate(
    () => (window as Window & { __historyRootProbe?: { samples: number } }).__historyRootProbe!.samples,
  )
}

async function waitForProbeSamples(page: Page, after: number) {
  await page.waitForFunction(
    (after) =>
      (window as Window & { __historyRootProbe?: { samples: number } }).__historyRootProbe!.samples >= after + 3,
    after,
  )
}

function visibleContentHidden(page: Page) {
  return page.evaluate(
    () => (window as Window & { __historyRootProbe?: { hidden: boolean } }).__historyRootProbe!.hidden,
  )
}
