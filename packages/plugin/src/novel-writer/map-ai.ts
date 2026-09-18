/**
 * 世界地图 AI 草稿生成纯逻辑。
 *
 * 该模块把世界观条目压缩成稳定提示词，并用 Effect Schema 校验模型输出；
 * 校验失败时由调用方注入错误反馈并重试一次。
 */
import { Schema } from "effect"

const coordinate = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(10000),
)

const point = Schema.Struct({
  x: coordinate,
  y: coordinate,
})

const polygon = Schema.Array(point).check(Schema.isMinLength(3))

export const WorldMapAiDraft = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.String,
  features: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["region", "place"]),
      name: Schema.NonEmptyString,
      description: Schema.String,
      color: Schema.String,
      worldEntryId: Schema.optional(Schema.NullOr(Schema.String)),
      x: Schema.optional(coordinate),
      y: Schema.optional(coordinate),
      polygon: Schema.optional(polygon),
    }),
  ).check(Schema.isMinLength(1)),
})

export type WorldMapAiFeatureInput = {
  kind: "region" | "place"
  name: string
  description: string
  color: string
  worldEntryId?: string | null
  x?: number
  y?: number
  polygon?: readonly { x: number; y: number }[]
}

export type WorldMapAiDraftInput = {
  title: string
  description: string
  features: WorldMapAiFeatureInput[]
}

export type MapAiEntryInput = {
  id: string
  title: string
  category: string
  content: string
}

export type MapAiPromptInput = {
  entries: readonly MapAiEntryInput[]
  instruction?: string
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function formatWorldMapAiPrompt(input: MapAiPromptInput): string {
  const entries = input.entries
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category || "未分类",
      summary: entry.content.replace(/\s+/g, " ").trim().slice(0, 600),
    }))
  const sections = [
    "请基于小说世界观条目生成一个 0..10000 平面坐标世界地图草稿，并调用 write_world_map_draft 写入。",
    "\n## 画布约定\n"
      + "- x 向东增大，y 向南增大，坐标必须是 0..10000。\n"
      + "- region 必须提供至少 3 个顶点的 polygon；place 必须提供 x/y。\n"
      + "- 区域和地点应保持合理间距，避免明显重叠；方位关系要符合条目描述和用户指令。\n"
      + "- 不要生成角色图钉。\n"
      + "- worldEntryId 只能使用下列条目 ID；没有对应条目时用 null。",
    "\n## 世界观条目\n"
      + (entries.length > 0
        ? entries.map((entry, index) => `${index + 1}. ${JSON.stringify(entry)}`).join("\n")
        : "-（当前小说暂无世界观条目，请基于书名类型生成基础地理轮廓）"),
    "\n## 用户布局指令\n"
      + (input.instruction?.trim() || "无"),
    "\n## 写入规则\n"
      + "- title 和 description 使用简体中文，description 为一句话地图概述。\n"
      + "- features 是 region/place 数组；name、description、color、worldEntryId 必须明确。\n"
      + "- 调用 write_world_map_draft 时把完整地图数据放进 features_json。\n"
      + "- 如果写入工具返回校验失败，根据错误修正后最多自动重试一次；第二次失败必须停止并说明原因。",
  ]
  return sections.join("\n")
}

export type MapAiValidationResult =
  | { ok: true; draft: WorldMapAiDraftInput }
  | { ok: false; error: string }

export function validateWorldMapAiDraft(value: unknown): MapAiValidationResult {
  try {
    const parsed = Schema.decodeUnknownSync(WorldMapAiDraft)(value)
    return {
      ok: true,
      draft: {
        title: parsed.title,
        description: parsed.description,
        features: parsed.features.map((feature) => ({
          ...feature,
          worldEntryId: feature.worldEntryId ?? null,
        })),
      },
    }
  } catch (error) {
    return { ok: false, error: `结构化地图输出校验失败：${describeError(error)}` }
  }
}

/**
 * 执行“生成 → 校验 → 错误反馈重试一次 → 写入”的完整管道。
 *
 * `writeDraft` 只会在最终校验通过后调用一次。
 */
export async function runWorldMapAiDraft(
  generate: (feedback?: { error: string }) => Promise<unknown>,
  writeDraft: (draft: WorldMapAiDraftInput) => Promise<void>,
): Promise<void> {
  const first = validateWorldMapAiDraft(await generate())
  if (first.ok) return writeDraft(first.draft)

  const second = validateWorldMapAiDraft(await generate({ error: first.error }))
  if (second.ok) return writeDraft(second.draft)
  throw new Error(`${first.error}; 重试仍失败：${second.error}`)
}
