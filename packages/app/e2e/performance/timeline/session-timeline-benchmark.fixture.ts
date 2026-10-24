// V2 化（perf-benchmark-v2）：消息从 {info, parts} 对改单体 SessionMessage（v2-fixture 工厂，
// 确定性 ID 保留）；pageMessages → v2Messages（分页由 V2 mock 服务端自持）；SSE 注入从
// message.part.updated/delta 换 session.next.* 帧（v2Event 严格校验）。turn 级 summary.diffs
// 在 V2 adapter 无通路（design D5），turnDiffs 选项删除，会话级 diff 走 v2Diff。
import type { Page } from "@playwright/test"
import { mockOpenNovelServer } from "../../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../../utils/novel-workspace"
import { expectAppVisible, expectSessionTitle } from "../../utils/waits"
import {
  v2AssistantMessage,
  v2Event,
  v2Reasoning,
  v2Text,
  v2Tool,
  v2ToolCompleted,
  v2UserMessage,
  validateV2Timeline,
  type V2SseFrame,
} from "../../utils/v2-fixture"
import { expect } from "../benchmark"

const directory = "C:/OpenNovel/TimelineStateRegression"
const novelID = "novel_timeline_stream"
const projectID = "proj_timeline_state_regression"
const sessionID = "ses_timeline_state_regression"
const userMessageID = "msg_user_regression"
const assistantMessageID = "msg_assistant_regression"
const editPartID = "prt_0001_edit"
export const textPartID = "prt_9999_text"
const title = "Timeline collapse state regression"
const providerModel = { providerID: "opennovel", modelID: "claude-opus-4-6", variant: "max" }
const model = { id: providerModel.modelID, providerID: providerModel.providerID }
const tokens = { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } }

const userMessage = v2UserMessage({
  id: userMessageID,
  text: "Please edit the file.",
  created: 1700000000000,
})

const editPart = v2Tool({
  id: editPartID,
  name: "edit",
  created: 1700000001000,
  completed: 1700000002000,
  state: v2ToolCompleted({
    input: { filePath: "src/regression.ts" },
    structured: {
      title: "src/regression.ts",
      filediff: {
        file: "src/regression.ts",
        additions: 1,
        deletions: 1,
        before: "export const value = 'before'\n",
        after: "export const value = 'after'\n",
      },
      diff: "diff --git a/src/regression.ts b/src/regression.ts\n-export const value = 'before'\n+export const value = 'after'\n",
    },
    content: [{ type: "text", text: "Edited src/regression.ts" }],
  }),
})

// 在制回合：无 completed/finish，流式帧（buildInitialStreamEvent 等）向它追加 textPartID 部分
const assistantMessage = v2AssistantMessage({
  id: assistantMessageID,
  created: 1700000001000,
  agent: "build",
  model,
  cost: 0.01,
  tokens,
  content: [editPart],
})

