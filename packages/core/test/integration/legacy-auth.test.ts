import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Credential } from "@opennovel-ai/core/credential"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { FSUtil } from "@opennovel-ai/core/fs-util"
import { LegacyAuth } from "@opennovel-ai/core/integration/legacy-auth"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(FSUtil.node))

const original = process.env.OPENNOVEL_AUTH_CONTENT
const dir = path.join(os.tmpdir(), `opennovel-legacy-auth-${process.pid}`)

beforeAll(async () => {
  await fs.mkdir(dir, { recursive: true })
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

afterEach(() => {
  if (original === undefined) delete process.env.OPENNOVEL_AUTH_CONTENT
  else process.env.OPENNOVEL_AUTH_CONTENT = original
})

const file = (name: string) => path.join(dir, name)
const write = (name: string, data: unknown) => Effect.promise(() => Bun.write(file(name), JSON.stringify(data)))
const writeRaw = (name: string, data: string) => Effect.promise(() => Bun.write(file(name), data))

describe("LegacyAuth.parse", () => {
  test("reads an api key entry", () => {
    expect(LegacyAuth.parse({ zhipu: { type: "api", key: "secret" } }, "zhipu")).toEqual(
      Credential.Key.make({ type: "key", key: "secret" }),
    )
  })

  test("keeps api key metadata", () => {
    expect(
      LegacyAuth.parse({ zhipu: { type: "api", key: "secret", metadata: { baseURL: "https://example.com" } } }, "zhipu"),
    ).toEqual(
      Credential.Key.make({ type: "key", key: "secret", metadata: { baseURL: "https://example.com" } }),
    )
  })

  test("ignores non api entries", () => {
    expect(LegacyAuth.parse({ zhipu: { type: "oauth", access: "a", refresh: "r", expires: 1 } }, "zhipu")).toBeUndefined()
    expect(
      LegacyAuth.parse({ zhipu: { type: "wellknown", key: "TOKEN", token: "abc" } }, "zhipu"),
    ).toBeUndefined()
  })

  test("ignores malformed entries", () => {
    expect(LegacyAuth.parse({ zhipu: { type: "api" } }, "zhipu")).toBeUndefined()
    expect(LegacyAuth.parse({ zhipu: { type: "api", key: "secret", metadata: { n: 1 } } }, "zhipu")).toBeUndefined()
    expect(LegacyAuth.parse({ zhipu: "secret" }, "zhipu")).toBeUndefined()
  })

  test("ignores non object payloads and missing providers", () => {
    expect(LegacyAuth.parse(undefined, "zhipu")).toBeUndefined()
    expect(LegacyAuth.parse(null, "zhipu")).toBeUndefined()
    expect(LegacyAuth.parse("secret", "zhipu")).toBeUndefined()
    expect(LegacyAuth.parse([], "zhipu")).toBeUndefined()
    expect(LegacyAuth.parse({}, "zhipu")).toBeUndefined()
  })
})

describe("LegacyAuth.parseFile", () => {
  it.effect("reads a key from an existing file", () =>
    Effect.gen(function* () {
      yield* write("api.json", { zhipu: { type: "api", key: "secret" } })
      expect(yield* LegacyAuth.parseFile(file("api.json"), "zhipu")).toEqual(
        Credential.Key.make({ type: "key", key: "secret" }),
      )
    }),
  )

  it.effect("treats a missing file as empty", () =>
    Effect.gen(function* () {
      expect(yield* LegacyAuth.parseFile(file("missing.json"), "zhipu")).toBeUndefined()
    }),
  )

  it.effect("treats broken json as empty", () =>
    Effect.gen(function* () {
      yield* writeRaw("broken.json", "{")
      expect(yield* LegacyAuth.parseFile(file("broken.json"), "zhipu")).toBeUndefined()
    }),
  )
})

describe("LegacyAuth.read", () => {
  it.effect("prefers OPENNOVEL_AUTH_CONTENT over the file", () =>
    Effect.gen(function* () {
      yield* write("env.json", { zhipu: { type: "api", key: "from-file" } })
      process.env.OPENNOVEL_AUTH_CONTENT = JSON.stringify({ zhipu: { type: "api", key: "from-env" } })
      expect(yield* LegacyAuth.read("zhipu", file("env.json"))).toEqual(
        Credential.Key.make({ type: "key", key: "from-env" }),
      )
    }),
  )

  it.effect("falls back to the file when OPENNOVEL_AUTH_CONTENT is invalid json", () =>
    Effect.gen(function* () {
      yield* write("fallback.json", { zhipu: { type: "api", key: "from-file" } })
      process.env.OPENNOVEL_AUTH_CONTENT = "{"
      expect(yield* LegacyAuth.read("zhipu", file("fallback.json"))).toEqual(
        Credential.Key.make({ type: "key", key: "from-file" }),
      )
    }),
  )

  it.effect("does not fall back to the file when OPENNOVEL_AUTH_CONTENT has a non api entry", () =>
    Effect.gen(function* () {
      yield* write("non-api.json", { zhipu: { type: "api", key: "from-file" } })
      process.env.OPENNOVEL_AUTH_CONTENT = JSON.stringify({ zhipu: { type: "oauth", access: "a", refresh: "r", expires: 1 } })
      expect(yield* LegacyAuth.read("zhipu", file("non-api.json"))).toBeUndefined()
    }),
  )
})
