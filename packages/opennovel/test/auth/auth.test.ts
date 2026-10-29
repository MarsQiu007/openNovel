import { describe, expect } from "bun:test"
import { Credential } from "@opennovel-ai/core/credential"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Integration } from "@opennovel-ai/core/integration"
import { Cause, Effect, Exit, Layer } from "effect"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))
const store = testEffect(LayerNode.compile(LayerNode.group([Auth.node, Credential.node])))
const failing = testEffect(
  LayerNode.compile(Auth.node, [
    [
      Credential.node,
      Layer.mock(Credential.Service)({
        create: () => Effect.die(new Error("credential store unavailable")),
        list: () => Effect.die(new Error("credential store unavailable")),
      }),
    ],
  ]),
)

describe("Auth", () => {
  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeDefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "old",
      })
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("example.com"))
      expect(keys).toEqual(["https://example.com"])
      const entry = data["https://example.com"]!
      expect(entry.type).toBe("wellknown")
      if (entry.type === "wellknown") expect(entry.token).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      yield* auth.remove("https://example.com/")
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeUndefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["anthropic"]).toBeDefined()
      yield* auth.remove("anthropic")
      const after = yield* auth.all()
      expect(after["anthropic"]).toBeUndefined()
    }),
  )
})

describe("Auth credential store sync", () => {
  store.instance("set writes api keys to both stores", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-api")
      yield* auth.set("auth-test-api", {
        type: "api",
        key: "secret",
        metadata: { baseURL: "https://example.com" },
      })

      expect(yield* credentials.list(providerID)).toEqual([
        expect.objectContaining({
          integrationID: providerID,
          label: "default",
          value: Credential.Key.make({ type: "key", key: "secret", metadata: { baseURL: "https://example.com" } }),
        }),
      ])
    }),
  )

  store.instance("set normalizes trailing slashes in the credential store", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-slash")
      yield* auth.set("auth-test-slash/", { type: "api", key: "secret" })

      expect(yield* credentials.list(providerID)).toHaveLength(1)
      expect(yield* credentials.list(Integration.ID.make("auth-test-slash/"))).toEqual([])
    }),
  )

  store.instance("repeated saves replace the stored api key", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-replace")
      yield* auth.set("auth-test-replace", { type: "api", key: "old" })
      yield* auth.set("auth-test-replace", { type: "api", key: "new" })

      expect(yield* credentials.list(providerID)).toEqual([
        expect.objectContaining({ value: Credential.Key.make({ type: "key", key: "new" }) }),
      ])
    }),
  )

  store.instance("saving oauth leaves the stored api key intact", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-oauth")
      yield* auth.set("auth-test-oauth", { type: "api", key: "secret" })
      yield* auth.set("auth-test-oauth", { type: "oauth", refresh: "r", access: "a", expires: 1 })

      expect(yield* credentials.list(providerID)).toEqual([
        expect.objectContaining({ value: Credential.Key.make({ type: "key", key: "secret" }) }),
      ])
    }),
  )

  store.instance("remove clears both stores for api entries", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-remove-api")
      yield* auth.set("auth-test-remove-api", { type: "api", key: "secret" })
      yield* auth.remove("auth-test-remove-api")

      expect(yield* credentials.list(providerID)).toEqual([])
      expect((yield* auth.all())["auth-test-remove-api"]).toBeUndefined()
    }),
  )

  store.instance("remove clears stored credentials when logging out oauth entries", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-logout")
      yield* credentials.create({
        integrationID: providerID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })
      yield* auth.set("auth-test-logout", { type: "oauth", refresh: "r", access: "a", expires: 1 })
      yield* auth.remove("auth-test-logout")

      expect(yield* credentials.list(providerID)).toEqual([])
    }),
  )

  store.instance("remove leaves credentials untouched for unknown providers", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const providerID = Integration.ID.make("auth-test-unknown")
      yield* credentials.create({
        integrationID: providerID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })
      yield* auth.remove("auth-test-unknown")

      expect(yield* credentials.list(providerID)).toHaveLength(1)
    }),
  )

  failing.instance("set maps credential failures to AuthError", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const exit = yield* auth.set("auth-test-fail-set", { type: "api", key: "secret" }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Auth.AuthError)
    }),
  )

  failing.instance("remove maps credential failures to AuthError", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("auth-test-fail-remove", { type: "oauth", refresh: "r", access: "a", expires: 1 })
      const exit = yield* auth.remove("auth-test-fail-remove").pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Auth.AuthError)
    }),
  )
})
