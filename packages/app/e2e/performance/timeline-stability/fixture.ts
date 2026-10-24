// timeline-stability 套件 fixture（timeline-stability-v2 重建，V2 wire 形态）。
// 数据面：初始历史经 mock `v2Messages`（单体 SessionMessage，工厂来自 e2e/utils/v2-fixture）；
// 事件面：只发 V2 生产词汇 session.next.*（v2Event 构造即 schema 校验），帧序满足
// v2-translator 的有状态前提（step.started 建 assistant 骨架、tool.called 建调用记录）。
// busy/idle 无事件推送：由 `v2Active` 闭包翻转 + session.next.* 触发的 refreshActive 对账承担。
// 插删无事件词汇：由 `setMessages` 改写可变历史 + `revertCommitted` 强制重拉 reconcile 承担。
import { expect, type Page } from "@playwright/test"
import type { LlmToolContent, ModelRef } from "@opennovel-ai/sdk/v2/client"
import { mockOpenNovelServer, type MockSession } from "../../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../../utils/novel-workspace"
import { installSseTransport } from "../../utils/sse-transport"
import { expectSessionTitle } from "../../utils/waits"
import {
  validateV2Timeline,
  v2AssistantMessage,
  v2Event,
  v2Text,
  v2UserMessage,
  type V2FixtureMessage,
  type V2SseFrame,
} from "../../utils/v2-fixture"

export const directory = "C:/OpenNovel/TimelineStability"
export const novelID = "novel_timeline_stability"
export const projectID = "proj_timeline_stability"
export const sessionID = "ses_timeline_stability"
export const userID = "msg_1000_timeline_user"
export const assistantID = "msg_1001_timeline_assistant"
export const title = "Timeline visual stability"
export const agent = "build"
export const model: ModelRef = { id: "claude-opus-4-6", providerID: "opennovel", variant: "max" }

// 帧时间戳单调递增（与消息种子的 1700000000xxx 区段错开）
let frameClock = 1_700_100_000_000
const tick = () => (frameClock += 1000)
const zeroTokens = () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

