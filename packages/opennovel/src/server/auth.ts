export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { timingSafeEqual } from "node:crypto"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export class Config extends ConfigService.Service<Config>()("@opennovel/ServerAuthConfig", {
  password: EffectConfig.string("OPENNOVEL_SERVER_PASSWORD").pipe(EffectConfig.option),
  username: EffectConfig.string("OPENNOVEL_SERVER_USERNAME").pipe(EffectConfig.withDefault("opennovel")),
}) {}

export type Info = Context.Service.Shape<typeof Config>

// 空串密码一律视为"未启用"，required 与 authorized 共用同一判定，避免两端口径分叉。
function configuredPassword(config: Info) {
  if (!Option.isSome(config.password)) return undefined
  if (config.password.value === "") return undefined
  return config.password.value
}

function sameSecret(input: string, expected: string) {
  const a = Buffer.from(input)
  const b = Buffer.from(expected)
  // timingSafeEqual 要求等长，长度差异本身不泄露密码内容，先短路返回
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function required(config: Info) {
  return configuredPassword(config) !== undefined
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  const expected = configuredPassword(config)
  if (expected === undefined) return false
  return credentials.username === config.username && sameSecret(Redacted.value(credentials.password), expected)
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.OPENNOVEL_SERVER_PASSWORD
  if (!password) return undefined

  const username = credentials?.username ?? Flag.OPENNOVEL_SERVER_USERNAME ?? "opennovel"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