export async function setupTimelineBenchmark(
  page: Page,
  options: {
    historyTurns: number
    eventBatch: number
    newLayoutDesigns?: boolean
    vcsDiff?: unknown[]
    /** 会话级 diff（GET /api/session/{id}/diff）；turn 级 summary.diffs 的 V2 等价数据通路 */
    v2Diff?: unknown[]
    /** 覆盖默认视口（1366×768）；窄视口下书籍工作台右栏会被三区保底宽度钳制 */
    viewport?: { width: number; height: number }
    /** 书籍工作台右栏宽度（默认 1100），实际渲染宽度受视口与主区保底钳制 */
    railWidth?: number
  },
) {
  const events: V2SseFrame[] = []
  let eventBatch = options.eventBatch
  const history = Array.from({ length: options.historyTurns }, (_, index) => performanceTurn(index)).flat()
  validateV2Timeline([...history, userMessage, assistantMessage])
  await mockOpenNovelServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    vcsDiff: options.vcsDiff,
    v2Diff: options.v2Diff,
    v2Messages: () => [...history, userMessage, assistantMessage],
    events: () => events.splice(0, eventBatch),
    eventRetry: 16,
  })
  // 独立会话路由已退役（session-book-only）：时间线随会话页嵌在书籍工作台右栏，
  // 以工作台路由进入并补充小说 API mock（含会话绑定）
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID,
    boundSessionIDs: [sessionID],
  })
  await page.addInitScript(
    (input) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: {
            newLayoutDesigns: input.newLayoutDesigns,
            editToolPartsExpanded: true,
            shellToolPartsExpanded: true,
            showReasoningSummaries: true,
          },
        }),
      )
    },
    { newLayoutDesigns: options.newLayoutDesigns ?? true },
  )
  const viewport = options.viewport ?? { width: 1366, height: 768 }
  const railWidth = options.railWidth ?? 1100
  await page.setViewportSize(viewport)
  await page.addInitScript(
    (input) => {
      // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区。
      // 注意视口较窄时右栏会被"主区保底 160px + 左栏宽度"钳制，需要更大视口才能真正生效。
      localStorage.setItem(
        "opennovel.global.dat:novel.workspace.layout.v1",
        JSON.stringify({ railPanel: "chat", railWidth: input.railWidth }),
      )
    },
    { railWidth },
  )
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const text = page.locator(`[data-timeline-part-id="${textPartID}"]`).first()
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  await expectSessionTitle(page, title)
  await expectAppVisible(scroller)
  return {
    scroller,
    text,
    transport: {
      enqueue(payload: V2SseFrame | V2SseFrame[]) {
        events.push(...(Array.isArray(payload) ? payload : [payload]))
      },
      pendingCount() {
        return events.length
      },
      releaseAll() {
        eventBatch = events.length
      },
    },
    async scrollToBottom() {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
    },
    async waitForStableGeometry() {
      // 显式 60s 窗口（perf-benchmark-v2 D8）：默认 10s 在 30× CPU 节流下只剩约 0.3s
      // CPU，不足以完成大时间线的滚动锚定与布局收敛
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop), {
          timeout: 60_000,
        })
        .toBeLessThanOrEqual(1)
      await page.waitForFunction((partID) => {
        const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          element.querySelector(`[data-timeline-part-id="${partID}"]`),
        )
        if (!root) return false
        return new Promise<boolean>((resolve) => {
          const height = root.scrollHeight
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(root.scrollHeight === height && root.scrollHeight - root.clientHeight - root.scrollTop <= 1),
            ),
          )
        })
      }, textPartID)
    },
  }
}

/** 向在制回合追加流式文本的开口帧：step.started → text.started → 首个 delta（含 "Implementation plan"） */
export function buildInitialStreamEvent(deltaCount: number): V2SseFrame[] {
  return [
    streamEvent("session.next.step.started", 0, { agent: "build", model }),
    streamEvent("session.next.text.started", 1, { textID: textPartID }),
    streamEvent("session.next.text.delta", 2, { textID: textPartID, delta: streamChunk(0, deltaCount + 1) }),
  ]
}

/** 增量 delta 帧（index 1..deltaCount）；末块含 "benchmark-complete" 完成标记 */
export function buildStreamDeltaEvents(deltaCount: number): V2SseFrame[] {
  return Array.from({ length: deltaCount }, (_, index) =>
    streamEvent("session.next.text.delta", index + 3, {
      textID: textPartID,
      delta: streamChunk(index + 1, deltaCount + 1),
    }),
  )
}

/** 收尾帧：text.ended（完整文本）→ step.ended。指标采集后再投递，避免 closing 帧摊薄 deliveredDeltas 口径 */
export function buildStreamCloseEvents(deltaCount: number): V2SseFrame[] {
  const full = Array.from({ length: deltaCount + 1 }, (_, index) => streamChunk(index, deltaCount + 1)).join("")
  return [
    streamEvent("session.next.text.ended", deltaCount + 3, { textID: textPartID, text: full }),
    streamEvent("session.next.step.ended", deltaCount + 4, { finish: "stop", cost: 0, tokens }),
  ]
}

