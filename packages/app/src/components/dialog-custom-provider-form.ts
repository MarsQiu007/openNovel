import type { ProviderConfig } from "@opennovel-ai/sdk/v2/client"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  detail?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelDetail = {
  context: string
  output: string
  input: string
  costInput: string
  costOutput: string
  family: string
  status: string
  reasoning: boolean
  interleaved: boolean
  temperature: boolean
  toolCall: boolean
  attachment: boolean
}

export const MODEL_STATUS = ["active", "beta", "alpha", "deprecated"] as const

export type ModelRow = {
  row: string
  id: string
  name: string
  detail: ModelDetail
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormMode = "create" | "edit"

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  mode: FormMode
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

// limit/cost 在 ConfigProviderV1 契约里 context+output、input+output 均必填，成对才写出；
// 单独留空表示回落运行时缺省。
const positive = (raw: string) => {
  const value = Number(raw)
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.mode === "create" && input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    const detail = m.detail
    const context = positive(detail.context)
    const output = positive(detail.output)
    const costInput = positive(detail.costInput)
    const costOutput = positive(detail.costOutput)
    const detailError =
      (context === undefined) !== (output === undefined) || (costInput === undefined) !== (costOutput === undefined)
        ? input.t("provider.custom.error.detail.pair")
        : undefined
    return { id: idError, name: nameError, detail: detailError }
  })
  const modelsValid = models.every((m) => !m.id && !m.name && !m.detail)

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  const modelConfig = Object.fromEntries(
    input.form.models.map((m) => {
      const detail = m.detail
      const context = positive(detail.context)
      const output = positive(detail.output)
      const inputLimit = positive(detail.input)
      const costInput = positive(detail.costInput)
      const costOutput = positive(detail.costOutput)
      const config: Record<string, unknown> = { name: m.name.trim() }
      // 校验已保证 context/output 成对出现
      if (context !== undefined) {
        config.limit = {
          context,
          output: output as number,
          ...(inputLimit !== undefined ? { input: inputLimit } : {}),
        }
      }
      if (costInput !== undefined) config.cost = { input: costInput, output: costOutput as number }
      if (detail.reasoning) config.reasoning = true
      if (detail.interleaved) config.interleaved = true
      if (detail.temperature) config.temperature = true
      if (detail.toolCall) config.tool_call = true
      if (detail.attachment) config.attachment = true
      if (detail.status) config.status = detail.status
      if (detail.family.trim()) config.family = detail.family.trim()
      return [m.id.trim(), config]
    }),
  )

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

// 编辑模式预填：按创建时写入的同一形状回读（headers 在 options.headers，env 回显 {env:VAR} 语法）
export function prefillCustomProvider(providerID: string, config: ProviderConfig): Omit<FormState, "err"> {
  const options = config.options as { baseURL?: string; headers?: Record<string, string> } | undefined
  return {
    providerID,
    name: config.name ?? "",
    baseURL: options?.baseURL ?? "",
    apiKey: config.env?.[0] ? `{env:${config.env[0]}}` : "",
    models: Object.entries(config.models ?? {}).map(([id, m]) => ({
      row: nextRow(),
      id,
      name: m.name ?? "",
      err: {},
      detail: {
        context: m.limit?.context?.toString() ?? "",
        output: m.limit?.output?.toString() ?? "",
        input: m.limit?.input?.toString() ?? "",
        costInput: m.cost?.input?.toString() ?? "",
        costOutput: m.cost?.output?.toString() ?? "",
        family: m.family ?? "",
        status: m.status ?? "",
        reasoning: m.reasoning ?? false,
        interleaved: m.interleaved === true,
        temperature: m.temperature ?? false,
        toolCall: m.tool_call ?? false,
        attachment: m.attachment ?? false,
      },
    })),
    headers: Object.entries(options?.headers ?? {}).map(([key, value]) => ({
      row: nextRow(),
      key,
      value,
      err: {},
    })),
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelDetail = (): ModelDetail => ({
  context: "",
  output: "",
  input: "",
  costInput: "",
  costOutput: "",
  family: "",
  status: "",
  reasoning: false,
  interleaved: false,
  temperature: false,
  toolCall: false,
  attachment: false,
})

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", detail: modelDetail(), err: {} })
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
