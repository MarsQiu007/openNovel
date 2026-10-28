import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { installSseTransport, type SseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"
import {
  resetV2FixtureCounters,
  v2AssistantMessage,
  v2Compaction,
  v2Event,
  v2Reasoning,
  v2StreamTurn,
  v2Text,
  v2Tool,
  v2ToolCompleted,
  v2ToolError,
  v2ToolPending,
  v2ToolRunning,
  v2UserMessage,
  type V2FixtureMessage,
  type V2SseFrame,
} from "../utils/v2-fixture"

// 流式投影（接班被删 session-timeline-projection/reasoning/tool/context/reducer 系列）：
// 流式回合全程、reasoning 可见性矩阵、工具四态与错误卡族、question dismissed 区分、
// websearch provider 标签、重复投递幂等、context 组归并与折叠保持、turn 结构。
// busy/idle 在 V2 无状态推送：由 /api/session/active 集合对账（bootstrap 播种 +
// session.next.* 事件后 400ms debounce 轮询），mock 用 v2Active 函数形态翻转。
const directory = "C:/OpenNovel/StreamingProjection"
const novelID = "novel_streaming_projection"
const projectID = "proj_streaming_projection"
const sessionID = "ses_streaming_projection"
const title = "Streaming projection"
const model = { id: "claude-opus-4-6", providerID: "opennovel" }
const tokens = { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } }

test.use({ viewport: { width: 1440, height: 900 } })
test.beforeEach(() => resetV2FixtureCounters())

test("projects a streaming turn end to end", async ({ page }) => {
  let busy = true
  const transport = await setup(page, { active: () => (busy ? { [sessionID]: {} } : {}) })
  const frames = v2StreamTurn({
    directory,
    sessionID,
    text: "Streamed response body",
    messageID: "msg_stream_user",
    assistantMessageID: "msg_stream_assistant",
    textID: "prt_stream_text",
    chunks: 3,
    model,
  })

  // 帧序列：prompted(0) → step.started(1) → text.started(2) → delta×3(3..5) → text.ended(6) → step.ended(7)
  await transport.send(frames[0]!)
  await transport.send(frames[1]!)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(1)
  await transport.send(frames[2]!)
  await transport.send(frames[3]!)
  const part = page.locator('[data-timeline-part-id="prt_stream_text"]')
  await expect(part).toContainText("Streamed")
  await expect(part).not.toContainText("response body")
  for (const frame of frames.slice(4, 6)) await transport.send(frame)

  busy = false
  await transport.send(frames[6]!)
  await transport.send(frames[7]!)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(part).toContainText("Streamed response body")
})

const reasoningProfiles = [
  { name: "summaries off no reasoning", summaries: false, reasoning: "", other: false, thinking: true, body: false },
  {
    name: "summaries off reasoning heading",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: false,
    thinking: true,
    body: true,
  },
  {
    name: "summaries off with visible tool",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: true,
    thinking: true,
    body: true,
  },
  { name: "summaries on no content", summaries: true, reasoning: "", other: false, thinking: true, body: false },
  { name: "summaries on blank reasoning", summaries: true, reasoning: "   ", other: false, thinking: true, body: false },
  {
    name: "summaries on visible reasoning",
    summaries: true,
    reasoning: "## Inspecting stability",
    other: false,
    thinking: false,
    body: true,
  },
  {
    name: "summaries on visible tool no reasoning",
    summaries: true,
    reasoning: "",
    other: true,
    thinking: false,
    body: false,
  },
] as const

for (const [index, profile] of reasoningProfiles.entries()) {
  test(`projects busy reasoning profile ${profile.name}`, async ({ page }) => {
    const reasoningID = `prt_reasoning_matrix_${index}`
    const content = [
      ...(profile.reasoning ? [v2Reasoning(profile.reasoning, { id: reasoningID })] : []),
      ...(profile.other
        ? [
            v2Tool({
              name: "skill",
              id: `prt_reasoning_tool_${index}`,
              state: v2ToolRunning({ input: { name: "inspect" } }),
            }),
          ]
        : []),
    ]
    await setup(page, {
      messages: [userMessage(), assistantMessage(content)],
      active: { [sessionID]: {} },
      showReasoningSummaries: profile.summaries,
    })

    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(profile.thinking ? 1 : 0)
    await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(profile.body ? 1 : 0)
    // 消息已完成：思考标题收敛到折叠块触发器（微光行的渐显标题来自流式正文缺失时才为 undefined）
    if (profile.reasoning.trim())
      await expect(
        page.locator(`[data-timeline-part-id="${reasoningID}"] [data-slot="reasoning-part-trigger-text"]`),
      ).toHaveText("Inspecting stability")
  })
}

