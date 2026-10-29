import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Semaphore, Context } from "effect"
import { NonNegativeInt } from "@opennovel-ai/core/schema"
import { Global } from "@opennovel-ai/core/global"
import { Credential } from "@opennovel-ai/core/credential"
import { Integration } from "@opennovel-ai/core/integration"
import { FSUtil } from "@opennovel-ai/core/fs-util"

export const OAUTH_DUMMY_KEY = "opennovel-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const credentials = yield* Credential.Service
    const decode = Schema.decodeUnknownOption(Info)
    // set/remove 都是「读全量 → 改 → 写全量」：并发登录/登出会互相覆盖，这里用进程内信号量串行化
    const writeLock = yield* Semaphore.make(1)

    // 凭据库操作以 defect 失败；任何失败都要让调用方看到，而不是静默留下两库分裂。
    const sync = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.catchCause((cause) => Effect.fail(new AuthError({ message: "Failed to sync credential store", cause }))),
      )

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENNOVEL_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENNOVEL_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")((key: string, info: Info) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          const norm = key.replace(/\/+$/, "")
          const data = yield* all()
          if (norm !== key) delete data[key]
          delete data[norm + "/"]
          yield* fsys.writeJson(file, { ...data, [norm]: info }, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
          if (info.type !== "api") return
          yield* sync(
            credentials.create({
              integrationID: Integration.ID.make(norm),
              value: Credential.Key.make({ type: "key", key: info.key, metadata: info.metadata }),
            }),
          )
        }),
      ),
    )

    const remove = Effect.fn("Auth.remove")((key: string) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          const norm = key.replace(/\/+$/, "")
          const data = yield* all()
          const removed = data[norm] !== undefined || data[key] !== undefined
          delete data[key]
          delete data[norm]
          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
          if (!removed) return
          // 登出必须清空该 provider 的凭据库，否则「凭据库优先」会让已移除的 key 复活。
          const saved = yield* sync(credentials.list(Integration.ID.make(norm)))
          yield* sync(Effect.forEach(saved, (credential) => credentials.remove(credential.id), { discard: true }))
        }),
      ),
    )

    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Credential.node] })

export * as Auth from "."
