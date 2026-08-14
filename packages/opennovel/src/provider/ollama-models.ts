import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { httpClient } from "@opennovel-ai/core/effect/app-node-platform"
import { ProviderV2 } from "@opennovel-ai/core/provider"
import { ModelV2 } from "@opennovel-ai/core/model"
import { Provider as ProviderNs } from "./provider"

/**
 * Ollama 本地模型自动发现 service
 *
 * 用户在 desktop UI 选 "Ollama (Local)" 后，server 端 Provider.list() 流程
 * 通过本 service 调 `${baseURL origin}/api/tags` 拉取本地 ollama 已下载的模型列表，
 * merge 进 `provider[ollama].models` dict。失败/timeout/解析错误一律降级返回
 * `{}`，不阻塞 list() 主流程（与 gitlab CustomDiscoverModels 模式对齐）。
 *
 * 路径规范：baseURL 形如 `http://localhost:11434/v1`，origin 通过
 * `replace(/\/v1\/?$/, "")` 得到 `http://localhost:11434`，拼接 `/api/tags`。
 */

/** Ollama `/api/tags` 响应 schema —— 只关心 name 与可选 size/details。 */
const OllamaTagsResponse = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size: Schema.optional(Schema.Finite),
      // details shape 在 ollama 0.x 多次变动（family / families / parameter_size / quant 等），
      // 用 Schema.Unknown 保持宽松，再用自定义提取层选 family 字段。
      details: Schema.optional(Schema.Unknown),
    }),
  ),
})

export interface Interface {
  /** 拉取 baseURL 对应 ollama 实例的本地模型列表。失败/超时/解析错误 → 返回空 record。 */
  readonly list: (baseURL: string) => Effect.Effect<Record<string, ProviderNs.Model>>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/OllamaModels") {}

const extractFamily = (raw: unknown): string | undefined => {
  if (!raw || typeof raw !== "object") return undefined
  const d = raw as Record<string, unknown>
  const f = d["family"]
  if (typeof f === "string") return f
  const families = d["families"]
  if (Array.isArray(families) && families.length > 0 && typeof families[0] === "string") {
    return families[0]
  }
  return undefined
}

const toModel = (name: string, rawDetails: unknown): ProviderNs.Model =>
  ({
    id: ModelV2.ID.make(name),
    providerID: ProviderV2.ID.make("ollama"),
    api: { id: name, url: "", npm: "@ai-sdk/openai-compatible" },
    name,
    family: extractFamily(rawDetails),
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 8192, output: 4096 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }) as ProviderNs.Model

const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const list: Interface["list"] = Effect.fn("OllamaModels.list")(function* (baseURL) {
      const origin = baseURL.replace(/\/v1\/?$/, "")
      const url = `${origin}/api/tags`
      const result = yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(OllamaTagsResponse)(body).pipe(
            Effect.map((parsed) =>
              Object.fromEntries(
                parsed.models.map((m) => [m.name, toModel(m.name, m.details)] as const),
              ) as Record<string, ProviderNs.Model>,
            ),
          ),
        ),
        Effect.timeout(Duration.seconds(5)),
        Effect.orElseSucceed(() => ({}) as Record<string, ProviderNs.Model>),
      )
      return result
    })

    return Service.of({ list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient] })

export * as OllamaModels from "./ollama-models"
