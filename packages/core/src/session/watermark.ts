export * as SessionWatermark from "./watermark"

import { Context, Effect, Layer, Schema } from "effect"
import { Model } from "@opennovel-ai/schema/model"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SessionCompaction, resolveBuffer } from "./compaction"
import { SessionContextEpoch } from "./context-epoch"
import { MessageDecodeError } from "./error"
import { SessionHistory } from "./history"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

export type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

/**
 * 上下文域保守文本估算：ASCII 延续约 4 字符/token，CJK 等非 ASCII 内容按不低于
 * 1 token/字计。只用于压缩域，允许偏早触发、不得偏晚；首个匹配 usage 返回后自动校准。
 */
export const estimateText = (text: string) => {
  let tokens = 0
  for (const char of text) tokens += char.codePointAt(0)! > 0x7f ? 1 : 0.25
  return Math.ceil(tokens)
}

const estimateToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content.reduce((sum, item) => sum + (item.type === "text" ? estimateText(item.text) : 0), 0)

const estimateTool = (tool: SessionMessage.AssistantTool) => {
  const input = typeof tool.state.input === "string" ? tool.state.input : JSON.stringify(tool.state.input)
  let total = estimateText(`${tool.name} ${input}`)
  if (tool.state.status === "completed")
    total += estimateToolContent(tool.state.content) + estimateText(JSON.stringify(tool.state.structured))
  if (tool.state.status === "error") total += estimateText(tool.state.error.message)
  return total
}

/** provider 从未见过的部分：本地工具结果。调用与输入在请求里，已被锚点 usage 覆盖。 */
const estimateAssistantUnseen = (message: SessionMessage.Assistant) =>
  message.content.reduce((sum, part) => {
    if (part.type !== "tool") return sum
    if (part.state.status === "completed") return sum + estimateToolContent(part.state.content)
    if (part.state.status === "error") return sum + estimateText(part.state.error.message)
    return sum
  }, 0)

const estimateMessage = (message: SessionMessage.Message) => {
  switch (message.type) {
    case "agent-switched":
    case "model-switched":
      return 0
    case "user":
      return (
        estimateText(message.text) +
        (message.files ?? []).reduce((sum, file) => sum + estimateText(`${file.name ?? ""} ${file.uri}`), 0)
      )
    case "synthetic":
      return estimateText(message.text)
    case "system":
      return estimateText(message.text)
    case "shell":
      return estimateText(`${message.command}\n${message.output}`)
    case "compaction":
      return estimateText(`${message.summary}\n${message.recent}`)
    case "assistant":
      return message.content.reduce(
        (sum, part) =>
          sum +
          (part.type === "tool"
            ? estimateTool(part)
            : estimateText(part.text)),
        0,
      )
    // switch 已穷举消息联合，此处不可达，仅为满足 consistent-return
    default:
      return 0
  }
}

/**
 * 实测锚点：最近一个 provider/model/variant 均匹配当前会话、带 usage 且无错误的 assistant。
 * agent-switched/model-switched 是指纹边界——边界之后的历史才与当前请求形状兼容；
 * 系统上下文变化由 ContextEpoch baselineSeq 在 entries 装载时截断，天然不再可见。
 */
const isAnchor = (
  message: SessionMessage.Message,
  model: Model.Ref,
  agent: string,
): message is SessionMessage.Assistant =>
  message.type === "assistant" &&
  message.agent === agent &&
  message.error === undefined &&
  message.tokens !== undefined &&
  String(message.model.providerID) === String(model.providerID) &&
  message.model.id === model.id &&
  (message.model.variant ?? undefined) === (model.variant ?? undefined) &&
  message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0

const findAnchor = (entries: readonly Entry[], model: Model.Ref, agent: string) => {
  for (let index = entries.length - 1; index >= 0; index--) {
    const message = entries[index].message
    if (message.type === "agent-switched" || message.type === "model-switched") return undefined
    if (isAnchor(message, model, agent)) return { index, message }
  }
  return undefined
}

