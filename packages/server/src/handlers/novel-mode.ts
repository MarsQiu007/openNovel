/**
 * 小说写作模式 HTTP handler
 *
 * 提供 GET /api/novel/mode 与 PUT /api/novel/mode 两个端点。
 * 实现逻辑：调 novel-store 的 readNovelConfig / writeNovelConfig。
 * 错误：模式字段非法值由协议 schema 校验（NovelModePatch）拒绝并返回 NovelModeError（400）；
 *       IO 错时降级默认（GET）或返回 Effect 失败（PUT）。
 * 审计：每次 setMode 落盘前/后值到 .novel/audit/mode.jsonl，便于排查"何时被谁改成 review"
 */
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { Location } from "@opennovel-ai/core/location"
import { readNovelConfig, writeNovelConfig, appendModeAudit } from "@opennovel-ai/novel-store"

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
 * 落盘前/后值到 .novel/audit/mode.jsonl，便于排错"什么时候被改成 review 模式了"。
 * directory 缺失时回退 process.cwd()。
 */
export function setMode(
  directory: string | undefined,
  patch: { writing_mode?: "auto" | "review"; setup_mode?: "interactive" | "auto" },
) {
  return Effect.gen(function* () {
    const dir = directory ?? process.cwd()
    // 先读 before：writeNovelConfig 内部也会 read，但 handler 显式拿一次避免 audit 错位
    const before = readNovelConfig(dir)
    const next = writeNovelConfig(dir, patch)
    // 只把实际发生变更的字段记入 patch（避免空 patch 噪声）
    const auditPatch: { writing_mode?: "auto" | "review"; setup_mode?: "interactive" | "auto" } = {}
    if (patch.writing_mode !== undefined && before.writing_mode !== next.writing_mode) {
      auditPatch.writing_mode = next.writing_mode
    }
    if (patch.setup_mode !== undefined && before.setup_mode !== next.setup_mode) {
      auditPatch.setup_mode = next.setup_mode
    }
    if (Object.keys(auditPatch).length > 0) {
      appendModeAudit(dir, { before, after: next, patch: auditPatch })
    }
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
