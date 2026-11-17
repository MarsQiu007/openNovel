export * as SessionCompaction from "./compaction"

import { isContextOverflowFailure, LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@opennovel-ai/llm"
import { DateTime, Effect, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
/** 设计决策 7：摘要请求自身被 provider 判上下文溢出时，按此阶梯逐级缩减输入（相对首次被拒请求的估算）。 */
const SHRINK_STEPS = [0.85, 0.7, 0.5, 0.35] as const
/** 与缩减阶梯对齐的工具内容裁剪层级：逐级收紧工具输出截断，整段丢弃仅作最后手段。 */
const TOOL_OUTPUT_LEVELS = [TOOL_OUTPUT_MAX_CHARS, 1_000, 500, 200] as const
/** 模型首次回复缺少约定结构时的一次提醒；空摘要不提醒，直接失败。 */
const NUDGE =
  "The previous response did not fill in the required summary template. Do not call tools. Return the summary as text using the exact section headings from the template."
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

/** 结构校验用章节标题：回复至少命中一个才视为符合模板（### 子章节不算）。 */
const TEMPLATE_HEADINGS = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("## "))

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

export type Settings = {
  readonly auto: boolean
  readonly buffer: number | string
  readonly tokens: number
  readonly background: boolean
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
}

/** 一次压缩执行的结算：completed/failed 携带操作消息 ID，skipped 表示未创建操作。 */
export type Outcome =
  | { readonly status: "completed"; readonly messageID: SessionMessage.ID }
  | { readonly status: "failed"; readonly messageID: SessionMessage.ID }
  | { readonly status: "skipped" }

const SKIPPED: Outcome = { status: "skipped" }

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string, maxChars: number) =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message, toolMaxChars = TOOL_OUTPUT_MAX_CHARS) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content), toolMaxChars)}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output, toolMaxChars)}`
  return ""
}

export const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
      background: current.background ?? result.background,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS, background: true },
  )
}

/** 百分比预留换算为 token；固定数值原样返回。 */
export const resolveBuffer = (buffer: number | string, window: number) => {
  if (typeof buffer === "number") return buffer
  const share = Number.parseFloat(buffer) / 100
  return Math.round(window * share)
}

/** 消息粒度的 head/recent 切分：recent 取末尾整段消息共 tokens 预算，head 为其余送入摘要器的部分。
 * 整段切分保证缩减阶梯可以按消息丢弃最旧 head，且不会把同一段交换同时留在摘要与尾部两处。
 */
const select = (
  entries: readonly Entry[],
  tokens: number,
  toolMaxChars = TOOL_OUTPUT_MAX_CHARS,
): { readonly head: readonly string[]; readonly headEntries: readonly Entry[]; readonly recent: string } | undefined => {
  const conversation = entries.flatMap((entry) => {
    if (entry.message.type === "compaction") return []
    const text = serialize(entry.message, toolMaxChars)
    return text ? [{ entry, text }] : []
  })
  if (conversation.length === 0) return undefined
  let total = 0
  let cut = conversation.length
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index].text)
    if (next > tokens) break
    total = next
    cut = index
  }
  return {
    head: conversation.slice(0, cut).map((item) => item.text),
    headEntries: conversation.slice(0, cut).map((item) => item.entry),
    recent: conversation.slice(cut).map((item) => item.text).join("\n\n"),
  }
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) =>
  [
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
  ].join("\n\n")

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)

  /**
   * 压缩执行计划（纯函数）：可行返回摘要 prompt 所需的上下文，不可行返回 undefined。
   * compactAfterOverflow 与 shouldAutoCompact 共用同一判定，保证「入队前可判定」与「执行时可执行」一致：
   * 空会话、无 head 且无上一摘要、摘要 prompt 本身超窗三种注定失败的情形都挡在执行前。
   */
  const plan = (input: Input) => {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return undefined
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const selected = select(input.entries, config.tokens)
    const previousSummary = input.entries.find(
      (entry) =>
        entry.message.type === "compaction" &&
        (entry.message.status === undefined || entry.message.status === "completed"),
    )?.message
    if (!selected || (selected.head.length === 0 && previousSummary?.type !== "compaction")) return undefined
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    const promptFor = (head: readonly string[]) =>
      buildPrompt({
        previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
        context: [
          previousSummary?.type === "compaction" ? previousSummary.recent : "",
          head.join("\n\n"),
        ].filter(Boolean),
      })
    const summaryPrompt = promptFor(selected.head)
    if (Token.estimate(summaryPrompt) > context - summaryOutput) return undefined
    return { previousSummary, selected, summaryOutput, promptFor, summaryPrompt }
  }

  type Reply =
    | { readonly tag: "text"; readonly text: string }
    | { readonly tag: "overflow" }
    | { readonly tag: "provider-error" }
    /** 首次回复即空摘要：不 nudge，直接失败。 */
    | { readonly tag: "empty" }
    /** nudge 后仍不符合模板结构。 */
    | { readonly tag: "invalid" }

  const compactAfterOverflow = Effect.fn("SessionCompaction.compactAfterOverflow")(function* (
    input: Input,
    reason: "auto" | "manual" = "auto",
  ) {
    const prepared = plan(input)
    if (prepared === undefined) return SKIPPED
    const messageID = input.messageID
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason,
    })

    const streamReply = (request: ReturnType<typeof LLM.request>): Effect.Effect<Reply> =>
      Effect.gen(function* () {
        const chunks: string[] = []
        let overflow = false
        let failed = false
        const streamed = yield* dependencies.llm.stream(request).pipe(
          Stream.runForEach((event) => {
            if (LLMEvent.is.providerError(event)) {
              failed = true
              if (isContextOverflowFailure(event)) overflow = true
            }
            if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
            return Effect.void
          }),
          Effect.as(true),
          Effect.catchTag("LLM.Error", (error) => {
            if (isContextOverflowFailure(error)) overflow = true
            return Effect.succeed(false)
          }),
        )
        if (!streamed || failed) return overflow ? ({ tag: "overflow" } as const) : ({ tag: "provider-error" } as const)
        return { tag: "text" as const, text: chunks.join("") }
      })

    const filled = (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return false
      return trimmed.split("\n").some((line) => TEMPLATE_HEADINGS.includes(line.trim()))
    }

    // 结构缺失（含 nudge 后仍不符合）最多一次提醒；空摘要直接失败
    const summarize = (request: ReturnType<typeof LLM.request>): Effect.Effect<Reply> =>
      Effect.gen(function* () {
        const reply = yield* streamReply(request)
        if (reply.tag !== "text") return reply
        if (filled(reply.text)) return reply
        if (!reply.text.trim()) return { tag: "empty" as const }
        const nudged = LLM.request({
          model: input.model,
          messages: [...request.messages, Message.user(NUDGE)],
          tools: [],
          generation: request.generation,
        })
        const retry = yield* streamReply(nudged)
        if (retry.tag !== "text") return retry
        return filled(retry.text) ? retry : ({ tag: "invalid" } as const)
      })

    // 缩减阶梯：按目标估算从 head 末尾（最旧侧）起保留能放下的消息，丢弃的整段以注记明示，
    // 不静默从摘要输入与最近尾部同时丢弃；工具内容按层级收紧截断。
    const shrinkHead = (headEntries: readonly Entry[], target: number, toolMaxChars: number) => {
      // keptFrom 是首个保留项的索引：被丢弃的较旧消息数即 keptFrom 本身
      const estimateFor = (keptFrom: number) => {
        const omitted = keptFrom
        const head = headEntries
          .slice(keptFrom)
          .map((entry) => serialize(entry.message, toolMaxChars))
          .join("\n\n")
        const note = omitted > 0 ? `[${omitted} earlier messages omitted from the summary]\n\n` : ""
        return { estimate: Token.estimate(note + head), omitted, head }
      }
      let keptFrom = headEntries.length
      for (let index = headEntries.length - 1; index >= 0; index--) {
        if (estimateFor(index).estimate > target) break
        keptFrom = index
      }
      if (keptFrom === headEntries.length && estimateFor(keptFrom).estimate > target) return undefined
      const fitted = estimateFor(keptFrom)
      return { head: fitted.head, omitted: fitted.omitted }
    }

    let headContext = prepared.selected.head.join("\n\n")
    let rejections = 0
    let rejected: number | undefined
    while (true) {
      const request = LLM.request({
        model: input.model,
        messages: [Message.user(prepared.promptFor([headContext]))],
        tools: [],
        generation: { maxTokens: prepared.summaryOutput },
      })
      const reply = yield* summarize(request)
      if (reply.tag === "text") {
        yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
          sessionID: input.sessionID,
          messageID,
          timestamp: yield* DateTime.now,
          reason,
          text: reply.text,
          recent: prepared.selected.recent,
        })
        return { status: "completed" as const, messageID }
      }
      // 错误保持脱敏：不带原始响应体、请求头或凭据
      const fail = (message: string) =>
        Effect.gen(function* () {
          yield* dependencies.events.publish(SessionEvent.Compaction.Failed, {
            sessionID: input.sessionID,
            messageID,
            timestamp: yield* DateTime.now,
            reason,
            error: { type: "compaction.failed", message },
          })
          return { status: "failed" as const, messageID }
        })
      if (reply.tag === "empty") return yield* fail("摘要为空，已中止压缩")
      if (reply.tag === "invalid") return yield* fail("摘要不符合约定结构，已中止压缩")
      if (reply.tag === "provider-error") return yield* fail("摘要生成失败，请稍后重试")
      const step = SHRINK_STEPS[rejections]
      if (step === undefined) return yield* fail("摘要请求已缩减到最小级别仍被模型拒绝")
      rejected ??= estimate({ system: request.system, messages: request.messages, tools: request.tools })
      const target = Math.floor(rejected * step)
      rejections++
      const shrunk = shrinkHead(
        prepared.selected.headEntries,
        target,
        TOOL_OUTPUT_LEVELS[rejections] ?? TOOL_OUTPUT_LEVELS[TOOL_OUTPUT_LEVELS.length - 1],
      )
      if (shrunk === undefined) return yield* fail("摘要请求无法进一步缩减，已中止压缩")
      headContext = [
        shrunk.omitted > 0 ? `[${shrunk.omitted} earlier messages omitted from the summary]` : "",
        shrunk.head,
      ]
        .filter(Boolean)
        .join("\n\n")
    }
  })

  /** 阈值估计（纯函数）：是否超出窗口减预留的触发线。auto 关闭或未知窗口不触发。 */
  const thresholdExceeded = (input: Input) => {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    return (
      estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) >
      context - Math.max(output, resolveBuffer(config.buffer, context))
    )
  }

  /** 自动压缩前置（纯函数）：阈值命中且本次压缩确有可执行计划才入队，避免为注定失败的操作排队。 */
  const shouldAutoCompact = (input: Input) => thresholdExceeded(input) && plan(input) !== undefined
  return {
    thresholdExceeded,
    shouldAutoCompact,
    /** 溢出自动恢复与阈值触发共用同一开关：auto:false 时两者都不自动执行，手动压缩仍可用。 */
    overflowRecoveryEnabled: config.auto,
    compactAfterOverflow,
  }
}
