/**
 * 技法库管理 HTTP handler。
 *
 * 数据访问来自 novel-store；错误只区分未找到与写入/参数失败，请求体校验由协议 schema 完成。
 * 双源路由（technique-scope-routing）：
 * - list 按 query.library 过滤（缺省 book / global / all 合并双源，统一按置信度+更新时间排序）；
 * - detail/update/delete 缺省双库查找（book 优先回退 global），可用 query.library 收窄；
 * - create 按 payload.targetLibrary 路由，全局库拒绝成人技法；
 * - update 按最终 scope 归位：目标库与当前库不同则先迁移（反馈随迁、id 不变）再更新。
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
  moveTechniqueToLibrary,
  readTechniqueInjection,
  updateTechnique,
  writeTechniqueInjection,
  type TechniqueLibrary,
} from "@opennovel-ai/novel-store"
import { Technique, type CreateTechniqueInput } from "@opennovel-ai/schema/technique"
import { TechniqueNotFoundError, TechniqueValidationError } from "@opennovel-ai/protocol/groups/technique"

type LibraryFilter = TechniqueLibrary | "all" | undefined

type TechniqueDetailResult = NonNullable<Awaited<ReturnType<typeof getTechnique>>>

function techniqueNotFound(techniqueId: string): TechniqueNotFoundError {
  return new TechniqueNotFoundError({
    name: "TechniqueNotFoundError",
    data: { message: `技法不存在: ${techniqueId}`, techniqueId },
  })
}

/** 显式 book/global 只查该库；all 或缺省双库查找（book 优先）。 */
function lookupLibraries(library: LibraryFilter): Array<TechniqueLibrary> {
  if (library === "global") return ["global"]
  if (library === "book") return ["book"]
  return ["book", "global"]
}

/** 内容性质与库的固定映射：通用写法进全局库跨书共享；成人技法留本书库。 */
function scopeToLibrary(scope: "general" | "adult"): TechniqueLibrary {
  return scope === "adult" ? "book" : "global"
}

/** 按 id 在指定库集合中定位技法，返回所属库与详情。 */
async function locateTechnique(
  techniqueId: string,
  directory: string,
  library: LibraryFilter,
): Promise<{ lib: TechniqueLibrary; detail: TechniqueDetailResult } | null> {
  for (const lib of lookupLibraries(library)) {
    const detail = await getTechnique(techniqueId, directory, lib)
    if (detail) return { lib, detail }
  }
  return null
}

export function listTechniquesForDirectory(directory: string, library: Exclude<LibraryFilter, undefined> = "book") {
  return Effect.gen(function* () {
    const items = yield* Effect.promise(async () => {
      if (library !== "all") {
        const rows = await listTechniques(directory, library)
        return rows.map((item) => ({ ...item, library }))
      }
      const [bookItems, globalItems] = await Promise.all([
        listTechniques(directory, "book"),
        listTechniques(directory, "global"),
      ])
      return [
        ...bookItems.map((item) => ({ ...item, library: "book" as const })),
        ...globalItems.map((item) => ({ ...item, library: "global" as const })),
      ].sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)
    })
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
  return Effect.gen(function* () {
    const library = input.targetLibrary ?? "book"
    const scope = input.scope ?? "general"
    if (library === "global" && scope === "adult") {
      return yield* Effect.fail(
        new TechniqueValidationError({
          name: "TechniqueValidationError",
          data: { message: "全局通用库仅允许通用写法（scope=general），成人技法请保存在本书库" },
        }),
      )
    }
    // targetLibrary 只用于路由，不落库；store 的数据结构没有该字段。
    const created = yield* Effect.promise(() => createTechnique(input, directory, library))
    return { ...created, library }
  })
}

export function getTechniqueForDirectory(techniqueId: string, directory: string, library?: LibraryFilter) {
  return Effect.gen(function* () {
    const located = yield* Effect.promise(() => locateTechnique(techniqueId, directory, library))
    if (!located) return yield* Effect.fail(techniqueNotFound(techniqueId))
    return { ...located.detail, technique: { ...located.detail.technique, library: located.lib } }
  })
}

export function updateTechniqueForDirectory(
  techniqueId: string,
  directory: string,
  input: Parameters<typeof updateTechnique>[1],
  library?: LibraryFilter,
) {
  return Effect.gen(function* () {
    const located = yield* Effect.promise(() => locateTechnique(techniqueId, directory, library))
    if (!located) return yield* Effect.fail(techniqueNotFound(techniqueId))
    // 库由 scope 派生：最终 scope 归位到映射库，不一致先迁移再更新，保持"全局库只存通用写法"的不变量。
    const targetLibrary = scopeToLibrary(input.scope ?? located.detail.technique.scope)
    if (targetLibrary !== located.lib) {
      const moved = yield* Effect.promise(() =>
        moveTechniqueToLibrary(techniqueId, directory, located.lib, targetLibrary),
      )
      if (!moved) {
        return yield* Effect.fail(
          new TechniqueValidationError({
            name: "TechniqueValidationError",
            data: {
              message: `技法迁移到${targetLibrary === "global" ? "全局通用" : "本书"}库失败：目标库已存在同 id 技法`,
              techniqueId,
            },
          }),
        )
      }
    }
    const result = yield* Effect.promise(() => updateTechnique(techniqueId, input, directory, targetLibrary))
    if (!result) return yield* Effect.fail(techniqueNotFound(techniqueId))
    return { ...result, library: targetLibrary }
  })
}

export function deleteTechniqueForDirectory(techniqueId: string, directory: string, library?: LibraryFilter) {
  return Effect.gen(function* () {
    const locatedLib = yield* Effect.promise(async () => {
      const located = await locateTechnique(techniqueId, directory, library)
      return located ? located.lib : null
    })
    if (!locatedLib) return yield* Effect.fail(techniqueNotFound(techniqueId))
    const deleted = yield* Effect.promise(() => deleteTechnique(techniqueId, directory, locatedLib))
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
          return yield* listTechniquesForDirectory(directoryOf(location), ctx.query.library ?? "book")
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
          return yield* getTechniqueForDirectory(ctx.params.techniqueID, directoryOf(location), ctx.query.library)
        }),
      )
      .handle("technique.update", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateTechniqueForDirectory(
            ctx.params.techniqueID,
            directoryOf(location),
            ctx.payload,
            ctx.query.library,
          )
        }),
      )
      .handle("technique.delete", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* deleteTechniqueForDirectory(ctx.params.techniqueID, directoryOf(location), ctx.query.library)
        }),
      ),
  ),
)
