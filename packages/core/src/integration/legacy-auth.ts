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

const parseEntry = (entry: unknown): Credential.Key | undefined => {
  const api = decodeApi(entry)
  if (Option.isNone(api)) return undefined
  return Credential.Key.make({
    type: "key",
    key: api.value.key,
    metadata: api.value.metadata,
  })
}

/** Extracts an API key credential from one entry of the legacy auth store. */
export function parse(data: unknown, providerID: string): Credential.Key | undefined {
  if (!isRecord(data)) return undefined
  return parseEntry(data[providerID])
}

/** Collects every API key entry of the legacy auth store, keyed by provider ID. */
export function parseAll(data: unknown): Record<string, Credential.Key> {
  if (!isRecord(data)) return {}
  return Object.fromEntries(
    Object.entries(data).flatMap(([providerID, entry]) => {
      const key = parseEntry(entry)
      return key ? [[providerID, key] as const] : []
    }),
  )
}

/** Reads the legacy auth store from disk; missing or broken files count as empty. */
export const parseFile = Effect.fn("LegacyAuth.parseFile")(function* (file: string, providerID: string) {
  const fs = yield* FSUtil.Service
  const data = yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => undefined))
  return parse(data, providerID)
})

const load = Effect.fnUntraced(function* (file: string) {
  const content = process.env.OPENNOVEL_AUTH_CONTENT
  if (content) {
    const data = Option.getOrUndefined(decodeJson(content))
    if (data !== undefined) return data
  }
  const fs = yield* FSUtil.Service
  return yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => undefined))
})

/** Resolves a provider key from `OPENNOVEL_AUTH_CONTENT` first, then the auth file. */
export const read = Effect.fn("LegacyAuth.read")(function* (
  providerID: string,
  file = path.join(Global.Path.data, "auth.json"),
) {
  return parse(yield* load(file), providerID)
})

/** Resolves every provider key from `OPENNOVEL_AUTH_CONTENT` first, then the auth file. */
export const readAll = Effect.fn("LegacyAuth.readAll")(function* (
  file = path.join(Global.Path.data, "auth.json"),
) {
  return parseAll(yield* load(file))
})
