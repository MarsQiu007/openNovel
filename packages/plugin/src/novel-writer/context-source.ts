/**
 * novel-writer/context SystemContext 源（V2 注入，design §4）。
 *
 * 取代 V1 system.transform hook 的三段注入：值携带三段渲染文本（模式契约 /
 * 灵魂 / 小说上下文快照）与快照所属小说；baseline 按 V1 同序同文拼装；
 * update 分支——mode/soul/小说归属变化（罕见、语义关键）渲染全量新文本，
 * 仅快照变化（每个写作步骤都变）渲染一行变更通知，避免每轮把数千 token
 * 快照重灌进历史（完整快照的权威通道是流水线的 assemble_context_snapshot）。
 *
 * 读取全部降级：DB/文件失败只跳过对应段，不阻断会话（对齐 V1 hook 降级策略）。
 */
import { Effect, Option, Schema } from "effect"
import type { SessionDomain, SystemContextSource } from "../v2/effect/index.js"
import { getSoul } from "./session-store.js"
import { chooseSoul, readGlobalSoulFile } from "./soul.js"
import {
  loadNovelSnapshot,
  renderModeSection,
  renderSnapshotSection,
  renderSoulSection,
} from "./tools/context-render.js"
import { resolveSessionNovel } from "./tools/session-novel.js"

/** novel-writer/context 源值：三段渲染文本 + 快照所属小说。 */
export const NovelContextValue = Schema.Struct({
  mode: Schema.String,
  soul: Schema.optional(Schema.String),
  novelId: Schema.optional(Schema.String),
  snapshot: Schema.optional(Schema.String),
})
export type NovelContextValue = typeof NovelContextValue.Type

const SNAPSHOT_UPDATED_NOTICE = "【小说写作上下文快照已更新】需要最新细节请调用 assemble_context_snapshot 获取完整快照。"

async function loadValue(
  deps: { session: SessionDomain; directory: string; configDir: string },
  sessionID: string | undefined,
): Promise<Option.Option<NovelContextValue>> {
  // 项目目录解析失败（实际不可达）：按 unavailable 处理，避免渲染残缺 baseline
  const mode = renderModeSection(deps.directory)
  if (!mode) return Option.none()

  const novelId = sessionID
    ? await resolveSessionNovel(deps.session, sessionID, deps.directory).catch(() => undefined)
    : undefined
  const novelSoul = novelId ? (await getSoul(novelId, deps.directory).catch(() => undefined))?.content : undefined
  const globalSoul = await readGlobalSoulFile(deps.configDir)
  const soul = chooseSoul(novelSoul, globalSoul)
  const snapshot = novelId ? await loadNovelSnapshot(novelId, deps.directory).catch(() => undefined) : undefined

  return Option.some({
    mode,
    ...(soul ? { soul: renderSoulSection(soul) } : {}),
    ...(novelId ? { novelId } : {}),
    ...(snapshot ? { snapshot: renderSnapshotSection(snapshot) } : {}),
  })
}

/** V1 同序同文三段拼装：模式契约 → 灵魂 → 快照。 */
function renderBaseline(value: NovelContextValue): string {
  return [value.mode, value.soul, value.snapshot].filter((s): s is string => s !== undefined).join("\n\n")
}

function renderUpdate(previous: NovelContextValue, current: NovelContextValue): string {
  if (
    previous.mode !== current.mode ||
    previous.soul !== current.soul ||
    previous.novelId !== current.novelId
  ) {
    return renderBaseline(current)
  }
  return SNAPSHOT_UPDATED_NOTICE
}

export function createNovelContextSource(deps: {
  session: SessionDomain
  directory: string
  configDir: string
}): SystemContextSource<NovelContextValue> {
  return {
    key: "novel-writer/context",
    codec: NovelContextValue,
    load: (context) => Effect.promise(() => loadValue(deps, context.sessionID)),
    baseline: renderBaseline,
    update: renderUpdate,
  }
}
