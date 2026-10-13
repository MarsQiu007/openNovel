export * as ServerAuth from "./auth"

import { timingSafeEqual } from "crypto"
import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@opennovel/ServerAuthConfig") {
  static configLayer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get layer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        return Config.of(
          yield* EffectConfig.all({
            password: EffectConfig.string("OPENNOVEL_SERVER_PASSWORD").pipe(EffectConfig.option),
            username: EffectConfig.string("OPENNOVEL_SERVER_USERNAME").pipe(EffectConfig.withDefault("opennovel")),
          }),
        )
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

function sameSecret(input: string, expected: string) {
  const a = Buffer.from(input)
  const b = Buffer.from(expected)
  // timingSafeEqual 要求等长，长度差异本身不泄露密码内容，先短路返回
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  if (!Option.isSome(config.password)) return false
  return credentials.username === config.username && sameSecret(Redacted.value(credentials.password), config.password.value)
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? process.env.OPENNOVEL_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? process.env.OPENNOVEL_SERVER_USERNAME ?? "opennovel"}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