// 帧序 offset 唯一且递增（initial 0-2 / deltas 3..deltaCount+2 / close deltaCount+3..+4），时间戳直接派生
function streamEvent(type: string, offset: number, extra: Record<string, unknown>): V2SseFrame {
  return v2Event(directory, type, {
    timestamp: 1700000003000 + offset * 1_000,
    sessionID,
    assistantMessageID,
    ...extra,
  })
}

function performanceTurn(index: number) {
  const suffix = String(index).padStart(4, "0")
  const userID = `msg_0000_${suffix}_a_user`
  const assistantID = `msg_0000_${suffix}_b_assistant`
  const before = historicalSource(index, false)
  const after = historicalSource(index, true)
  const content = [
    ...(index % 5 === 0
      ? [
          v2Reasoning(`Reviewing the existing implementation. ${"constraint analysis ".repeat(20)}`, {
            id: `prt_0000_${suffix}_reasoning`,
            created: 1690000001000 + index * 2_000,
            completed: 1690000001200 + index * 2_000,
          }),
        ]
      : []),
    v2Text(historicalMarkdown(index), `prt_0000_${suffix}_assistant`),
    ...(index % 8 === 0
      ? [
          v2Tool({
            id: `prt_0000_${suffix}_edit`,
            name: "edit",
            created: 1690000001200 + index * 2_000,
            completed: 1690000001400 + index * 2_000,
            state: v2ToolCompleted({
              input: { filePath: `src/history-${index}.ts` },
              structured: {
                title: `src/history-${index}.ts`,
                filediff: { file: `src/history-${index}.ts`, additions: 48, deletions: 48, before, after },
              },
              content: [{ type: "text", text: `Edited src/history-${index}.ts` }],
            }),
          }),
        ]
      : []),
    ...(index % 12 === 0
      ? [
          v2Tool({
            id: `prt_0000_${suffix}_write`,
            name: "write",
            created: 1690000001400 + index * 2_000,
            completed: 1690000001500 + index * 2_000,
            state: v2ToolCompleted({
              input: { filePath: `src/generated-${index}.tsx`, content: after },
              structured: {
                title: `src/generated-${index}.tsx`,
                filediff: { file: `src/generated-${index}.tsx`, additions: 32, deletions: 0, before: "", after },
              },
              content: [{ type: "text", text: `Wrote src/generated-${index}.tsx` }],
            }),
          }),
        ]
      : []),
    ...(index % 16 === 0
      ? [
          v2Tool({
            id: `prt_0000_${suffix}_patch`,
            name: "apply_patch",
            created: 1690000001500 + index * 2_000,
            completed: 1690000001700 + index * 2_000,
            state: v2ToolCompleted({
              input: { patchText: realisticPatch(index) },
              structured: {
                title: "src/components/SessionCard.tsx",
                files: [
                  {
                    filePath: "src/components/SessionCard.tsx",
                    relativePath: "src/components/SessionCard.tsx",
                    type: "update",
                    additions: 8,
                    deletions: 3,
                    patch: realisticPatch(index),
                    before,
                    after,
                  },
                ],
              },
              content: [{ type: "text", text: "Success. Updated src/components/SessionCard.tsx" }],
            }),
          }),
        ]
      : []),
  ]
  return [
    v2UserMessage({
      id: userID,
      text: `Historical prompt ${index}`,
      created: 1690000000000 + index * 2_000,
    }),
    v2AssistantMessage({
      id: assistantID,
      created: 1690000001000 + index * 2_000,
      completed: 1690000001500 + index * 2_000,
      agent: "build",
      model,
      cost: 0.01,
      tokens,
      finish: "stop",
      content,
    }),
  ]
}

