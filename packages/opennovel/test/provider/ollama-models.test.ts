import { describe, expect } from "bun:test"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { httpClient } from "@opennovel-ai/core/effect/app-node-platform"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { OllamaModels } from "../../src/provider/ollama-models"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([httpClient, OllamaModels.node]), [
    [httpClient, FetchHttpClient.layer as Layer.Layer<HttpClient.HttpClient>],
  ]),
)

/**
 * 启一个 in-memory mock ollama server 在 :0 端口，可指定 `/api/tags` 的响应。
 * 返回 baseURL（已包含 `/v1` 后缀以贴近真实用法）。
 */
const withMockOllama = <A, E, R>(
  responder: (req: Request) => Response | Promise<Response>,
  fn: (baseURL: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch: responder })),
    (server) => {
      const baseURL = `${server.url.toString().replace(/\/$/, "")}/v1`
      return fn(baseURL)
    },
    (server) => Effect.sync(() => server.stop(true)),
  )

/** 断言与查询封装：把 `svc.list(baseURL)` + expect 打包成一个 Effect。 */
const listAndCheck = (
  baseURL: string,
  check: (models: Record<string, unknown>) => void,
): Effect.Effect<void, never, OllamaModels.Service> =>
  Effect.gen(function* () {
    const svc = yield* OllamaModels.Service
    const models = (yield* svc.list(baseURL)) as unknown as Record<string, unknown>
    check(models)
  })

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("provider.ollama-models", () => {
  it.effect("list returns parsed models keyed by name", () =>
    Effect.gen(function* () {
      yield* withMockOllama(
        () =>
          okJson({
            models: [
              { name: "llama3.1:8b", size: 4.7e9, details: { family: "llama", parameter_size: "8B" } },
              { name: "qwen2.5:7b", size: 4.4e9, details: { family: "qwen2", parameter_size: "7B" } },
            ],
          }),
        (baseURL) =>
          listAndCheck(baseURL, (models) => {
            expect(Object.keys(models).sort()).toEqual(["llama3.1:8b", "qwen2.5:7b"])
            const llama = models["llama3.1:8b"] as { name: string; family?: string; capabilities: { toolcall: boolean; input: { text: boolean } } }
            expect(llama).toBeDefined()
            expect(llama.name).toBe("llama3.1:8b")
            expect(llama.family).toBe("llama")
            expect(llama.capabilities.toolcall).toBe(true)
            expect(llama.capabilities.input.text).toBe(true)
          }),
      )
    }),
  )

  it.effect("list strips /v1 suffix before calling /api/tags", () =>
    Effect.gen(function* () {
      let requestedPath: string | undefined
      yield* withMockOllama(
        (req) => {
          requestedPath = new URL(req.url).pathname
          return okJson({ models: [] })
        },
        (baseURL) => listAndCheck(baseURL, () => undefined),
      )
      expect(requestedPath).toBe("/api/tags")
    }),
  )

  it.effect("list returns {} on HTTP 5xx (graceful failure)", () =>
    Effect.gen(function* () {
      yield* withMockOllama(
        () => new Response("boom", { status: 500 }),
        (baseURL) => listAndCheck(baseURL, (models) => expect(models).toEqual({})),
      )
    }),
  )

  it.effect("list returns {} on malformed JSON body", () =>
    Effect.gen(function* () {
      yield* withMockOllama(
        () => new Response("not json {", { status: 200, headers: { "content-type": "application/json" } }),
        (baseURL) => listAndCheck(baseURL, (models) => expect(models).toEqual({})),
      )
    }),
  )

  it.effect("list returns {} when models key is missing", () =>
    Effect.gen(function* () {
      yield* withMockOllama(
        () => okJson({ unrelated: "shape" }),
        (baseURL) => listAndCheck(baseURL, (models) => expect(models).toEqual({})),
      )
    }),
  )

  it.effect("list returns {} on connection refused (no ollama running)", () =>
    Effect.gen(function* () {
      // 不启 server，连一个空闲端口 → ECONNREFUSED，被 5s timeout / fetch error 吃掉
      const svc = yield* OllamaModels.Service
      const models = yield* svc.list("http://127.0.0.1:1/v1")
      expect(models).toEqual({})
    }),
  )

  it.effect("list tolerates models with missing details", () =>
    Effect.gen(function* () {
      yield* withMockOllama(
        () => okJson({ models: [{ name: "phi3:mini" }, { name: "gemma:2b", size: 1.6e9 }] }),
        (baseURL) =>
          listAndCheck(baseURL, (models) => {
            expect(Object.keys(models).sort()).toEqual(["gemma:2b", "phi3:mini"])
            const phi = models["phi3:mini"] as { name: string; family?: string }
            const gemma = models["gemma:2b"] as { name: string }
            expect(phi.family).toBeUndefined()
            expect(gemma.name).toBe("gemma:2b")
          }),
      )
    }),
  )
})
