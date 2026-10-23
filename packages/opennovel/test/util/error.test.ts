import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { NamedError } from "@opennovel-ai/core/util/error"

const AuthError = NamedError.create("ProviderAuthError", { providerID: Schema.String, message: Schema.String })
const OutputLengthError = NamedError.create("MessageOutputLengthError", {})

describe("util.error", () => {
  test("schema-backed named errors are real NamedError instances", () => {
    const error = new AuthError({ providerID: "anthropic", message: "boom" })

    expect(error).toBeInstanceOf(NamedError)
    expect(error.toObject()).toEqual({ name: "ProviderAuthError", data: { providerID: "anthropic", message: "boom" } })
  })

  test("named errors without fields serialize data", () => {
    expect(new OutputLengthError({}).toObject()).toEqual({ name: "MessageOutputLengthError", data: {} })
  })
})
