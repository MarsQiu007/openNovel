import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  OPENNOVEL_SERVER_PASSWORD: Flag.OPENNOVEL_SERVER_PASSWORD,
  OPENNOVEL_SERVER_USERNAME: Flag.OPENNOVEL_SERVER_USERNAME,
}

afterEach(() => {
  Flag.OPENNOVEL_SERVER_PASSWORD = original.OPENNOVEL_SERVER_PASSWORD
  Flag.OPENNOVEL_SERVER_USERNAME = original.OPENNOVEL_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.OPENNOVEL_SERVER_PASSWORD = undefined
    Flag.OPENNOVEL_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the opennovel username", () => {
    Flag.OPENNOVEL_SERVER_PASSWORD = "secret"
    Flag.OPENNOVEL_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("opennovel:secret").toString("base64")}`,
    })
  })

  test("uses the configured username", () => {
    Flag.OPENNOVEL_SERVER_PASSWORD = "secret"
    Flag.OPENNOVEL_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.OPENNOVEL_SERVER_PASSWORD = "secret"
    Flag.OPENNOVEL_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "opennovel", password: Redacted.make("secret") }, config)).toBe(false)
  })
})
