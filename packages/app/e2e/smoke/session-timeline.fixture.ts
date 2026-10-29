// V2 wire 版 smoke 时间线 fixture（e2e-v2-mock Wave 2.1）：消息经 v2-fixture 工厂
// 构造并过 Effect Schema 严格校验。排序对齐消费端事实——store 对消息与 part 均按
// id 字典序排序（server-session.ts），故消息 id 设计为字典序==时序（_a 用户在前、
// _b 助手在后），期望 part 序列按 id 排序推导（与 store 渲染序一致）。
import type {
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from "@opennovel-ai/sdk/v2/client"
import {
  v2AssistantMessage,
  v2Reasoning,
  v2Text,
  v2Tool,
  v2ToolCompleted,
  v2UserMessage,
  validateV2Timeline,
  type V2FixtureMessage,
} from "../utils/v2-fixture"

const words = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "metro",
  "nova",
  "orbit",
  "pixel",
  "quartz",
  "river",
  "signal",
  "vector",
]

const sourceID = "ses_smoke_source"
const targetID = "ses_smoke_target"
const directory = "C:/OpenNovel/SmokeProject"
const projectID = "proj_smoke_timeline"
const model = { id: "claude-opus-4-6", providerID: "opennovel", variant: "max" }
const epoch = 1_700_000_000_000

function lorem(seed: number, length: number) {
  let out = ""
  let i = seed
  while (out.length < length) {
    const word = words[i % words.length]
    out += (out ? " " : "") + word
    if (i % 17 === 0) out += ".\n\n"
    i += 7
  }
  return out.slice(0, length)
}

function id(prefix: string, value: number) {
  return `${prefix}_smoke_${String(value).padStart(4, "0")}`
}

// 字典序==时序：同一回合内用户消息（_a）排在助手消息（_b）前
function userMessageID(index: number) {
  return `${id("msg", index)}_a`
}

function assistantMessageID(index: number) {
  return `${id("msg", index)}_b`
}

function textContent(index: number, partIndex: number, length: number): SessionMessageAssistantText {
  return v2Text(lorem(index * 13 + partIndex, length), id(`prt_text_${partIndex}`, index))
}

function reasoningContent(index: number, partIndex: number, length: number): SessionMessageAssistantReasoning {
  return v2Reasoning(lorem(index * 19 + partIndex, length), {
    id: id(`prt_reasoning_${partIndex}`, index),
    created: epoch + index * 10_000,
    completed: epoch + index * 10_000 + 500,
  })
}

function toolContent(
  index: number,
  partIndex: number,
  tool: string,
  input: Record<string, unknown>,
  outputLength = 160,
): SessionMessageAssistantTool {
  // structured 整体透传为视图模型 metadata（v2-adapter）；title 由 adapter 的 structuredTitle 读取
  const structured: Record<string, unknown> = {
    title: tool === "bash" ? input.command : input.filePath || input.path || input.pattern || "completed",
    ...(tool === "apply_patch"
      ? { files: [patchFile(index, "update"), patchFile(index + 1, index % 2 === 0 ? "add" : "delete")] }
      : tool === "edit" || tool === "write"
        ? {
            filediff: fileDiff(String(input.filePath ?? `src/generated/file-${index}.ts`), index),
            diff: patch(index, outputLength),
            preview: patch(index + 1, 420),
          }
        : tool === "question"
          ? { answers: [["Proceed"], ["Keep sample output"]] }
          : {}),
  }
  return v2Tool({
    name: tool,
    id: id(`prt_tool_${tool}_${partIndex}`, index),
    created: epoch + index * 10_000,
    ran: epoch + index * 10_000,
    completed: epoch + index * 10_000 + 400,
    state: v2ToolCompleted({
      input,
      structured,
      content: [{ type: "text", text: lorem(index * 23 + partIndex, outputLength) }],
    }),
  })
}

function patchFile(seed: number, type: "add" | "update" | "delete") {
  return {
    filePath: `src/generated/patch-${seed}.ts`,
    relativePath: `src/generated/patch-${seed}.ts`,
    type,
    additions: (seed % 7) + 1,
    deletions: type === "add" ? 0 : seed % 4,
    patch: patch(seed, 520),
    before: type === "add" ? undefined : code(seed, 18),
    after: type === "delete" ? undefined : code(seed + 1, 24),
  }
}

function fileDiff(file: string, seed: number) {
  return {
    file,
    additions: (seed % 9) + 1,
    deletions: seed % 4,
    before: code(seed, 32),
    after: code(seed + 1, 38),
  }
}

function patch(seed: number, length: number) {
  return `diff --git a/src/generated/file-${seed}.ts b/src/generated/file-${seed}.ts\n+${lorem(seed, length).replace(/\n/g, "\n+")}`
}

function code(seed: number, lines: number) {
  return Array.from({ length: lines }, (_, index) => `export const value${index} = "${lorem(seed + index, 32)}"`).join(
    "\n",
  )
}

