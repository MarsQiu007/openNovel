/**
 * 技法库管理 HTTP handler。
 *
 * 数据访问来自 novel-store；错误只区分未找到与写入/参数失败，请求体校验由协议 schema 完成。
 */
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Location } from "@opennovel-ai/core/location"
import { Api } from "../api"
import {
  createTechnique,
  deleteTechnique,
  getTechnique,
  listTechniques,
  readTechniqueInjection,
  updateTechnique,
  writeTechniqueInjection,
} from "@opennovel-ai/novel-store"
import { TechniqueNotFoundError, TechniqueValidationError } from "@opennovel-ai/protocol/groups/technique"

function techniqueNotFound(techniqueId: string): TechniqueNotFoundError {
  return new TechniqueNotFoundError({
    name: "TechniqueNotFoundError",
    data: { message: `技法不存在: ${techniqueId}`, techniqueId },
  })
}

export function listTechniquesForDirectory(directory: string) {
  return Effect.promise(() => listTechniques(directory))
}

export function createTechniqueForDirectory(
  directory: string,
  input: Parameters<typeof createTechnique>[0],
) {
  return Effect.promise(() => createTechnique(input, directory))
}

export function getTechniqueForDirectory(techniqueId: string, directory: string) {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => getTechnique(techniqueId, directory))
    if (!result) return yield* Effect.fail(techniqueNotFound(techniqueId))
    return result
  })
}

export function updateTechniqueForDirectory(
  techniqueId: string,
  directory: string,
  input: Parameters<typeof updateTechnique>[1],
) {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => updateTechnique(techniqueId, input, directory))
    if (!result) return yield* Effect.fail(techniqueNotFound(techniqueId))
    return result
  })
}

export function deleteTechniqueForDirectory(techniqueId: string, directory: string) {
  return Effect.gen(function* () {
    const deleted = yield* Effect.promise(() => deleteTechnique(techniqueId, directory))
    if (!deleted) return yield* Effect.fail(techniqueNotFound(techniqueId))
    return { deleted: true }
  })
}

export function readTechniqueInjectionForDirectory(directory: string) {
  return Effect.sync(() => ({ enabled: readTechniqueInjection(directory) }))
}

export function writeTechniqueInjectionForDirectory(directory: string, enabled: boolean) {
  return Effect.gen(function* () {
    const result = yield* Effect.sync(() => writeTechniqueInjection(directory, enabled))
    if (!result) {
      return yield* Effect.fail(
        new TechniqueValidationError({
          name: "TechniqueValidationError",
          data: { message: "技法注入开关写入失败，请检查 .novel/config.json" },
        }),
      )
    }
    return result
  })
}

export const TechniqueHandler = HttpApiBuilder.group(Api, "server.technique", (handlers) =>
  Effect.succeed(
    handlers
      .handle("technique.list", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listTechniquesForDirectory(location.directory ?? process.cwd())
        }),
      )
      .handle("technique.create", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createTechniqueForDirectory(location.directory ?? process.cwd(), ctx.payload)
        }),
      )
      .handle("technique.config", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* readTechniqueInjectionForDirectory(location.directory ?? process.cwd())
        }),
      )
      .handle("technique.set-config", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* writeTechniqueInjectionForDirectory(location.directory ?? process.cwd(), ctx.payload.enabled)
        }),
      )
      .handle("technique.detail", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getTechniqueForDirectory(ctx.params.techniqueID, location.directory ?? process.cwd())
        }),
      )
      .handle("technique.update", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateTechniqueForDirectory(
            ctx.params.techniqueID,
            location.directory ?? process.cwd(),
            ctx.payload,
          )
        }),
      )
      .handle("technique.delete", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteTechniqueForDirectory(ctx.params.techniqueID, location.directory ?? process.cwd())
        }),
      ),
  ),
)