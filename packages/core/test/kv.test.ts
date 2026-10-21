import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { KV } from "@opennovel-ai/core/kv"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(KV.node))

describe("KV", () => {
  it.effect("get returns undefined for missing keys and roundtrips json values", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      expect(yield* kv.get("missing")).toBeUndefined()

      const value = { notificationID: "job.background/abc", attempts: 2, tags: ["subagent"] }
      yield* kv.set("job.background/abc", value)
      expect(yield* kv.get("job.background/abc")).toEqual(value)
    }),
  )

  it.effect("set upserts overwriting the previous value", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      yield* kv.set("key", { state: "running" })
      yield* kv.set("key", { state: "completed" })
      expect(yield* kv.get("key")).toEqual({ state: "completed" })
    }),
  )

  it.effect("remove deletes the key", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      yield* kv.set("key", { gone: true })
      yield* kv.remove("key")
      expect(yield* kv.get("key")).toBeUndefined()
    }),
  )

  it.effect("scan filters by prefix including the prefix boundary", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      yield* kv.set("job.background/a", { a: 1 })
      yield* kv.set("job.background/b", { b: 2 })
      yield* kv.set("job.background2/x", { x: 3 })
      yield* kv.set("other/y", { y: 4 })

      const result = yield* kv.scan({ prefix: "job.background/" })
      expect(result.next).toBeUndefined()
      expect(result.entries.map((entry) => entry.key)).toEqual(["job.background/a", "job.background/b"])
    }),
  )

  it.effect("scan paginates with next and resumes after without overlap", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      for (const key of ["p/a", "p/b", "p/c"]) yield* kv.set(key, { key })

      const first = yield* kv.scan({ prefix: "p/", limit: 2 })
      expect(first.entries.map((entry) => entry.key)).toEqual(["p/a", "p/b"])
      expect(first.next).toBe("p/b")

      const rest = yield* kv.scan({ prefix: "p/", after: first.next! })
      expect(rest.next).toBeUndefined()
      expect(rest.entries.map((entry) => entry.key)).toEqual(["p/c"])
    }),
  )
})
