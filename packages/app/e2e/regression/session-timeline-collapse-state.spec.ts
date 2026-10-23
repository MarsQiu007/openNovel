import { expect, test, type Locator, type Page } from "@playwright/test"
import type { SessionMessageAssistantTool } from "@opennovel-ai/sdk/v2/client"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import {
  v2AssistantMessage,
  v2Event,
  v2Tool,
  v2ToolCompleted,
  v2UserMessage,
  type V2FixtureMessage,
  type V2SseFrame,
} from "../utils/v2-fixture"

const directory = "C:/OpenNovel/TimelineStateRegression"
const novelID = "novel_timeline_state_regression"
const projectID = "proj_timeline_state_regression"
const sessionID = "ses_timeline_state_regression"
const userMessageID = "msg_user_regression"
const assistantMessageID = "msg_assistant_regression"
const editPartID = "prt_0001_edit"
const textPartID = "prt_9999_text"
const title = "Timeline collapse state regression"
const model = { providerID: "opennovel", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = V2SseFrame

declare global {
  interface Window {
    __timelineDiffProbe: {
      reset: () => void
      shadowRoots: () => number
    }
  }
}

const userMessage = v2UserMessage({ id: userMessageID, text: "Please edit the file.", created: 1700000000000 })

/** edit 工具的 structured（adapter 整体透传为视图模型 metadata；title 供 structuredTitle 读取） */
function editStructured(input?: { additions?: number; before?: string; after?: string }) {
  return {
    title: "src/regression.ts",
    filediff: {
      file: "src/regression.ts",
      additions: input?.additions ?? 1,
      deletions: 1,
      before: input?.before ?? "export const value = 'before'\n",
      after: input?.after ?? "export const value = 'after'\n",
    },
    diff: "diff --git a/src/regression.ts b/src/regression.ts\n-export const value = 'before'\n+export const value = 'after'\n",
  }
}

function editToolContent(input?: { additions?: number; before?: string; after?: string }): SessionMessageAssistantTool {
  return v2Tool({
    name: "edit",
    id: editPartID,
    created: 1700000001000,
    ran: 1700000001000,
    completed: 1700000002000,
    state: v2ToolCompleted({
      input: { filePath: "src/regression.ts" },
      structured: editStructured(input),
      content: [{ type: "text", text: "Edited src/regression.ts" }],
    }),
  })
}

const streamedText = "Streaming added a later assistant text part."

function assistantMessage(content: SessionMessageAssistantTool[] = [editToolContent()]) {
  return v2AssistantMessage({
    id: assistantMessageID,
    created: 1700000001000,
    model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
    agent: "build",
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    content,
  })
}

let eventClock = 1700000003000
const nextEventTime = () => (eventClock += 1000)

/** 后续文本 part 流入既有 assistant 消息（V1 message.part.updated 的 V2 对应：text.started → text.ended） */
function textStreamEvents(): EventPayload[] {
  const base = { sessionID, assistantMessageID, textID: textPartID }
  return [
    v2Event(directory, "session.next.text.started", { ...base, timestamp: nextEventTime() }),
    v2Event(directory, "session.next.text.ended", { ...base, timestamp: nextEventTime(), text: streamedText }),
  ]
}

/** 既有 completed 工具的结构化数据更新（V2 对应面：重放 tool.called → tool.success，part id == callID 原位更新） */
function editReplayEvents(additions: number): EventPayload[] {
  const base = { sessionID, assistantMessageID, callID: editPartID }
  return [
    v2Event(directory, "session.next.tool.called", {
      ...base,
      timestamp: nextEventTime(),
      tool: "edit",
      input: { filePath: "src/regression.ts" },
      provider: { executed: false },
    }),
    v2Event(directory, "session.next.tool.success", {
      ...base,
      timestamp: nextEventTime(),
      structured: editStructured({ additions }),
      content: [{ type: "text", text: "Edited src/regression.ts" }],
      provider: { executed: false },
    }),
  ]
}

test.describe("regression: session timeline local row state", () => {
  test("keeps a manually collapsed tool collapsed when later assistant content streams", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
    await expectSessionTitle(page, title)

    const wrapper = page.locator(`[data-timeline-part-id="${editPartID}"]`).first()
    await expectAppVisible(wrapper)
    await expectExpanded(wrapper, true)

    await wrapper.evaluate((element) => {
      ;(element as HTMLElement).dataset.regressionMarker = "before-stream"
    })
    await wrapper.locator('[data-slot="collapsible-trigger"]').first().click()
    await expectExpanded(wrapper, false)

    events.push(...textStreamEvents())

    await expect(page.locator(`[data-timeline-part-id="${textPartID}"]`).first()).toBeVisible({ timeout: 10_000 })

    expect(await readToolState(page)).toEqual({
      expanded: false,
      row: "AssistantPart",
      streamedTextVisible: true,
    })
  })

  test("does not remount an edit diff when sibling parts or diff counts update", async ({ page }) => {
    const events: EventPayload[] = []
    await installDiffProbe(page)
    await mockServer(page, events)
    await configurePage(page)

    await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
    await expectSessionTitle(page, title)

    const wrapper = page.locator(`[data-timeline-part-id="${editPartID}"]`).first()
    await expectAppVisible(wrapper)
    const file = wrapper.locator('[data-component="file"][data-mode="diff"]').first()
    await expectAppVisible(file)
    await markDiffProbe(page)

    events.push(...textStreamEvents())

    await expect(page.locator(`[data-timeline-part-id="${textPartID}"]`).first()).toBeVisible({ timeout: 10_000 })
    const siblingProbe = await readDiffProbe(page)
    expect(siblingProbe).toEqual({
      fileMarker: "before",
      frameMarker: "before",
      rowKey: `assistant-part:${userMessageID}:part:${assistantMessageID}:${editPartID}`,
      rowMarker: "before",
      shadowRoots: 0,
      toolMarker: "before",
    })

    await markDiffProbe(page)
    events.push(...editReplayEvents(2))

    await expect(wrapper.locator('[data-slot="diff-changes-additions"]').filter({ hasText: "+2" }).first()).toBeVisible(
      { timeout: 10_000 },
    )
    expect(await readDiffProbe(page)).toEqual({
      fileMarker: "before",
      frameMarker: "before",
      rowKey: `assistant-part:${userMessageID}:part:${assistantMessageID}:${editPartID}`,
      rowMarker: "before",
      shadowRoots: 0,
      toolMarker: "before",
    })
  })

  test("keeps a sticky edit header aligned with a multi-hunk diff", async ({ page }) => {
    const events: EventPayload[] = []
    const lines = Array.from({ length: 1_000 }, (_, index) => `export const value${index} = ${index}\n`).join("")
    const after = [100, 300, 500, 700, 900].reduce(
      (result, index) =>
        result.replace(`export const value${index} = ${index}`, `export const value${index} = compute(${index})`),
      lines,
    )
    const part = editToolContent({ before: lines, after })
    await mockServer(page, events, [userMessage, assistantMessage([part])])
    await configurePage(page)

    await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
    await expectSessionTitle(page, title)

    const wrapper = page.locator(`[data-timeline-part-id="${editPartID}"]`).first()
    const trigger = wrapper.locator('[data-slot="collapsible-trigger"]').first()
    const diff = wrapper.locator('[data-component="edit-content"]').first()
    await expectAppVisible(diff)
    await expect.poll(() => wrapper.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(500)
    const samples = await wrapper.evaluate(async (element) => {
      const root = element.closest<HTMLElement>(".scroll-view__viewport")!
      element.scrollIntoView({ block: "start" })
      const result = []
      for (const offset of [0, 120, 240, 360, 480]) {
        root.scrollBy(0, offset - (result.at(-1)?.offset ?? 0))
        await new Promise(requestAnimationFrame)
        const trigger = element.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')!
        const diff = element.querySelector<HTMLElement>('[data-component="edit-content"]')!
        result.push({
          offset,
          trigger: trigger.getBoundingClientRect().y,
          diff: diff.getBoundingClientRect().y,
          bottom: element.getBoundingClientRect().bottom,
        })
      }
      return result
    })

    expect(samples[0]!.trigger).toBeLessThan(samples[0]!.diff)
    expect(samples.every((sample) => Math.abs(sample.trigger - samples[0]!.trigger) <= 1)).toBe(true)
    expect(samples.every((sample) => sample.trigger < sample.bottom)).toBe(true)
  })
})

async function configurePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
        },
      }),
    )
    // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区
    localStorage.setItem(
      "opennovel.global.dat:novel.workspace.layout.v1",
      JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
    )
  })
}

