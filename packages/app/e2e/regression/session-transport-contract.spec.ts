import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { installSseTransport, type SseTransport } from "../utils/sse-transport"
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

// SSE 传输契约（接班被删 session-timeline-transport）：连接复用、单 chunk burst、
// 多字节切分、心跳无副作用、close/error 重连、Last-Event-ID 回传与非事件 fetch 穿透。
// payload 统一用 V2 text 链（text.started → text.delta → text.ended）驱动时间线。
const directory = "C:/OpenNovel/TransportContract"
const novelID = "novel_transport_contract"
const projectID = "proj_transport_contract"
const sessionID = "ses_transport_contract"
const title = "Transport contract"
const assistantID = "msg_transport_assistant"

test.use({ viewport: { width: 1440, height: 900 } })
test.beforeEach(() => resetV2FixtureCounters())

test("keeps one connection open while delivering multiple events", async ({ page }) => {
  const transport = await setup(page)

  const first = await transport.burst(textChain("prt_transport_first", "first event"))
  const second = await transport.burst(textChain("prt_transport_second", "second event"))

  await waitForPart(page, "prt_transport_first")
  await waitForPart(page, "prt_transport_second")
  expect(first[0]!.connectionID).toBe(second[0]!.connectionID)
  expect(await transport.connections()).toHaveLength(1)
  expect(await transport.acknowledgements()).toHaveLength(6)
})

test("delivers a burst from one stream chunk", async ({ page }) => {
  const transport = await setup(page)
  const acknowledgements = await transport.burst([
    ...textChain("prt_transport_burst_a", "burst a"),
    ...textChain("prt_transport_burst_b", "burst b"),
  ])

  await waitForPart(page, "prt_transport_burst_a")
  await waitForPart(page, "prt_transport_burst_b")
  expect(acknowledgements.map((item) => item.chunkCount)).toEqual([1, 1, 1, 1, 1, 1])
  expect(new Set(acknowledgements.map((item) => item.deliveryID)).size).toBe(6)
})

test("parses split JSON and a split multibyte code point", async ({ page }) => {
  const transport = await setup(page)
  const text = "split snowman ⛄⛄⛄"
  await transport.send(textStarted("prt_transport_split"))
  const payload = textDelta("prt_transport_split", text)
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
  const snowman = new TextEncoder().encode("⛄")[0]!
  const multibyte = encoded.indexOf(snowman)

  const acknowledgement = await transport.split(payload, [9, multibyte + 1, multibyte + 2])
  await transport.send(textEnded("prt_transport_split", text))

  await waitForPart(page, "prt_transport_split")
  await expect(page.locator('[data-timeline-part-id="prt_transport_split"]')).toContainText(text)
  expect(acknowledgement.chunkCount).toBe(4)
})

test("delivers server heartbeat without mutating the timeline", async ({ page }) => {
  const transport = await setup(page, {
    messages: seedMessages([v2Text("steady", "prt_transport_steady")]),
  })
  const before = await page.locator("[data-timeline-row]").allTextContents()

  await transport.heartbeat()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))

  expect(await page.locator("[data-timeline-row]").allTextContents()).toEqual(before)
  expect(await transport.connections()).toHaveLength(1)
})

test("reconnects after a clean close", async ({ page }) => {
  const transport = await setup(page, { retry: 10 })
  const first = await transport.waitForConnection()

  await transport.close()
  const second = await transport.waitForConnection({ after: first.id })
  await transport.burst(textChain("prt_transport_close", "after close"))

  await waitForPart(page, "prt_transport_close")
  expect(second.id).toBeGreaterThan(first.id)
  expect((await transport.connections())[0]?.endedBy).toBe("close")
})

test("reconnects after a stream error", async ({ page }) => {
  const transport = await setup(page, { retry: 10 })
  const first = await transport.waitForConnection()

  await transport.error("contract failure")
  const second = await transport.waitForConnection({ after: first.id })
  await transport.burst(textChain("prt_transport_error", "after error"))

  await waitForPart(page, "prt_transport_error")
  expect(second.id).toBeGreaterThan(first.id)
  expect((await transport.connections())[0]?.endedBy).toBe("error")
})

test("records event IDs and reconnect Last-Event-ID headers", async ({ page }) => {
  const transport = await setup(page, { retry: 10 })
  const first = await transport.send(textStarted("prt_transport_id"), { id: "timeline-event-7" })
  await transport.send(textDelta("prt_transport_id", "event with id"))
  await transport.send(textEnded("prt_transport_id", "event with id"))
  await waitForPart(page, "prt_transport_id")

  await transport.error("retry with event id")
  const connection = await transport.waitForConnection({ after: first.connectionID })

  expect(first.eventID).toBe("timeline-event-7")
  expect(connection.headers["last-event-id"]).toBe("timeline-event-7")
})

test("passes through non-event fetches", async ({ page }) => {
  const transport = await setup(page)

  const health = await page.evaluate(async () => {
    const response = await fetch("/global/health")
    return response.json()
  })

  expect(health).toEqual({ healthy: true })
  expect(await transport.connections()).toHaveLength(1)
})

let clock = 1700000000000
const nextTime = () => (clock += 1000)

function textStarted(textID: string): V2SseFrame {
  return v2Event(directory, "session.next.text.started", {
    timestamp: nextTime(),
    sessionID,
    assistantMessageID: assistantID,
    textID,
  })
}

function textDelta(textID: string, delta: string): V2SseFrame {
  return v2Event(directory, "session.next.text.delta", {
    timestamp: nextTime(),
    sessionID,
    assistantMessageID: assistantID,
    textID,
    delta,
  })
}

function textEnded(textID: string, text: string): V2SseFrame {
  return v2Event(directory, "session.next.text.ended", {
    timestamp: nextTime(),
    sessionID,
    assistantMessageID: assistantID,
    textID,
    text,
  })
}

/** 完整 text 链：started → delta(全量) → ended(全量)，供单次 burst 投递 */
function textChain(textID: string, text: string): V2SseFrame[] {
  return [textStarted(textID), textDelta(textID, text), textEnded(textID, text)]
}

function seedMessages(content: Parameters<typeof v2AssistantMessage>[0]["content"] = []) {
  return [
    v2UserMessage({ id: "msg_transport_user", text: "Transport contract prompt", created: 1699999999000 }),
    v2AssistantMessage({
      id: assistantID,
      created: 1699999999000,
      model: { id: "claude-opus-4-6", providerID: "opennovel" },
      agent: "build",
      content,
    }),
  ]
}

async function setup(
  page: Page,
  options: { retry?: number; messages?: V2FixtureMessage[] } = {},
): Promise<SseTransport<V2SseFrame>> {
  const transport = await installSseTransport<V2SseFrame>(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: options.retry,
  })
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "transport-contract",
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
        slug: "transport-contract",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    v2Messages: () => options.messages ?? seedMessages(),
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  return transport
}

function waitForPart(page: Page, partID: string) {
  return expect(page.locator(`[data-timeline-part-id="${partID}"]`)).toBeVisible()
}
