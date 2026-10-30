/**
 * 角色定制档案（character-profile）— 跨包共享
 *
 * characters.profile 列存 JSON 字符串，空串视为未建档。档案结构：
 * 核心五维（appearance 外貌 / speech 说话习惯 / tone 语气 / personality 个性 /
 * mannerism 习惯动作）+ extensions 自定义 KV 容器。
 *
 * 编码口径（仿 style_guide rules 单次编码约定）：序列化只在写入边界做一次
 * （serializeCharacterProfile），解析只在读取边界做一次（parseCharacterProfile）。
 * 解析容错——字段缺失/类型不符按空处理，损坏 JSON 降级空档案，永不抛错
 * （仿 readNovelConfig 降级策略），档案损坏不影响写作链路。
 */

/** 核心维度 key 白名单（extensions 为自定义 KV 容器，单独处理） */
export const CHARACTER_PROFILE_DIMENSIONS = [
  "appearance",
  "speech",
  "tone",
  "personality",
  "mannerism",
] as const

export type CharacterProfileDimension = (typeof CHARACTER_PROFILE_DIMENSIONS)[number]

/** 角色档案：核心维度短文本 + 自定义扩展 KV（值限字符串） */
export interface CharacterProfile {
  appearance?: string
  speech?: string
  tone?: string
  personality?: string
  mannerism?: string
  extensions?: Record<string, string>
}

/** 全部合法档案 key（含 extensions 容器本身）；未知 key 写入侧应拒绝并提示走 extensions */
export const CHARACTER_PROFILE_KEYS: readonly string[] = [...CHARACTER_PROFILE_DIMENSIONS, "extensions"]

export function isCharacterProfileKey(key: string): boolean {
  return (CHARACTER_PROFILE_KEYS as readonly string[]).includes(key)
}

function collectExtensions(source: unknown): Record<string, string> | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return undefined
  const kv: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim().length > 0) kv[key] = value
    else if (typeof value === "number" || typeof value === "boolean") kv[key] = String(value)
  }
  return Object.keys(kv).length > 0 ? kv : undefined
}

/** 读取边界：容错解析档案 JSON，损坏/缺省/类型不符一律降级为空档案或丢弃该维度，不抛错 */
export function parseCharacterProfile(raw?: string | null): CharacterProfile {
  if (typeof raw !== "string" || raw.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
  const source = parsed as Record<string, unknown>
  const profile: CharacterProfile = {}
  for (const dim of CHARACTER_PROFILE_DIMENSIONS) {
    const value = source[dim]
    if (typeof value === "string" && value.trim().length > 0) profile[dim] = value
  }
  const extensions = collectExtensions(source.extensions)
  if (extensions) profile.extensions = extensions
  return profile
}

/** 写入边界：序列化档案为 JSON 字符串；空维度剔除，全空返回空串（未建档语义） */
export function serializeCharacterProfile(profile?: CharacterProfile | null): string {
  if (!profile || typeof profile !== "object") return ""
  const clean: CharacterProfile = {}
  for (const dim of CHARACTER_PROFILE_DIMENSIONS) {
    const value = profile[dim]
    if (typeof value === "string" && value.trim().length > 0) clean[dim] = value
  }
  const extensions = collectExtensions(profile.extensions)
  if (extensions) clean.extensions = extensions
  if (Object.keys(clean).length === 0) return ""
  return JSON.stringify(clean)
}