function turn(index: number): V2FixtureMessage[] {
  // V1 fixture 的用户 summary.diffs 在 V2 wire 无对应面（adapter 不产出），冒烟断言亦不覆盖，整体丢弃
  const user = v2UserMessage({
    id: userMessageID(index),
    text: lorem(index, 100 + (index % 4) * 80),
    created: epoch + index * 10_000,
  })
  const content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool> = [
    ...(index % 5 === 0 ? [reasoningContent(index, 0, 420)] : []),
    ...(index % 3 === 0
      ? [
          toolContent(index, 0, "read", { filePath: `src/generated/file-${index}.ts`, offset: 0, limit: 80 }, 220),
          toolContent(index, 5, "glob", { path: directory, pattern: `**/*sample-${index}*.ts` }, 140),
          toolContent(index, 1, "grep", { path: directory, pattern: `sample-${index}`, include: "*.ts" }, 180),
          toolContent(index, 6, "list", { path: `src/generated/${index}` }, 120),
        ]
      : []),
    textContent(index, 2, 160 + (index % 6) * 90),
    ...(index % 4 === 0 ? [toolContent(index, 3, "edit", { filePath: `src/generated/file-${index}.ts` }, 700)] : []),
    ...(index % 6 === 0
      ? [toolContent(index, 7, "write", { filePath: `src/generated/write-${index}.ts`, content: code(index, 28) }, 560)]
      : []),
    ...(index % 8 === 0
      ? [toolContent(index, 8, "apply_patch", { files: [`src/generated/patch-${index}.ts`] }, 620)]
      : []),
    ...(index % 7 === 0 ? [toolContent(index, 4, "bash", { command: "bun typecheck" }, 620)] : []),
    ...(index % 10 === 0 ? [toolContent(index, 9, "webfetch", { url: "https://example.com/docs/sample" }, 120)] : []),
    ...(index % 11 === 0 ? [toolContent(index, 10, "websearch", { query: "sample movement notes" }, 240)] : []),
    ...(index % 13 === 0
      ? [
          toolContent(
            index,
            11,
            "question",
            { questions: [{ question: "Use generated fixture?" }, { question: "Keep same row shape?" }] },
            120,
          ),
        ]
      : []),
    ...(index % 17 === 0
      ? [toolContent(index, 12, "task", { description: "Inspect generated fixture", subagent_type: "explore" }, 160)]
      : []),
  ]
  return [
    user,
    v2AssistantMessage({
      id: assistantMessageID(index),
      created: epoch + index * 10_000 + 1_000,
      completed: epoch + index * 10_000 + 8_000,
      model,
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content,
    }),
  ]
}

const targetMessages = Array.from({ length: 72 }, (_, index) => turn(index)).flat()
const sourceMessages = Array.from({ length: 12 }, (_, index) => [
  v2UserMessage({ id: userMessageID(index + 1000), text: lorem(index + 1000, 120), created: epoch + index * 10_000 }),
  v2AssistantMessage({
    id: assistantMessageID(index + 1000),
    created: epoch + index * 10_000 + 1_000,
    completed: epoch + index * 10_000 + 8_000,
    model,
    agent: "build",
    content: [textContent(index + 1000, 0, 240)],
  }),
]).flat()

validateV2Timeline(targetMessages)
validateV2Timeline(sourceMessages)

/** 期望的 part id 序列：时间线保持服务端 content 到达顺序（store 不再按 id 字典序排序），与用户文本 part 的适配 id（`${message.id}:text`）对齐 */
function expectedPartIDs(message: V2FixtureMessage): string[] {
  if (message.type === "user") return message.text.trim() ? [`${message.id}:text`] : []
  if (message.type !== "assistant") return []
  return message.content.filter((item) => item.type === "tool" || !!item.text.trim()).map((item) => item.id)
}

export const fixture = {
  directory,
  project: {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "smoke-project",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: {
    all: [
      {
        id: "opennovel",
        name: "OpenNovel",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opennovel"],
    default: { providerID: "opennovel", modelID: "claude-opus-4-6" },
  },
  sessions: [
    {
      id: sourceID,
      slug: "source",
      projectID,
      directory,
      title: "Uncommitted changes inquiry",
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    {
      id: targetID,
      slug: "target",
      projectID,
      directory,
      title: "Example Game: sample jump movement & sample physics analysis",
      version: "dev",
      time: { created: 1700000001000, updated: 1700000001000 },
    },
  ],
  sourceID,
  targetID,
  v2Messages: { [sourceID]: sourceMessages, [targetID]: targetMessages } as Record<string, V2FixtureMessage[]>,
  expected: {
    sourceTitle: "Uncommitted changes inquiry",
    targetTitle: "Example Game: sample jump movement & sample physics analysis",
    targetMessageIDs: targetMessages
      .filter((message) => message.type === "user")
      .map((message) => message.id),
    targetPartIDs: targetMessages.flatMap(expectedPartIDs),
    expandedShellPartID: targetMessages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .find((item) => item.type === "tool" && item.name === "bash")!.id,
  },
}
