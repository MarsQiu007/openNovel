import { Location } from "@opennovel-ai/core/location"
import { LocationServiceMap } from "@opennovel-ai/core/location-services"
import { AbsolutePath } from "@opennovel-ai/core/schema"
import { WorkspaceV2 } from "@opennovel-ai/core/workspace"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opennovel/HttpApiLocation",
) {}

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

// 已知 location ref 注册表：middleware 每次解析请求 ref 时登记。全局配置
// 变更后据此逐个失效 location 层缓存，让下一次查询读到新配置——core Config
// 在 location 层构建时一次性快照，若只清 instance 不清 location 层，新配置
// 必须等 LayerMap 的 idleTimeToLive（60 分钟）到期或重启 server 才可见。
const knownRefs = new Set<Location.Ref>()

function refKey(ref: Location.Ref): string {
  return `${ref.workspaceID ?? ""}::${ref.directory}`
}

// Location.Ref 是普通 struct（无字段级 Equal），LocationServiceMap 的 LayerMap
// 按 ref 对象 identity 分桶：同一 directory 必须复用同一 ref 对象，否则每个
// 请求都会在 LayerMap 里新建一棵独立的 location 层树（全新 AgentV2 State、
// 重跑插件 boot 批，且 60 分钟 TTL 内不回收）。
export function sharedRef(directory: string, workspaceID: WorkspaceV2.ID | undefined): Location.Ref {
  const result = Location.Ref.make({
    directory: AbsolutePath.make(directory),
    workspaceID,
  })
  // 用序列化 key 去重，避免同一 ref 因对象 identity 不同被重复记录
  const key = refKey(result)
  for (const existing of knownRefs) {
    if (refKey(existing) === key) return existing
  }
  knownRefs.add(result)
  return result
}

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-opennovel-workspace"]
  const directory =
    query.get("location[directory]") ||
    (request.headers["x-opennovel-directory"] ? decode(request.headers["x-opennovel-directory"]) : process.cwd())
  return sharedRef(
    directory,
    workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
  )
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

// 失效所有已知 location 层缓存。返回失效的 ref 列表，便于调用方记录/调试。
export function invalidateAllKnownLocations(): Effect.Effect<Location.Ref[], never, LocationServiceMap.Service> {
  return Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const refs = [...knownRefs]
    yield* Effect.forEach(
      refs,
      (r) =>
        locations.invalidate(r).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning("location invalidate failed", {
              directory: r.directory,
              workspaceID: r.workspaceID,
              cause,
            }),
          ),
          Effect.ignoreCause,
        ),
      { discard: true },
    )
    return refs
  })
}

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(ref(request))))
      }),
    )
  }),
)