export const compute = (input: {
  readonly entries: readonly Entry[]
  readonly agent: string
  readonly model: Model.Ref
  readonly window: number | undefined
  readonly output: number | undefined
  readonly buffer: number | string
  /** 特权系统提示与工具定义的保守预算；无锚点回退时计入估算 */
  readonly baselineTokens?: number
}): SessionSchema.ContextWatermark => {
  const anchor = findAnchor(input.entries, input.model, input.agent)
  let estimated = 0
  if (anchor) {
    // usage 覆盖锚点自身输出，但其本地工具结果 provider 从未见过
    estimated += estimateAssistantUnseen(anchor.message)
    for (let index = anchor.index + 1; index < input.entries.length; index++)
      estimated += estimateMessage(input.entries[index].message)
  } else {
    for (const entry of input.entries) estimated += estimateMessage(entry.message)
    estimated += input.baselineTokens ?? 0
  }
  const tokens = anchor?.message.tokens
  const measured = tokens
    ? Math.round(tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning)
    : 0
  const window = input.window !== undefined && input.window > 0 ? Math.floor(input.window) : undefined
  const total = measured + estimated
  const share = typeof input.buffer === "string" ? Number.parseFloat(input.buffer) / 100 : undefined
  const trigger =
    window === undefined
      ? undefined
      : // 至少保留模型 output 空间：trigger = window - max(configuredReserve, outputLimit)
        Math.max(0, window - Math.max(resolveBuffer(input.buffer, window), Math.ceil(input.output ?? 0)))
  const degraded =
    window === undefined
      ? "模型未提供上下文窗口，仅保留溢出恢复"
      : anchor === undefined
        ? "尚无实测用量锚点，当前为保守估算"
        : undefined
  return {
    model: input.model,
    ...(window === undefined ? {} : { window }),
    measured,
    estimated,
    total,
    ratio: window === undefined ? 0 : total / window,
    ...(trigger === undefined ? {} : { trigger: { ...(share === undefined ? {} : { share }), tokens: trigger } }),
    source: anchor ? (estimated > 0 ? "mixed" : "measured") : "estimated",
    ...(degraded === undefined ? {} : { degraded }),
  }
}

export class ModelNotResolvedError extends Schema.TaggedErrorClass<ModelNotResolvedError>()(
  "SessionWatermark.ModelNotResolvedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model resolvable for session ${this.sessionID}, context watermark unavailable`
  }
}

export interface Interface {
  /** 计算会话当前统一水位快照（实测锚点 + 保守后缀估算）。模型未配置或历史解码失败时报错，由调用方降级。 */
  readonly get: (
    session: SessionSchema.Info,
  ) => Effect.Effect<SessionSchema.ContextWatermark, ModelNotResolvedError | MessageDecodeError>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/SessionWatermark") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const agents = yield* AgentV2.Service
    const catalog = yield* Catalog.Service
    const config = yield* Config.Service
    return Service.of({
      get: Effect.fn("SessionWatermark.get")(function* (session) {
        // 与 runner 同款解析：agent 走默认回退；模型先取会话指定，不可用回退 catalog 默认
        const agent = yield* agents.select(session.agent)
        const selected = (session.model
          ? yield* catalog.model.get(session.model.providerID, session.model.id)
          : undefined) ?? (yield* catalog.model.default())
        if (!selected) return yield* new ModelNotResolvedError({ sessionID: session.id })
        const epoch = yield* SessionContextEpoch.stored(db, session.id)
        const entries = yield* SessionHistory.entriesForRunner(db, session.id, epoch?.baseline_seq ?? 0)
        const compaction = SessionCompaction.settings(yield* config.entries())
        return compute({
          entries,
          agent: agent.id,
          // 锚点按实际运行的模型（含会话 variant）匹配，回退后与指定不一致时自然失配走保守估算
          model: Model.Ref.make({
            id: selected.id,
            providerID: selected.providerID,
            ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
          }),
          window: selected.limit.context > 0 ? selected.limit.context : undefined,
          output: selected.limit.output > 0 ? selected.limit.output : undefined,
          buffer: compaction.buffer,
          ...(epoch === undefined ? {} : { baselineTokens: estimateText(epoch.baseline) }),
        })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [AgentV2.node, Catalog.node, Config.node, Database.node],
})
