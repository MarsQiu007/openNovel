import { describe, expect, test } from "bun:test"
import { modelDetail, modelRow, prefillCustomProvider, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ ...modelRow(), row: "m0", id: " model-a ", name: " Model A " }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      mode: "create",
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { ...modelRow(), row: "m0", id: "model-a", name: "Model A" },
          { ...modelRow(), row: "m1", id: "model-a", name: "Model A 2" },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      mode: "create",
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
      detail: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test("edit mode skips the duplicate provider ID check", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [{ ...modelRow(), row: "m0", id: "model-a", name: "Model A" }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      mode: "edit",
      disabledProviders: [],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result?.providerID).toBe("custom-provider")
    expect(result.err.providerID).toBeUndefined()
  })
})

describe("validateCustomProvider model details", () => {
  const baseForm = (detail: ReturnType<typeof modelDetail>) => ({
    providerID: "custom-provider",
    name: "Provider",
    baseURL: "https://api.example.com",
    apiKey: "",
    models: [{ ...modelRow(), row: "m0", id: "model-a", name: "Model A", detail }],
    headers: [{ row: "h0", key: "", value: "", err: {} }],
    err: {},
  })

  test("writes only filled detail keys", () => {
    const result = validateCustomProvider({
      form: baseForm({
        ...modelDetail(),
        context: "131072",
        output: "8192",
        input: "65536",
        costInput: "1.25",
        costOutput: "10",
        family: "gpt-5",
        status: "beta",
        reasoning: true,
        interleaved: true,
        temperature: true,
        toolCall: true,
        attachment: true,
      }),
      t,
      mode: "create",
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "model-a": {
        name: "Model A",
        limit: { context: 131072, output: 8192, input: 65536 },
        cost: { input: 1.25, output: 10 },
        family: "gpt-5",
        status: "beta",
        reasoning: true,
        interleaved: true,
        temperature: true,
        tool_call: true,
        attachment: true,
      },
    })
  })

  test("omits empty details and standalone input limit", () => {
    const result = validateCustomProvider({
      form: baseForm({ ...modelDetail(), input: "65536" }),
      t,
      mode: "create",
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "model-a": { name: "Model A" },
    })
  })

  test("rejects unpaired limit or cost values", () => {
    const result = validateCustomProvider({
      form: baseForm({ ...modelDetail(), context: "131072", costInput: "1.25" }),
      t,
      mode: "create",
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0].detail).toBe("provider.custom.error.detail.pair")
  })
})

describe("prefillCustomProvider", () => {
  test("round-trips create output back into form state", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Custom Provider",
        baseURL: "https://api.example.com",
        apiKey: "{env:CUSTOM_PROVIDER_KEY}",
        models: [
          {
            ...modelRow(),
            row: "m0",
            id: "model-a",
            name: "Model A",
            detail: {
              ...modelDetail(),
              context: "131072",
              output: "8192",
              reasoning: true,
              status: "beta",
            },
          },
        ],
        headers: [{ row: "h0", key: "X-Test", value: "enabled", err: {} }],
        err: {},
      },
      t,
      mode: "create",
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    if (!result.result) throw new Error("expected valid result")

    const prefilled = prefillCustomProvider(result.result.providerID, result.result.config)

    expect(prefilled.providerID).toBe("custom-provider")
    expect(prefilled.name).toBe("Custom Provider")
    expect(prefilled.baseURL).toBe("https://api.example.com")
    expect(prefilled.apiKey).toBe("{env:CUSTOM_PROVIDER_KEY}")
    expect(prefilled.headers).toEqual([{ row: expect.any(String), key: "X-Test", value: "enabled", err: {} }])
    expect(prefilled.models).toHaveLength(1)
    expect(prefilled.models[0].id).toBe("model-a")
    expect(prefilled.models[0].detail.context).toBe("131072")
    expect(prefilled.models[0].detail.output).toBe("8192")
    expect(prefilled.models[0].detail.reasoning).toBe(true)
    expect(prefilled.models[0].detail.status).toBe("beta")
  })
})
