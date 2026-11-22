/**
 * 技法库管理 HTTP handler。
 *
 * 数据访问来自 novel-store；错误只区分未找到与写入/参数失败，请求体校验由协议 schema 完成。
 * 技法已收敛为当前书籍库单源：所有列表、详情、创建、更新与删除只访问本书库。
 */
import { Effect, Result, Schema } from "effect"
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
import { Technique, type CreateTechniqueInput } from "@opennovel-ai/schema/technique"
import { TechniqueNotFoundError, TechniqueValidationError } from "@opennovel-ai/protocol/groups/technique"

type TechniqueDetailResult = NonNullable<Awaited<ReturnType<typeof getTechnique>>>

function techniqueNotFound(techniqueId: string): TechniqueNotFoundError {
  return new TechniqueNotFoundError({
    name: "TechniqueNotFoundError",
    data: { message: `技法不存在: ${techniqueId}`, techniqueId },
  })
}

/** 读取当前书籍库中的技法详情。 */
async function locateTechnique(techniqueId: string, directory: string): Promise<TechniqueDetailResult | null> {
  return getTechnique(techniqueId, directory)
}

export function listTechniquesForDirectory(directory: string) {
  return Effect.gen(function* () {
    const items = yield* Effect.promise(() => listTechniques(directory))
    // 行级容错：单行历史脏数据不满足协议契约时跳过（WARN 含 id 与原因首行），不拖垮整个列表
    const outcomes = items.map((item) => {
      const result = Schema.decodeUnknownResult(Technique)(item)
      return Result.isSuccess(result)
        ? { ok: true as const, value: result.success }
        : { ok: false as const, id: item.id, reason: String(result.failure).split("\n")[0] }
    })
    for (const bad of outcomes.filter((outcome) => !outcome.ok)) {
      yield* Effect.logWarning(`technique.list 跳过不合协议契约的技法行: id=${bad.id} 原因=${bad.reason}`)
    }
    return outcomes.flatMap((outcome) => (outcome.ok ? [outcome.value] : []))
  })
}

export function createTechniqueForDirectory(directory: string, input: CreateTechniqueInput) {
  return Effect.promise(() => createTechnique(input, directory))
}

export function getTechniqueForDirectory(techniqueId: string, directory: string) {
  return Effect.gen(function* () {
    const detail = yield* Effect.promise(() => locateTechnique(techniqueId, directory))
    if (!detail) return yield* Effect.fail(techniqueNotFound(techniqueId))
    return detail
  })
}

export function updateTechniqueForDirectory(
  techniqueId: string,
  directory: string,
  input: Parameters<typeof updateTechnique>[1],
) {
  return Effect.gen(function* () {
    const located = yield* Effect.promise(() => locateTechnique(techniqueId, directory))
    if (!located) return yield* Effect.fail(techniqueNotFound(techniqueId))
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

export function readTechniqueConfigForDirectory(directory: string) {
  return Effect.gen(function* () {
    return { enabled: readTechniqueInjection(directory) }
  })
}

export function writeTechniqueConfigForDirectory(directory: string, payload: { enabled?: boolean }) {
  return Effect.gen(function* () {
    const enabled = payload.enabled
    if (enabled === undefined) return yield* readTechniqueConfigForDirectory(directory)
    const result = yield* Effect.sync(() => writeTechniqueInjection(directory, enabled))
    if (!result) {
      return yield* Effect.fail(
        new TechniqueValidationError({
          name: "TechniqueValidationError",
          data: { message: "技法注入开关写入失败，请检查 .novel/config.json" },
        }),
      )
    }
    return yield* readTechniqueConfigForDirectory(directory)
  })
}

function directoryOf(location: Location.Interface) {
  return location.directory ?? process.cwd()
}

export const TechniqueHandler = HttpApiBuilder.group(Api, "server.technique", (handlers) =>
  Effect.succeed(
    handlers
      .handle("technique.list", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* listTechniquesForDirectory(directoryOf(location))
        }),
      )
      .handle("technique.create", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* createTechniqueForDirectory(directoryOf(location), ctx.payload)
        }),
      )
      .handle("technique.config", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* readTechniqueConfigForDirectory(directoryOf(location))
        }),
      )
      .handle("technique.set-config", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* writeTechniqueConfigForDirectory(directoryOf(location), ctx.payload)
        }),
      )
      .handle("technique.detail", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getTechniqueForDirectory(ctx.params.techniqueID, directoryOf(location))
        }),
      )
      .handle("technique.update", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateTechniqueForDirectory(
            ctx.params.techniqueID,
            directoryOf(location),
            ctx.payload,
          )
        }),
      )
      .handle("technique.delete", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteTechniqueForDirectory(ctx.params.techniqueID, directoryOf(location))
        }),
      ),
  ),
)