test("collapses completed reasoning with trigger and toggles open/closed", async ({ page }) => {
  await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Reasoning("## Inspecting stability\nSome reasoning body", { id: "prt_reasoning_collapsed" }),
        v2Text("Answer body"),
      ]),
    ],
  })

  const block = page.locator('[data-timeline-part-id="prt_reasoning_collapsed"]')
  await expect(block).toBeVisible()
  await expect(block.locator('[data-slot="reasoning-part-trigger-text"]')).toHaveText("Inspecting stability")
  await expect(block.locator('[data-component="markdown"]')).toBeHidden()

  await block.locator('[data-slot="collapsible-trigger"]').click()
  await expect(block.locator('[data-component="markdown"]')).toBeVisible()
  await expect(block.locator('[data-component="markdown"]')).toContainText("Some reasoning body")

  await block.locator('[data-slot="collapsible-trigger"]').click()
  await expect(block.locator('[data-component="markdown"]')).toBeHidden()
})

test("falls back to truncated first line when completed reasoning has no heading", async ({ page }) => {
  await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Reasoning("Just plain thoughts without heading\nsecond line", { id: "prt_reasoning_plain" }),
        v2Text("Answer body"),
      ]),
    ],
  })

  await expect(
    page.locator('[data-timeline-part-id="prt_reasoning_plain"] [data-slot="reasoning-part-trigger-text"]'),
  ).toHaveText("Just plain thoughts without heading")
})

test("expands completed reasoning by default when summaries setting is on", async ({ page }) => {
  await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Reasoning("## Inspecting stability\nSome reasoning body", { id: "prt_reasoning_expanded" }),
        v2Text("Answer body"),
      ]),
    ],
    showReasoningSummaries: true,
  })

  const block = page.locator('[data-timeline-part-id="prt_reasoning_expanded"]')
  await expect(block.locator('[data-slot="reasoning-part-trigger-text"]')).toHaveText("Inspecting stability")
  await expect(block.locator('[data-component="markdown"]')).toBeVisible()
  await expect(block.locator('[data-component="markdown"]')).toContainText("Some reasoning body")
})

test("renders tool four states with one error card", async ({ page }) => {
  await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Tool({ name: "bash", id: "prt_state_pending", state: v2ToolPending({ command: "sleep 1" }) }),
        v2Tool({
          name: "bash",
          id: "prt_state_running",
          state: v2ToolRunning({ input: { command: "sleep 2" } }),
        }),
        v2Tool({
          name: "bash",
          id: "prt_state_completed",
          state: v2ToolCompleted({
            input: { command: "printf ok" },
            structured: { title: "printf ok" },
            content: [{ type: "text", text: "ok" }],
          }),
        }),
        v2Tool({
          name: "bash",
          id: "prt_state_error",
          state: v2ToolError({ input: { command: "exit 1" }, error: "Command failed visibly" }),
        }),
      ]),
    ],
  })

  for (const id of ["prt_state_pending", "prt_state_running", "prt_state_completed", "prt_state_error"])
    await expect(page.locator(`[data-timeline-part-id="${id}"]`), id).toBeVisible()
  await expect(page.locator('[data-kind="tool-error-card"]')).toHaveCount(1)
})

test("renders every tool error outcome without leaking hidden tools", async ({ page }) => {
  const ordinary = ["bash", "edit", "write", "apply_patch", "webfetch", "websearch", "task", "skill", "mcp_probe"]
  const content = ordinary.map((tool, index) =>
    v2Tool({
      name: tool,
      id: `prt_error_${index}`,
      state: v2ToolError({ input: errorInput(tool), error: `${tool} failed visibly` }),
    }),
  )
  content.push(
    v2Tool({
      name: "question",
      id: "prt_question_dismissed",
      state: v2ToolError({ input: questionInput(), error: "The user dismissed this question" }),
    }),
    v2Tool({
      name: "question",
      id: "prt_question_error",
      state: v2ToolError({ input: questionInput(), error: "Question transport failed" }),
    }),
    v2Tool({
      name: "todowrite",
      id: "prt_todo_error",
      state: v2ToolError({ input: { todos: [] }, error: "Hidden todo failure" }),
    }),
  )
  await setup(page, { messages: [userMessage(), assistantMessage(content)] })

  await expect(page.locator('[data-kind="tool-error-card"]')).toHaveCount(ordinary.length + 1)
  await expect(page.locator('[data-timeline-part-id="prt_question_dismissed"]')).toContainText(/dismissed/i)
  await expect(page.locator('[data-timeline-part-id="prt_todo_error"]')).toHaveCount(0)
  for (let index = 0; index < ordinary.length; index++)
    await expect(page.locator(`[data-timeline-part-id="prt_error_${index}"]`)).toBeVisible()
})

