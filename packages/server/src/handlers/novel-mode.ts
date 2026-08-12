/**
 * 小说写作模式 HTTP handler
 *
 * 提供 GET /api/novel/mode 与 PUT /api/novel/mode 两个端点。
 * 实现逻辑：调 novel-store 的 readNovelConfig / writeNovelConfig。
 * 错误：模式字段非法值由协议 schema 校验（NovelModePatch）拒绝并返回 NovelModeError（400）；
 *       IO 错时降级默认（GET）或返回 Effect 失败（PUT）。
 */
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { Location } from "@opennovel-ai/core/location"
import { readNovelConfig, writeNovelConfig } from "@opennovel-ai/novel-store"

/**
 * 把 store 返回的配置规范化为协议 schema 形态（已经是同样形状，直接展开）
 * 输入已由 store readNovelConfig 做非法值降级，无需再校验
 */
function toNovelMode(config: { writing_mode: string; setup_mode: string }): {
  writing_mode: "auto" | "review"
  setup_mode: "interactive" | "auto"
} {
  return {
    writing_mode: config.writing_mode as "auto" | "review",
    setup_mode: config.setup_mode as "interactive" | "auto",
  }
}

/**
 * 读取模式。directory 缺失时回退 process.cwd()（与 location middleware 一致）
 */
export function getMode(directory: string | undefined) {
  return Effect.gen(function* () {
    const config = readNovelConfig(directory ?? process.cwd())
    return toNovelMode(config)
  })
}

/**
 * 写入模式（PATCH 语义）。协议 schema 已在边界校验过枚举；handler 仅调 store。
 * directory 缺失时回退 process.cwd()。
 */
export function setMode(
  directory: string | undefined,
  patch: { writing_mode?: "auto" | "review"; setup_mode?: "interactive" | "auto" },
) {
  return Effect.gen(function* () {
    const next = writeNovelConfig(directory ?? process.cwd(), patch)
    return toNovelMode(next)
  })
}

export const NovelModeHandler = HttpApiBuilder.group(Api, "server.novelMode", (handlers) =>
  Effect.succeed(
    handlers
      .handle("novelMode.get", (_ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getMode(location.directory ?? undefined)
        }),
      )
      .handle("novelMode.set", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* setMode(location.directory ?? undefined, ctx.payload)
        }),
      ),
  ),
)