async function expectExpanded(locator: Locator, expected: boolean) {
  await expect.poll(() => locator.evaluate(readExpanded)).toBe(expected)
}

async function readToolState(page: Page) {
  return page
    .locator(`[data-timeline-part-id="${editPartID}"]`)
    .first()
    .evaluate(
      (element, textPartID) => ({
        expanded: (() => {
          const trigger = element.querySelector('[data-slot="collapsible-trigger"]')
          const aria = trigger?.getAttribute("aria-expanded")
          if (aria === "true") return true
          if (aria === "false") return false

          const root = element.querySelector('[data-component="collapsible"]')
          if (root?.hasAttribute("data-expanded")) return true
          if (root?.hasAttribute("data-closed")) return false

          const content = element.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
          return !!content && content.getBoundingClientRect().height > 0
        })(),
        row: element.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"),
        streamedTextVisible: !!document.querySelector(`[data-timeline-part-id="${textPartID}"]`),
      }),
      textPartID,
    )
}

async function installDiffProbe(page: Page) {
  await page.addInitScript(() => {
    let shadowRootCount = 0
    const attachShadow = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      shadowRootCount += 1
      return attachShadow.call(this, init)
    }
    window.__timelineDiffProbe = {
      reset: () => {
        shadowRootCount = 0
      },
      shadowRoots: () => shadowRootCount,
    }
  })
}