function historicalMarkdown(index: number) {
  const code = `import { For, Show, createSignal } from "solid-js"

type SessionRow = { id: string; title: string; active: boolean }

export function SessionList(props: { rows: SessionRow[] }) {
  const [selected, setSelected] = createSignal<string>()
  return (
    <section aria-label="Sessions">
      <For each={props.rows}>{(row) => (
        <button classList={{ active: row.active }} onClick={() => setSelected(row.id)}>
          <Show when={selected() === row.id} fallback={row.title}>{row.title.toUpperCase()}</Show>
        </button>
      )}</For>
    </section>
  )
}`
  return `## Session renderer review ${index}

The active session keeps **semantic row identity** while reconciling measured content. See [Solid documentation](https://docs.solidjs.com/) and the inline \`measureElement(node)\` call.

| Concern | Current behavior | Verification |
| --- | --- | --- |
| streaming | appends Markdown blocks | painted frames |
| geometry | anchors visible rows | DOM coordinates |
| tools | preserves expanded state | keyed remount probe |

> Long sessions combine Markdown, syntax highlighting, tool output, and asynchronously rendered diffs.

${index % 4 === 0 ? `\`\`\`tsx\n${code}\n\`\`\`\n\n\`\`\`bash\nbun typecheck\nbun test --preload ./happydom.ts ./src/pages/session\ngit diff --check\n\`\`\`` : "- preserve the viewport anchor\n- avoid replacing stable Markdown nodes\n- process provider deltas without blocking input"}`
}

function historicalSource(index: number, updated: boolean) {
  const method = updated ? "toLocaleUpperCase(props.locale)" : "toUpperCase()"
  const limit = updated ? 24 : 20
  return `import { createMemo, For } from "solid-js"

type Message = {
  id: string
  role: "user" | "assistant"
  text: string
  tokens: { input: number; output: number }
}

export function MessageSummary(props: { messages: Message[]; locale: string }) {
  const visible = createMemo(() => props.messages.filter((message) => message.text.trim()).slice(-${limit}))
  const total = createMemo(() => visible().reduce((sum, message) => sum + message.tokens.output, 0))
  return (
    <article data-session-index="${index}">
      <header>{total().toLocaleString(props.locale)} output tokens</header>
      <For each={visible()}>{(message) => <p data-role={message.role}>{message.text.${method}}</p>}</For>
    </article>
  )
}
`
}

function realisticPatch(index: number) {
  return `*** Begin Patch
*** Update File: src/components/SessionCard.tsx
@@
-const title = props.session.title.toUpperCase()
-const messages = props.messages.slice(-20)
+const title = props.session.title.toLocaleUpperCase(props.locale)
+const messages = props.messages.filter((message) => message.text.trim()).slice(-24)
+const outputTokens = messages.reduce((sum, message) => sum + message.tokens.output, 0)
@@
-  <h2>{title}</h2>
+  <h2 data-session-index="${index}">{title}</h2>
+  <span>{outputTokens.toLocaleString(props.locale)} output tokens</span>
*** End Patch`
}

export function streamChunk(index: number, count: number) {
  if (index === 0) return `\n\n## Implementation plan\n\nStreaming **bold analysis`
  if (index === count - 1)
    return `\n\`\`\`\n\n## Verification\n\n- **Typecheck:** passed\n- **Timeline geometry:** stable\n- **Streaming output:** benchmark-complete <!-- stream-${index} -->`

  const section = Math.floor(index / 18) + 1
  const fragments = [
    ` continues across three`,
    ` or four word`,
    ` provider deltas and`,
    ` closes in this fragment**. <!-- stream-${index} -->\n\n`,
    `| Concern | State`,
    ` | Verification |\n|`,
    ` --- | ---`,
    ` | --- |\n|`,
    ` markdown | incremental |`,
    ` painted frames | <!-- stream-${index} -->\n\n`,
    `\`\`\`tsx\nconst row: SessionRow`,
    ` = rows[index] ??`,
    ` fallback\nconst title =`,
    ` row.title.toLocaleUpperCase(locale)\n`,
    `const selected = createMemo(()`,
    ` => row.id ===`,
    ` activeID()) // stream-${index}\n`,
    `// stream-${index}\n\`\`\`\n\n### Iteration ${section}\n\nStreaming **bold analysis`,
  ]
  return fragments[(index - 1) % fragments.length]!
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