test("labels all web search provider variants", async ({ page }) => {
  const search = (id: string, query: string, provider?: string) =>
    v2Tool({
      name: "websearch",
      id,
      state: v2ToolCompleted({
        input: { query },
        structured: { title: query, ...(provider === undefined ? {} : { provider }) },
        content: [{ type: "text", text: `results for ${query}` }],
      }),
    })
  await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        search("prt_search_parallel", "parallel", "parallel"),
        search("prt_search_exa", "exa", "exa"),
        search("prt_search_generic", "generic"),
      ]),
    ],
  })

  await expect(page.getByRole("button", { name: /Parallel Web Search/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Exa Web Search/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Web Search/ })).toBeVisible()
})

test("preserves an expanded tool error card across duplicate delivery", async ({ page }) => {
  const toolID = "prt_duplicate_error"
  const transport = await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        v2Tool({
          name: "bash",
          id: toolID,
          state: v2ToolError({ input: { command: "exit 1" }, error: "Command failed visibly" }),
        }),
      ]),
    ],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${toolID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")

  // 重复投递同一 called→failed 对（callID==part id 原位更新）：投影保持单 part、展开态不回弹
  for (let round = 0; round < 2; round++) {
    await transport.send(
      v2Event(directory, "session.next.tool.called", {
        timestamp: nextTime(),
        sessionID,
        assistantMessageID: assistantID,
        callID: toolID,
        tool: "bash",
        input: { command: "exit 1" },
        provider: { executed: false },
      }),
    )
    await transport.send(
      v2Event(directory, "session.next.tool.failed", {
        timestamp: nextTime(),
        sessionID,
        assistantMessageID: assistantID,
        callID: toolID,
        error: { type: "unknown", message: "Command failed visibly" },
        provider: { executed: false },
      }),
    )
  }

  await expect(page.locator(`[data-timeline-part-id="${toolID}"]`)).toHaveCount(1)
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper).toContainText("Command failed visibly")
})

test("groups context operations at correct boundaries", async ({ page }) => {
  const context = (id: string, tool: string, input: Record<string, unknown>) =>
    v2Tool({
      name: tool,
      id,
      state: v2ToolCompleted({
        input,
        structured: { title: input.filePath || input.path || input.pattern || "completed" },
        content: [{ type: "text", text: `Completed ${tool}` }],
      }),
    })
  await setup(page, {
    messages: [
      userMessage(),
      assistantMessage([
        context("prt_boundary_01_read", "read", { filePath: "src/a.ts" }),
        v2Text("Boundary text", "prt_boundary_02_text"),
        context("prt_boundary_03_glob", "glob", { path: ".", pattern: "**/*.ts" }),
        context("prt_boundary_04_grep", "grep", { path: ".", pattern: "stable" }),
        v2Tool({
          name: "bash",
          id: "prt_boundary_05_shell",
          state: v2ToolCompleted({
            input: { command: "printf done" },
            structured: { title: "printf done" },
            content: [{ type: "text", text: "done" }],
          }),
        }),
        context("prt_boundary_06_list", "list", { path: "src" }),
      ]),
    ],
  })

  await expect(page.locator('[data-timeline-part-ids="prt_boundary_01_read"]')).toBeVisible()
  await expect(page.locator('[data-timeline-part-ids="prt_boundary_03_glob,prt_boundary_04_grep"]')).toBeVisible()
  await expect(page.locator('[data-timeline-part-ids="prt_boundary_06_list"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="AssistantPart"]')).toHaveCount(5)
})