async function markDiffProbe(page: Page) {
  await page
    .locator(`[data-timeline-part-id="${editPartID}"]`)
    .first()
    .evaluate((element) => {
      const tool = element as HTMLElement
      const file = tool.querySelector<HTMLElement>('[data-component="file"][data-mode="diff"]')
      const row = tool.closest<HTMLElement>("[data-timeline-key]")
      const frame = tool.closest<HTMLElement>("[data-timeline-row]")
      if (!file) throw new Error("missing edit diff file")
      if (!row) throw new Error("missing virtual timeline row")
      if (!frame) throw new Error("missing timeline row frame")

      tool.dataset.timelineProbe = "before"
      file.dataset.timelineProbe = "before"
      row.dataset.timelineProbe = "before"
      frame.dataset.timelineProbe = "before"
      window.__timelineDiffProbe.reset()
    })
}

async function readDiffProbe(page: Page) {
  return page
    .locator(`[data-timeline-part-id="${editPartID}"]`)
    .first()
    .evaluate((element) => {
      const tool = element as HTMLElement
      const file = tool.querySelector<HTMLElement>('[data-component="file"][data-mode="diff"]')
      const row = tool.closest<HTMLElement>("[data-timeline-key]")
      const frame = tool.closest<HTMLElement>("[data-timeline-row]")
      return {
        fileMarker: file?.dataset.timelineProbe,
        shadowRoots: window.__timelineDiffProbe.shadowRoots(),
        toolMarker: tool.dataset.timelineProbe,
        rowMarker: row?.dataset.timelineProbe,
        rowKey: row?.dataset.timelineKey,
        frameMarker: frame?.dataset.timelineProbe,
      }
    })
}

function readExpanded(element: Element) {
  const trigger = element.querySelector('[data-slot="collapsible-trigger"]')
  const aria = trigger?.getAttribute("aria-expanded")
  if (aria === "true") return true
  if (aria === "false") return false

  const root = element.querySelector('[data-component="collapsible"]')
  if (root?.hasAttribute("data-expanded")) return true
  if (root?.hasAttribute("data-closed")) return false

  const content = element.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
  return !!content && content.getBoundingClientRect().height > 0
}

async function mockServer(
  page: Page,
  events: EventPayload[],
  messages: V2FixtureMessage[] = [userMessage, assistantMessage()],
) {
  await mockOpenNovelServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    v2Messages: () => messages,
    events: () => events.splice(0, 1),
    eventRetry: 16,
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-state-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "timeline-state-regression",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opennovel",
        name: "OpenNovel",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opennovel"],
    default: { providerID: "opennovel", modelID: "claude-opus-4-6" },
  }
}