export async function setupTimeline(
  page: Page,
  input: {
    messages?: V2FixtureMessage[]
    settings?: Record<string, boolean>
    sessions?: MockSession[]
    cpuRate?: number
    viewport?: { width: number; height: number }
    eventRetry?: number
    reducedMotion?: boolean
    deviceScaleFactor?: number
    seedHistory?: boolean
    /** 初始 busy（v2Active 是否含本会话）；省略按 idle */
    active?: boolean
    /** 工作台右栏（对话面板）设定宽度，默认 1100；窄栏场景可调小（下限 320） */
    railWidth?: number
    /** GET /api/session/{id}/diff 兜底（tool.success/step.ended 会触发 fetchDiff） */
    diffs?: unknown[]
  } = {},
) {
  const sessions = input.sessions ?? [session()]
  let timelineMessages = [
    ...(input.seedHistory ? historyMessages(18) : []),
    ...(input.messages ?? [userMessage(), assistantMessage([v2Text("Timeline baseline.", "prt_1001_timeline_text")])]),
  ]
  validateV2Timeline(timelineMessages)
  let busy = input.active ?? false
  const transport = await installSseTransport<V2SseFrame>(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: input.eventRetry ?? 20,
  })
  await mockOpenNovelServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions,
    v2Messages: (id) => (id === sessionID ? timelineMessages : []),
    v2Active: () => (busy ? { [sessionID]: { busy: true } } : {}),
    v2Diff: input.diffs ?? [],
  })
  // 独立会话路由已退役（session-book-only）：时间线随会话页嵌在书籍工作台右栏，
  // 以工作台路由进入并补充小说 API mock（含会话绑定）
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID,
    boundSessionIDs: sessions.map((item) => item.id),
  })
  await page.addInitScript((settings) => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: false,
          shellToolPartsExpanded: false,
          showReasoningSummaries: false,
          showSessionProgressBar: true,
          ...settings,
        },
      }),
    )
  }, input.settings ?? {})
  if (input.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize(input.viewport ?? { width: 1400, height: 900 })
  if (input.deviceScaleFactor) {
    const devtools = await page.context().newCDPSession(page)
    const viewport = input.viewport ?? { width: 1400, height: 900 }
    await devtools.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: input.deviceScaleFactor,
      mobile: false,
    })
  }
  await page.addInitScript(
    ({ railWidth }) => {
      // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区
      localStorage.setItem(
        "opennovel.global.dat:novel.workspace.layout.v1",
        JSON.stringify({ railPanel: "chat", railWidth }),
      )
    },
    { railWidth: input.railWidth ?? 1100 },
  )
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  if (input.cpuRate && input.cpuRate > 1) {
    const devtools = await page.context().newCDPSession(page)
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: input.cpuRate })
  }

  return {
    transport,
    async send(frame: V2SseFrame, delay = 0) {
      await transport.send(frame, { marker: describeFrame(frame) })
      if (delay) await page.waitForTimeout(delay)
    },
    async sendAll(sequence: { frame: V2SseFrame; delay: number }[]) {
      for (const item of sequence) {
        await transport.send(item.frame, { marker: describeFrame(item.frame) })
        await page.waitForTimeout(item.delay)
      }
    },
    async settle(frames = 3) {
      await page.evaluate(
        (frames) =>
          new Promise<void>((resolve) => {
            let remaining = frames
            const tick = () => {
              remaining--
              if (remaining <= 0) return resolve()
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
        frames,
      )
    },
    async waitForPart(partID: string) {
      await expect(page.locator(`[data-timeline-part-id="${partID}"]`).first()).toBeVisible()
    },
    /** D5：改写可变历史（下一次强制重拉生效）；构造即校验 */
    setMessages(next: V2FixtureMessage[]) {
      validateV2Timeline(next)
      timelineMessages = next
    },
    /** D4：翻转 busy 对账来源；之后须发任一 session.next.* 帧触发 refreshActive */
    setBusy(next: boolean) {
      busy = next
    },
  }
}

export type Timeline = Awaited<ReturnType<typeof setupTimeline>>

function describeFrame(frame: V2SseFrame) {
  const properties = frame.payload.properties
  const subject =
    properties.callID ?? properties.textID ?? properties.reasoningID ?? properties.assistantMessageID ?? properties.messageID ?? properties.attempt
  return [frame.payload.type, subject].filter(Boolean).join(":")
}

// ---- 帧构造器（D3）：全部经 v2Event  schema 校验；时间戳自动单调递增 ----

export function prompted(text: string, messageID: string = userID) {
  return v2Event(directory, "session.next.prompted", {
    timestamp: tick(),
    sessionID,
    messageID,
    prompt: { text },
    delivery: "steer",
  })
}

export function stepStarted(assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.step.started", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    agent,
    model,
  })
}

export function stepEnded(assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.step.ended", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    finish: "stop",
    cost: 0.01,
    tokens: zeroTokens(),
  })
}

export function stepFailed(message: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.step.failed", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    error: { type: "unknown", message },
  })
}

export function textStarted(textID: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.text.started", { timestamp: tick(), sessionID, assistantMessageID, textID })
}

export function textDelta(textID: string, delta: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.text.delta", { timestamp: tick(), sessionID, assistantMessageID, textID, delta })
}

export function textEnded(textID: string, text: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.text.ended", { timestamp: tick(), sessionID, assistantMessageID, textID, text })
}

/** text.started + delta×N + text.ended 帧序列（chunks 默认 1，即无中间 delta） */
export function textTurn(input: { text: string; textID: string; assistantMessageID?: string; chunks?: number }) {
  const chunks = input.chunks ?? 1
  const size = Math.max(1, Math.ceil(input.text.length / chunks))
  const deltas = Array.from({ length: Math.ceil(input.text.length / size) }, (_, index) =>
    input.text.slice(index * size, (index + 1) * size),
  )
  return [
    textStarted(input.textID, input.assistantMessageID),
    ...deltas.map((delta) => textDelta(input.textID, delta, input.assistantMessageID)),
    textEnded(input.textID, input.text, input.assistantMessageID),
  ]
}