test("preserves a collapsed context group through settlement", async ({ page }) => {
  const ids = ["prt_closed_01_read", "prt_closed_02_glob"]
  const inputs = {
    read: { filePath: "src/a.ts", offset: 0, limit: 120 },
    glob: { path: ".", pattern: "**/*.ts" },
  }
  const transport = await setup(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          v2Tool({ name: "read", id: ids[0]!, state: v2ToolRunning({ input: inputs.read }) }),
          v2Tool({ name: "glob", id: ids[1]!, state: v2ToolRunning({ input: inputs.glob }) }),
        ],
        { completed: false },
      ),
    ],
  })
  const group = page.locator(`[data-timeline-part-ids="${ids.join(",")}"]`)
  const trigger = group.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")

  const settlements = [
    { tool: "read", input: inputs.read, title: inputs.read.filePath },
    { tool: "glob", input: inputs.glob, title: inputs.glob.path },
  ]
  for (const [index, settlement] of settlements.entries()) {
    const callID = ids[index]!
    await transport.send(
      v2Event(directory, "session.next.tool.called", {
        timestamp: nextTime(),
        sessionID,
        assistantMessageID: assistantID,
        callID,
        tool: settlement.tool,
        input: settlement.input,
        provider: { executed: false },
      }),
    )
    await transport.send(
      v2Event(directory, "session.next.tool.success", {
        timestamp: nextTime(),
        sessionID,
        assistantMessageID: assistantID,
        callID,
        structured: { title: settlement.title },
        content: [{ type: "text", text: `Completed ${settlement.tool}` }],
        provider: { executed: false },
      }),
    )
  }

  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})

test("projects turn structure with compaction, error, and gap rows", async ({ page }) => {
  await setup(page, {
    messages: [
      userMessage({ id: "msg_turn_user_1", text: "First turn", created: 1700000000000 }),
      assistantMessage([v2Text("First response", "prt_turn_first")], {
        id: "msg_turn_assistant_1",
        created: 1700000001000,
        error: "Visible provider failure",
      }),
      v2Compaction({
        id: "msg_turn_compaction",
        reason: "auto",
        summary: "Compacted summary",
        recent: "recent context",
        created: 1700000002000,
      }),
      assistantMessage([v2Text("Second response", "prt_turn_second")], {
        id: "msg_turn_assistant_2",
        created: 1700000003000,
      }),
    ],
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await scroller.evaluate((element) => (element.scrollTop = 0))

  await expect(page.getByText("Session compacted", { exact: true })).toBeVisible()
  await expect(page.getByText("Visible provider failure")).toBeVisible()
  await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
  await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()
})

const assistantID = "msg_projection_assistant"
let clock = 1700000003000
const nextTime = () => (clock += 1000)

function userMessage(input?: { id?: string; text?: string; created?: number }) {
  return v2UserMessage({
    id: input?.id ?? "msg_projection_user",
    text: input?.text ?? "Projection prompt",
    created: input?.created ?? 1700000000000,
  })
}

function assistantMessage(
  content: Parameters<typeof v2AssistantMessage>[0]["content"],
  input?: { id?: string; created?: number; completed?: false; error?: string },
) {
  return v2AssistantMessage({
    id: input?.id ?? assistantID,
    created: input?.created ?? 1700000001000,
    ...(input?.completed === false ? {} : { completed: 1700000002000 }),
    model,
    agent: "build",
    cost: 0.01,
    tokens,
    finish: "stop",
    content,
    ...(input?.error === undefined ? {} : { error: input.error }),
  })
}

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}

function errorInput(tool: string) {
  if (tool === "bash") return { command: "exit 1" }
  if (["edit", "write"].includes(tool)) return { filePath: "src/error.ts", content: "" }
  if (tool === "apply_patch") return { files: ["src/error.ts"] }
  if (tool === "webfetch") return { url: "https://example.com" }
  if (tool === "websearch") return { query: "failure" }
  if (tool === "task") return { description: "Fail task", subagent_type: "explore" }
  if (tool === "skill") return { name: "failure" }
  return { target: "failure" }
}

async function setup(
  page: Page,
  options: {
    messages?: V2FixtureMessage[]
    active?: Record<string, unknown> | (() => Record<string, unknown>)
    showReasoningSummaries?: boolean
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
      name: "streaming-projection",
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
        slug: "streaming-projection",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    v2Messages: () => options.messages ?? [],
    v2Active: options.active,
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
  await page.addInitScript((summaries) => {
    if (summaries !== undefined)
      localStorage.setItem("settings.v3", JSON.stringify({ general: { showReasoningSummaries: summaries } }))
    // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区
    localStorage.setItem(
      "opennovel.global.dat:novel.workspace.layout.v1",
      JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
    )
  }, options.showReasoningSummaries)
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  return transport
}
