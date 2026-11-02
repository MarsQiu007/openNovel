export * as ReasoningVariant from "./reasoning-variant"

import type { ModelV2Info } from "@opennovel-ai/sdk/v2/types"
import type { ModelsDev } from "../models-dev"

/**
 * SDK 语义键（providerOptions）在 variants body 里的载体内键。
 *
 * ModelV2.Info.variants 的 schema 只有 headers/body（Provider.Request.fields 展开），
 * 没有上游的 settings 层；方言表生成的 providerOptions 负载以此键暂存进 body，
 * 由 session/runner/model.ts 的 withVariant 在解析时拆出、经 route defaults 的
 * providerOptions 通道注入协议消费点，不会落到 HTTP 请求体。
 */
export const PROVIDER_OPTIONS_KEY = "opennovel/providerOptions"

export type Support =
  | { readonly type: "effort"; readonly values?: readonly string[] }
  | { readonly type: "toggle" }
  | { readonly type: "budget_tokens"; readonly min?: number; readonly max?: number }

/** models.dev reasoning_options → 标准 Support 列表（移植上游 models-dev.ts 的 supports()）。 */
export function supports(options: ModelsDev.Model["reasoning_options"]): readonly Support[] {
  if (!options) return []
  return options.map((option) =>
    option.type === "effort"
      ? {
          type: "effort",
          values: option.values.filter((value): value is string => value !== null && value !== "null"),
        }
      : option,
  )
}

type Variant = ModelV2Info["variants"][number]
type Overlay = Omit<Variant, "id">

type Protocol = (model: ModelV2Info, support: Support) => Variant[]

/**
 * 按 provider 的 aisdk 包名把 Support 翻译为 variants。
 * 无协议条目的包名返回空（缺省安全，不发未经验证的参数）。
 */
export function resolve(model: ModelV2Info, support: readonly Support[]): ModelV2Info["variants"] {
  const name = model.api.type === "aisdk" ? model.api.package : undefined
  const protocol = name === undefined ? undefined : PROTOCOLS[name]
  if (!protocol) return []
  const toggle = support.some((item) => item.type === "toggle") ? protocol(model, { type: "toggle" }) : []
  const effort = support.find((item) => item.type === "effort")
  const budget = support.find((item) => item.type === "budget_tokens")
  const main = effort ? protocol(model, effort) : budget ? protocol(model, budget) : toggle
  const variants = [...toggle.filter((item) => item.id === "none"), ...main]
  return variants.filter((item, index) => variants.findIndex((other) => other.id === item.id) === index)
}

const EFFORTS = ["low", "medium", "high"]
// fork 的 OpenAI Responses 协议按 OpenAIReasoningEffort 建模，不含 "max"，生成时滤除。
const RESPONSES_EXCLUDED_EFFORTS = new Set(["max"])
// Anthropic 思考预算上限（移植自上游 ANTHROPIC_OUTPUT_TOKEN_MAX）。
const ANTHROPIC_OUTPUT_TOKEN_MAX = 32_000

const variant = (id: string, overlay: Overlay): Variant => ({ id, ...overlay })

/** SDK 语义键的载体 overlay：由 withVariant 拆包后走 providerOptions 通道，不进 HTTP body。 */
const carrier = (providerOptions: Record<string, Record<string, unknown>>): Overlay => ({
  headers: {},
  body: { [PROVIDER_OPTIONS_KEY]: providerOptions },
})

const efforts = (values: readonly string[], spell: (effort: string) => Overlay): Variant[] =>
  values.map((effort) => variant(effort, spell(effort)))

function budgets(
  model: ModelV2Info,
  support: Extract<Support, { type: "budget_tokens" }>,
  spell: (tokens: number) => Overlay,
  ceiling = model.limit.output,
): Variant[] {
  const maximum = Math.min(support.max ?? ceiling - 1, model.limit.output - 1, ceiling - 1)
  if (maximum <= 0) return []
  const high = Math.min(Math.max(support.min ?? 0, Math.floor((maximum + 1) / 2)), maximum)
  return [variant("high", spell(high)), variant("max", spell(maximum))]
}

// @ai-sdk/openai → fork 的 OpenAI Responses 路由。SDK 语义键全部有协议消费点：
// providerOptions.openai.{reasoningEffort, reasoningSummary, include}（lowerOptions）。
const openaiResponses: Protocol = (_, support) => {
  if (support.type !== "effort") return []
  const values = (support.values ?? ["none", "minimal", ...EFFORTS, "xhigh"]).filter(
    (value) => !RESPONSES_EXCLUDED_EFFORTS.has(value),
  )
  return efforts(values, (effort) =>
    carrier({
      openai: {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    }),
  )
}

// @ai-sdk/anthropic → fork 的 Anthropic Messages 路由。协议只建模了
// thinking={type:"enabled",budget_tokens}（AnthropicThinking），上游的 adaptive/effort
// 形态在 fork 无消费点，不生成；toggle 关闭思考同样无类型化通道，缺省安全。
const anthropicMessages: Protocol = (model, support) => {
  if (support.type !== "budget_tokens") return []
  return budgets(
    model,
    support,
    (tokens) => carrier({ anthropic: { thinking: { type: "enabled", budgetTokens: tokens } } }),
    ANTHROPIC_OUTPUT_TOKEN_MAX,
  )
}

// @ai-sdk/openai-compatible → fork 的 OpenAI Chat 路由（chat/completions）。
// 端点对推理参数的拼写无统一标准（GLM/DeepSeek 收 reasoning_effort），走 HTTP body
// overlay 原样直发（与原 GLM 硬编码同通道）；toggle/budget 无通用线协议键，不生成。
const openaiCompatibleChat: Protocol = (_, support) => {
  if (support.type !== "effort") return []
  return efforts(support.values ?? EFFORTS, (effort) => ({
    headers: {},
    body: { reasoning_effort: effort },
  }))
}

// 协议表按 design D2 只保留 fork 会话运行时实际可执行的三个 aisdk 包名
// （SessionRunnerModel.supported 的唯一放行集合）。对 fork provider 目录
// （core/src/plugin/provider/）逐个核对后的处置记录：
//
// 有条目（可执行，下方保留）：
//   @ai-sdk/openai            → openaiResponses（effort → providerOptions 载体）
//   @ai-sdk/anthropic         → anthropicMessages（budget_tokens → thinking 载体）
//   @ai-sdk/openai-compatible → openaiCompatibleChat（effort → body reasoning_effort）
//
// 无条目（provider 插件存在、catalog 可见，但会话运行时对其报 UnsupportedApiError，
// 生成推理档位只会误导 UI，缺省安全不生成）：
//   @ai-sdk/alibaba、@ai-sdk/amazon-bedrock、@ai-sdk/amazon-bedrock/mantle、
//   @ai-sdk/azure、@ai-sdk/cerebras、@ai-sdk/cohere、@ai-sdk/deepinfra、
//   @ai-sdk/gateway、@ai-sdk/github-copilot、@ai-sdk/google、@ai-sdk/google-vertex、
//   @ai-sdk/google-vertex/anthropic、@ai-sdk/groq、@ai-sdk/mistral、@ai-sdk/perplexity、
//   @ai-sdk/togetherai、@ai-sdk/vercel、@ai-sdk/xai
//
// 上游协议表中的 @opencode/ai/providers/* 自有包名 fork 不存在，一律不搬。
const PROTOCOLS: Readonly<Record<string, Protocol>> = {
  "@ai-sdk/openai": openaiResponses,
  "@ai-sdk/anthropic": anthropicMessages,
  "@ai-sdk/openai-compatible": openaiCompatibleChat,
}
