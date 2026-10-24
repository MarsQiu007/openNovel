// V2 化（perf-benchmark-v2）：消息从 {info, parts} 对改单体 SessionMessage（v2-fixture 工厂，
// 确定性 ID 保留）；手写 pageMessages 分页删除——V2 mock 服务端自持不透明 cursor 分页，
// fixture 只供升序全量列表。turn 级 summary.diffs 在 V2 adapter 无通路（D5），不再生成。
import {
  v2AssistantMessage,
  v2Reasoning,
  v2Text,
  v2Tool,
  v2ToolCompleted,
  v2UserMessage,
  validateV2Timeline,
  type V2FixtureMessage,
} from "../../utils/v2-fixture"

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
const childID = "ses_smoke_child"
const directory = "C:/OpenNovel/SmokeProject"
const novelID = "novel_smoke_timeline"
const projectID = "proj_smoke_timeline"
const model = { id: "claude-opus-4-6", providerID: "opennovel" }

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

function userMessage(index: number, textLength: number) {
  return v2UserMessage({
    id: id("msg_user", index),
    text: lorem(index, textLength),
    created: 1700000000000 + index * 10_000,
  })
}

type AssistantContent = Parameters<typeof v2AssistantMessage>[0]["content"]

function assistantMessage(index: number, content: AssistantContent) {
  return v2AssistantMessage({
    id: id("msg_assistant", index),
    created: 1700000000000 + index * 10_000 + 1_000,
    completed: 1700000000000 + index * 10_000 + 8_000,
    agent: "build",
    model,
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
    content,
  })
}

function textPart(index: number, partIndex: number, length: number) {
  const prose = lorem(index * 13 + partIndex, length)
  const text =
    index % 12 === 0
      ? `${prose}\n\n\`\`\`ts\n${code(index, 80)}\n\`\`\``
      : index % 5 === 0
        ? `${prose}\n\n\`\`\`ts\nexport const value = "${lorem(index, 220)}"\n\`\`\``
        : index % 7 === 0
          ? `${prose}\n\nThe wrapped inline value is \`${lorem(index, 180)}\`.`
          : prose
  return v2Text(text, id(`prt_text_${partIndex}`, index))
}

function reasoningPart(index: number, partIndex: number, length: number) {
  return v2Reasoning(lorem(index * 19 + partIndex, length), {
    id: id(`prt_reasoning_${partIndex}`, index),
    created: 1700000000000 + index * 10_000,
    completed: 1700000000000 + index * 10_000 + 500,
  })
}

