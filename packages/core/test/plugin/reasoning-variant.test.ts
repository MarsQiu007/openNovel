import { describe, expect, it } from "bun:test"
import type { ModelV2Info } from "@opennovel-ai/sdk/v2/types"
import { PROVIDER_OPTIONS_KEY, ReasoningVariant } from "@opennovel-ai/core/plugin/reasoning-variant"

const model = (pkg: string, output = 128_000): ModelV2Info => ({
  id: "test-model",
  providerID: "test-provider",
  name: "Test model",
  api: { id: "test-model", type: "aisdk", package: pkg },
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  request: { headers: {}, body: {} },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 100, output },
})

describe("ReasoningVariant.supports", () => {
  it("maps models.dev reasoning_options to standard supports", () => {
    expect(
      ReasoningVariant.supports([
        { type: "effort", values: ["none", "high", null, "null"] },
        { type: "toggle" },
        { type: "budget_tokens", min: 1024, max: 16_384 },
      ]),
    ).toEqual([
      { type: "effort", values: ["none", "high"] },
      { type: "toggle" },
      { type: "budget_tokens", min: 1024, max: 16_384 },
    ])
  })

  it("returns empty when metadata declares no reasoning options", () => {
    expect(ReasoningVariant.supports(undefined)).toEqual([])
    expect(ReasoningVariant.supports([])).toEqual([])
  })
})

describe("ReasoningVariant.resolve", () => {
  it("spells openai-compatible efforts as raw body reasoning_effort (GLM 5.2 对拍)", () => {
    const variants = ReasoningVariant.resolve(model("@ai-sdk/openai-compatible"), [
      { type: "effort", values: ["high", "max"] },
    ])
    expect(variants).toEqual([
      { id: "high", headers: {}, body: { reasoning_effort: "high" } },
      { id: "max", headers: {}, body: { reasoning_effort: "max" } },
    ])
  })

  it("passes deepseek-style effort whitelists through to body overlays", () => {
    const variants = ReasoningVariant.resolve(model("@ai-sdk/openai-compatible"), [
      { type: "effort", values: ["none", "low", "medium", "high", "max"] },
    ])
    expect(variants.map((item) => item.id)).toEqual(["none", "low", "medium", "high", "max"])
  })

  it("does not generate variants for openai-compatible toggles (no generic wire key)", () => {
    expect(ReasoningVariant.resolve(model("@ai-sdk/openai-compatible"), [{ type: "toggle" }])).toEqual([])
  })

  it("carries openai efforts into providerOptions, excluding max", () => {
    const variants = ReasoningVariant.resolve(model("@ai-sdk/openai"), [
      { type: "effort", values: ["low", "max"] },
    ])
    expect(variants).toEqual([
      {
        id: "low",
        headers: {},
        body: {
          [PROVIDER_OPTIONS_KEY]: {
            openai: {
              reasoningEffort: "low",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          },
        },
      },
    ])
  })

  it("generates anthropic thinking budgets within the Anthropic output ceiling", () => {
    const variants = ReasoningVariant.resolve(model("@ai-sdk/anthropic"), [
      { type: "budget_tokens", min: 1024, max: 16_384 },
    ])
    expect(variants).toEqual([
      {
        id: "high",
        headers: {},
        body: { [PROVIDER_OPTIONS_KEY]: { anthropic: { thinking: { type: "enabled", budgetTokens: 8192 } } } },
      },
      {
        id: "max",
        headers: {},
        body: {
          [PROVIDER_OPTIONS_KEY]: { anthropic: { thinking: { type: "enabled", budgetTokens: 16_384 } } },
        },
      },
    ])
  })

  it("skips anthropic efforts and toggles the protocol cannot express", () => {
    expect(ReasoningVariant.resolve(model("@ai-sdk/anthropic"), [{ type: "effort", values: ["high"] }])).toEqual([])
    expect(ReasoningVariant.resolve(model("@ai-sdk/anthropic"), [{ type: "toggle" }])).toEqual([])
  })

  it("refuses unknown or non-executable provider packages", () => {
    expect(ReasoningVariant.resolve(model("@ai-sdk/groq"), [{ type: "effort", values: ["high"] }])).toEqual([])
    const native: ModelV2Info = {
      ...model("@ai-sdk/openai"),
      api: { id: "test-model", type: "native", settings: {} },
    }
    expect(ReasoningVariant.resolve(native, [{ type: "effort", values: ["high"] }])).toEqual([])
  })
})