export function reasoningStarted(reasoningID: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.reasoning.started", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    reasoningID,
  })
}

export function reasoningDelta(reasoningID: string, delta: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.reasoning.delta", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    reasoningID,
    delta,
  })
}

export function reasoningEnded(reasoningID: string, text: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.reasoning.ended", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    reasoningID,
    text,
  })
}

/** reasoning.started + delta×N + reasoning.ended 帧序列 */
export function reasoningTurn(input: { text: string; reasoningID: string; assistantMessageID?: string; chunks?: number }) {
  const chunks = input.chunks ?? 1
  const size = Math.max(1, Math.ceil(input.text.length / chunks))
  const deltas = Array.from({ length: Math.ceil(input.text.length / size) }, (_, index) =>
    input.text.slice(index * size, (index + 1) * size),
  )
  return [
    reasoningStarted(input.reasoningID, input.assistantMessageID),
    ...deltas.map((delta) => reasoningDelta(input.reasoningID, delta, input.assistantMessageID)),
    reasoningEnded(input.reasoningID, input.text, input.assistantMessageID),
  ]
}

export function toolCalled(callID: string, tool: string, input: Record<string, unknown>, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.tool.called", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    callID,
    tool,
    input,
    provider: { executed: false },
  })
}

/** structured 整体透传为 part.metadata（shell 输出增长、edit 的 filediff/files 走这里） */
export function toolProgress(callID: string, structured: Record<string, unknown>, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.tool.progress", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    callID,
    structured,
    content: [],
  })
}

export function toolSuccess(
  callID: string,
  input: { structured?: Record<string, unknown>; content?: LlmToolContent[]; result?: unknown } = {},
  assistantMessageID: string = assistantID,
) {
  return v2Event(directory, "session.next.tool.success", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    callID,
    structured: input.structured ?? {},
    content: input.content ?? [],
    ...(input.result === undefined ? {} : { result: input.result }),
    provider: { executed: true },
  })
}

export function toolFailed(callID: string, message: string, assistantMessageID: string = assistantID) {
  return v2Event(directory, "session.next.tool.failed", {
    timestamp: tick(),
    sessionID,
    assistantMessageID,
    callID,
    error: { type: "unknown", message },
    provider: { executed: true },
  })
}

/** tool.called [+ progress×N] + success|failed 帧序列（四态推进的单一入口） */
export function toolSequence(input: {
  callID: string
  tool: string
  input: Record<string, unknown>
  assistantMessageID?: string
  /** 每元素一帧 tool.progress 的 structured */
  progress?: Record<string, unknown>[]
  outcome:
    | { completed: { structured?: Record<string, unknown>; content?: LlmToolContent[]; result?: unknown } }
    | { failed: string }
}) {
  return [
    toolCalled(input.callID, input.tool, input.input, input.assistantMessageID),
    ...(input.progress ?? []).map((structured) => toolProgress(input.callID, structured, input.assistantMessageID)),
    "failed" in input.outcome
      ? toolFailed(input.callID, input.outcome.failed, input.assistantMessageID)
      : toolSuccess(input.callID, input.outcome.completed, input.assistantMessageID),
  ]
}

/** bash 特化：输出增长走 progress 的 structured.output，完成态同时给 content 与 structured.output */
export function shellSequence(input: {
  callID: string
  command?: string
  /** 逐帧增长的部分输出（省略则 called 后直接结算） */
  outputs?: string[]
  assistantMessageID?: string
  outcome: { completed: string } | { failed: string }
}) {
  const command = input.command ?? `echo ${input.callID}`
  return toolSequence({
    callID: input.callID,
    tool: "bash",
    input: { command },
    assistantMessageID: input.assistantMessageID,
    progress: (input.outputs ?? []).map((output) => ({ title: command, command, output })),
    outcome:
      "failed" in input.outcome
        ? { failed: input.outcome.failed }
        : {
            completed: {
              structured: { title: command, command, output: input.outcome.completed },
              content: [{ type: "text", text: input.outcome.completed }],
            },
          },
  })
}