function toolPart(
  index: number,
  partIndex: number,
  tool: string,
  input: Record<string, unknown>,
  outputLength = 160,
  metadataOverride?: Record<string, unknown>,
) {
  const metadata =
    metadataOverride ??
    (tool === "apply_patch"
      ? { files: [patchFile(index, "update"), patchFile(index + 1, index % 2 === 0 ? "add" : "delete")] }
      : tool === "edit" || tool === "write"
        ? {
            filediff: fileDiff(String(input.filePath ?? `src/generated/file-${index}.ts`), index),
            diff: patch(index, outputLength),
            preview: patch(index + 1, 420),
          }
        : tool === "question"
          ? { answers: [["Proceed"], ["Keep sample output"]] }
          : {})
  // V2 工具态：V1 state.title 并入 structured（adapter 从 structured.title 取标题），
  // V1 state.metadata 整体等于 structured（透传为视图模型 metadata），output 走 content 文本
  return v2Tool({
    id: id(`prt_tool_${tool}_${partIndex}`, index),
    name: tool,
    created: 1700000000000 + index * 10_000,
    completed: 1700000000000 + index * 10_000 + 400,
    state: v2ToolCompleted({
      input,
      structured: {
        ...metadata,
        title: tool === "bash" ? "Verify generated output" : input.filePath || input.path || input.pattern || "completed",
      },
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
  const lines = seed % 12 === 0 ? 300 : seed % 8 === 0 ? 2 : 38
  const before = code(seed, lines, seed % 10 === 0 ? 280 : 32)
  const after =
    lines === 2
      ? before.replace("value1", "updatedValue1")
      : lines === 300
        ? code(seed + 1, lines, seed % 10 === 0 ? 280 : 32)
        : before.replace("value4", "updatedValue4").replace("value20", "updatedValue20")
  return {
    file,
    additions: lines === 300 ? 300 : lines === 2 ? 1 : 2,
    deletions: lines === 300 ? 300 : lines === 2 ? 1 : 2,
    before,
    after,
  }
}

function patch(seed: number, length: number) {
  return `diff --git a/src/generated/file-${seed}.ts b/src/generated/file-${seed}.ts\n+${lorem(seed, length).replace(/\n/g, "\n+")}`
}

function code(seed: number, lines: number, width = 32) {
  return Array.from(
    { length: lines },
    (_, index) => `export const value${index} = "${lorem(seed + index, width)}"`,
  ).join("\n")
}

function turn(index: number): V2FixtureMessage[] {
  const user = userMessage(index, 100 + (index % 4) * 80)
  const content = [
    ...(index % 5 === 0 ? [reasoningPart(index, 0, 420)] : []),
    ...(index % 3 === 0
      ? [
          toolPart(index, 0, "read", { filePath: `src/generated/file-${index}.ts`, offset: 0, limit: 80 }, 220),
          toolPart(index, 5, "glob", { path: directory, pattern: `**/*sample-${index}*.ts` }, 140),
          toolPart(index, 1, "grep", { path: directory, pattern: `sample-${index}`, include: "*.ts" }, 180),
          toolPart(index, 6, "list", { path: `src/generated/${index}` }, 120),
        ]
      : []),
    textPart(index, 2, 160 + (index % 6) * 90),
    ...(index % 4 === 0 ? [toolPart(index, 3, "edit", { filePath: `src/generated/file-${index}.ts` }, 700)] : []),
    ...(index % 6 === 0
      ? [toolPart(index, 7, "write", { filePath: `src/generated/write-${index}.ts`, content: code(index, 28) }, 560)]
      : []),
    ...(index % 8 === 0
      ? [toolPart(index, 8, "apply_patch", { files: [`src/generated/patch-${index}.ts`] }, 620)]
      : []),
    ...(index % 7 === 0
      ? [toolPart(index, 4, "bash", { command: "bun typecheck", description: "Verify generated output" }, 620)]
      : []),
    ...(index % 10 === 0 ? [toolPart(index, 9, "webfetch", { url: "https://example.com/docs/sample" }, 120)] : []),
    ...(index % 11 === 0 ? [toolPart(index, 10, "websearch", { query: "sample movement notes" }, 240)] : []),
    ...(index % 13 === 0
      ? [
          toolPart(
            index,
            11,
            "question",
            { questions: [{ question: "Use generated fixture?" }, { question: "Keep same row shape?" }] },
            120,
          ),
        ]
      : []),
    ...(index % 17 === 0
      ? [toolPart(index, 12, "task", { description: "Inspect generated fixture", subagent_type: "explore" }, 160)]
      : []),
  ]
  return [user, assistantMessage(index, content)]
}

const targetMessages = Array.from({ length: 72 }, (_, index) => turn(index)).flat()
const sourceMessages = Array.from({ length: 12 }, (_, index) => [
  userMessage(index + 1000, 120),
  assistantMessage(index + 1000, [
    textPart(index + 1000, 0, 240),
    ...(index === 11
      ? [
          toolPart(
            index + 1000,
            1,
            "task",
            { description: "Inspect child navigation", subagent_type: "explore" },
            160,
            { sessionId: childID },
          ),
        ]
      : []),
  ]),
]).flat()
const childMessages = Array.from({ length: 4 }, (_, index) => [
  userMessage(index + 2000, 120),
  assistantMessage(index + 2000, [textPart(index + 2000, 0, 240)]),
]).flat()

for (const messages of [targetMessages, sourceMessages, childMessages]) validateV2Timeline(messages)

export const fixture = {
  directory,
  novelID,
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
    {
      id: childID,
      parentID: sourceID,
      slug: "child",
      projectID,
      directory,
      title: "Inspect child navigation",
      version: "dev",
      time: { created: 1700000002000, updated: 1700000002000 },
    },
  ],
  sourceID,
  targetID,
  childID,
  messages: { [sourceID]: sourceMessages, [targetID]: targetMessages, [childID]: childMessages },
  expected: {
    sourceTitle: "Uncommitted changes inquiry",
    targetTitle: "Example Game: sample jump movement & sample physics analysis",
    childTitle: "Inspect child navigation",
    sourceMessageIDs: sourceMessages
      .filter((message) => message.type === "user")
      .map((message) => message.id),
    targetMessageIDs: targetMessages
      .filter((message) => message.type === "user")
      .map((message) => message.id),
    childMessageIDs: childMessages.filter((message) => message.type === "user").map((message) => message.id),
  },
}
