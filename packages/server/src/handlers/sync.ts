import { Credential } from "@opennovel-ai/core/credential"
import { Global } from "@opennovel-ai/core/global"
import { Integration } from "@opennovel-ai/core/integration"
import { Sync } from "@opennovel-ai/core/sync"
import { closeDb, getDbPath } from "@opennovel-ai/novel-store"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SyncErrorResponse } from "@opennovel-ai/protocol/groups/sync"
import { Api } from "../api"

// WebDAV 密码以固定 integrationID 存入全局凭据库；Integration.list 只投影已注册
// 集成，该孤儿 ID 不会出现在集成页
const WEBDAV_INTEGRATION_ID = Schema.decodeUnknownSync(Integration.ID)("webdav")

/** 把 SyncError 翻译成协议错误，其余异常原样抛出（500） */
const mapError = (error: unknown) => {
  if (error instanceof Sync.SyncError) {
    return new SyncErrorResponse({ name: "SyncErrorResponse", data: { message: error.message, code: error.code } })
  }
  throw error
}

export const SyncHandler = HttpApiBuilder.group(Api, "server.sync", (handlers) => {
  // 库级同步：依赖全局 config/state 目录，不挂在单个项目 Location 上
  const deps = Effect.gen(function* () {
    const global = yield* Global.Service
    const credentials = yield* Credential.Service
    const result: Sync.SyncDeps = {
      configDir: global.config,
      stateDir: global.state,
      getPassword: async () => {
        const items = await Effect.runPromise(credentials.list(WEBDAV_INTEGRATION_ID))
        const first = items[0]
        return first?.value.type === "key" ? first.value.key : undefined
      },
      setPassword: (password) =>
        Effect.runPromise(
          password === undefined
            ? Effect.gen(function* () {
                const items = yield* credentials.list(WEBDAV_INTEGRATION_ID)
                yield* Effect.forEach(items, (item) => credentials.remove(item.id))
              })
            : credentials
                .create({
                  integrationID: WEBDAV_INTEGRATION_ID,
                  label: "webdav",
                  value: Credential.Key.make({ type: "key", key: password }),
                })
                .pipe(Effect.asVoid),
        ),
      closeDatabase: (directory) => closeDb(directory),
      dbFileFor: getDbPath,
    }
    return result
  })

  /** 解析依赖后执行同步操作，SyncError 映射为协议错误 */
  const run = <A>(fn: (deps: Sync.SyncDeps) => Promise<A>) =>
    Effect.gen(function* () {
      const sync = yield* deps
      return yield* Effect.tryPromise({ try: () => fn(sync), catch: mapError })
    })

  return handlers
    .handle(
      "sync.status",
      Effect.fn(function* () {
        return yield* run((sync) => Sync.getStatus(sync))
      }),
    )
    .handle(
      "sync.connection.test",
      Effect.fn(function* (ctx) {
        return yield* Effect.tryPromise({
          try: () => Sync.testConnection(ctx.payload),
          catch: (error) => error,
        }).pipe(
          Effect.map(() => ({ ok: true as const })),
          Effect.catch((error) =>
            Effect.succeed({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
          ),
        )
      }),
    )
    .handle(
      "sync.connection.save",
      Effect.fn(function* (ctx) {
        yield* run((sync) => Sync.saveConnection(sync, ctx.payload))
        return yield* run((sync) => Sync.getStatus(sync))
      }),
    )
    .handle(
      "sync.connection.remove",
      Effect.fn(function* () {
        yield* run((sync) => Sync.disconnect(sync))
        return yield* run((sync) => Sync.getStatus(sync))
      }),
    )
    .handle(
      "sync.root.set",
      Effect.fn(function* (ctx) {
        return yield* run((sync) => Sync.setRootDir(sync, ctx.payload.rootDir))
      }),
    )
    .handle(
      "sync.run",
      Effect.fn(function* () {
        return yield* run((sync) => Sync.syncAll(sync))
      }),
    )
    .handle(
      "sync.resolve",
      Effect.fn(function* (ctx) {
        return yield* run((sync) => Sync.resolve(sync, ctx.payload))
      }),
    )
})
