export * as LegacyAuth from "./legacy-auth"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { Credential } from "../credential"
import { FSUtil } from "../fs-util"
import { Global } from "../global"

const Api = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const decodeApi = Schema.decodeUnknownOption(Api)
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Extracts an API key credential from one entry of the legacy auth store. */
export function parse(data: unknown, providerID: string): Credential.Key | undefined {
  if (!isRecord(data)) return undefined
  const api = decodeApi(data[providerID])
  if (Option.isNone(api)) return undefined
  return Credential.Key.make({
    type: "key",
    key: api.value.key,
    metadata: api.value.metadata,
  })
}

/** Reads the legacy auth store from disk; missing or broken files count as empty. */
export const parseFile = Effect.fn("LegacyAuth.parseFile")(function* (file: string, providerID: string) {
  const fs = yield* FSUtil.Service
  const data = yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => undefined))
  return parse(data, providerID)
})

/** Resolves a provider key from `OPENNOVEL_AUTH_CONTENT` first, then the auth file. */
export const read = Effect.fn("LegacyAuth.read")(function* (
  providerID: string,
  file = path.join(Global.Path.data, "auth.json"),
) {
  const content = process.env.OPENNOVEL_AUTH_CONTENT
  if (content) {
    const data = Option.getOrUndefined(decodeJson(content))
    if (data !== undefined) return parse(data, providerID)
  }
  return yield* parseFile(file, providerID)
})