export function retried(attempt: number, message = "Rate limited") {
  return v2Event(directory, "session.next.retried", {
    timestamp: tick(),
    sessionID,
    attempt,
    error: { message, isRetryable: true },
  })
}

/** D5：触发强制重拉（sync force → loadMessages replace → reconcile 增删） */
export function revertCommitted(messageID: string = userID) {
  return v2Event(directory, "session.next.revert.committed", { timestamp: tick(), sessionID, messageID })
}

/** D4 对账触发：无副作用的 session.next.* 帧（title 原值），供 setBusy 后无后续帧的场景 */
export function sessionUpdated() {
  return v2Event(directory, "session.next.updated", { timestamp: tick(), sessionID, title })
}

// ---- 种子消息（初始历史，经 v2Messages 装载） ----

export function userMessage(input: { id?: string; text?: string; created?: number } = {}) {
  return v2UserMessage({
    id: input.id ?? userID,
    text: input.text ?? "Build the timeline stability matrix.",
    created: input.created ?? 1700000000000,
  })
}

export function assistantMessage(
  content: Parameters<typeof v2AssistantMessage>[0]["content"],
  input: { id?: string; created?: number; completed?: false | number; error?: string } = {},
) {
  const created = input.created ?? 1700000001000
  return v2AssistantMessage({
    id: input.id ?? assistantID,
    content,
    agent,
    model,
    created,
    // 默认已完成（completed: created+1000）；显式 false 表示在制（配合 active: true）
    ...(input.completed === false ? {} : { completed: input.completed ?? created + 1000 }),
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(input.error === undefined ? {} : { error: input.error }),
  })
}

/** N 对历史 user+assistant（长文本喂虚拟化），ID/时间戳确定性 */
export function historyMessages(count: number): V2FixtureMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const value = String(index).padStart(4, "0")
    return [
      v2UserMessage({
        id: `msg_0${value}_history_a_user`,
        text: `Historical prompt ${index}`,
        created: 1690000000000 + index * 10_000,
      }),
      v2AssistantMessage({
        id: `msg_0${value}_history_b_assistant`,
        content: [
          v2Text(
            `Historical response ${index}. ${"Existing session content keeps the virtual timeline realistic. ".repeat(5)}`,
            `prt_0${value}_history_text`,
          ),
        ],
        agent,
        model,
        created: 1690000001000 + index * 10_000,
        completed: 1690000002000 + index * 10_000,
      }),
    ]
  }).flat()
}

// ---- 环境 mock 数据 ----

export function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-stability",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

export function session(input: Partial<MockSession> = {}): MockSession {
  return {
    id: sessionID,
    slug: "timeline-stability",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
    ...input,
  }
}

export function provider() {
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

// ---- wire 无关的 DOM 工具（原样保留） ----

export async function waitForVisualSettle(page: Page, selectors: string[], stableFrames = 3) {
  await page.waitForFunction(
    ({ selectors, stableFrames }) => {
      const elements = selectors.map((selector) => document.querySelector<HTMLElement>(selector))
      if (elements.some((element) => !element)) return false
      return new Promise<boolean>((resolve) => {
        let stable = 0
        let previous = ""
        const sample = () => {
          const signature = JSON.stringify(
            elements.map((element) => {
              const rect = element!.getBoundingClientRect()
              return [Math.round(rect.top * 10), Math.round(rect.bottom * 10), Math.round(rect.height * 10)]
            }),
          )
          stable = signature === previous ? stable + 1 : 0
          previous = signature
          const ordered = elements
            .slice(1)
            .every(
              (element, index) =>
                elements[index]!.getBoundingClientRect().bottom <= element!.getBoundingClientRect().top + 0.5,
            )
          if (stable >= stableFrames && ordered) return resolve(true)
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
    },
    { selectors, stableFrames },
  )
}
