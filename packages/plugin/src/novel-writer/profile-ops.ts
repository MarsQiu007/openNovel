/**
 * 角色档案塑造操作（character-profile）— manage_characters / save_novel_settings 共用。
 *
 * 校验：档案对象/补丁的 key 走白名单（CHARACTER_PROFILE_KEYS），未知 key 报错并
 * 提示改写 extensions；核心维度与扩展项值限字符串。
 * 补丁语义：核心维度整值覆盖；extensions 按键合并，空字符串值表示删除该扩展项。
 * 删除语义：维度 key 删整维（如 "mannerism"），"extensions" 删全部扩展项，
 * "extensions.<名称>" 删单个扩展项。
 */
import { CHARACTER_PROFILE_DIMENSIONS, isCharacterProfileKey, type CharacterProfile, type CharacterProfileDimension } from "./session-store.js"

/** 档案维度中文标签（check_novel_settings 展示与上下文快照渲染共用） */
export const CHARACTER_PROFILE_DIMENSION_LABELS: Record<CharacterProfileDimension, string> = {
  appearance: "身体特征",
  speech: "说话习惯",
  tone: "语气",
  personality: "个性",
  mannerism: "习惯动作",
}

/** 校验档案对象/补丁的 key 白名单与值类型，违规返回错误说明，合法返回 undefined */
export function profileShapeError(value: unknown, label: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${label} 必须是档案对象（核心维度 + extensions）`
  }
  for (const [key, v] of Object.entries(value)) {
    if (!isCharacterProfileKey(key)) {
      return `${label} 含未知维度 "${key}"（合法：appearance/speech/tone/personality/mannerism/extensions），自定义设定请写入 extensions`
    }
    if (key === "extensions") {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return `${label}.extensions 必须是键值对对象（值限字符串）`
      }
      for (const [k, ev] of Object.entries(v)) {
        if (typeof ev !== "string") return `${label}.extensions."${k}" 的值必须是字符串`
      }
    } else if (typeof v !== "string") {
      return `${label}.${key} 的值必须是字符串`
    }
  }
  return undefined
}

/** 应用维度补丁：核心维度整值覆盖，extensions 按键合并（空字符串值删除该扩展项） */
export function applyProfilePatch(base: CharacterProfile, patch: CharacterProfile): CharacterProfile {
  const merged: CharacterProfile = { ...base }
  for (const dim of CHARACTER_PROFILE_DIMENSIONS) {
    const value = patch[dim]
    if (typeof value === "string") merged[dim] = value
  }
  if (patch.extensions) merged.extensions = { ...merged.extensions, ...patch.extensions }
  return merged
}

/** 应用维度删除；非法 key 或删除不存在的扩展项返回 error（profile 字段为已应用部分，调用方应弃用） */
export function applyProfileRemove(
  base: CharacterProfile,
  keys: string[],
): { profile: CharacterProfile; error?: string } {
  const profile: CharacterProfile = { ...base, ...(base.extensions ? { extensions: { ...base.extensions } } : {}) }
  for (const key of keys) {
    if (key === "extensions") {
      delete profile.extensions
    } else if (key.startsWith("extensions.")) {
      const extKey = key.slice("extensions.".length)
      if (extKey.length === 0) return { profile, error: `profile_remove 的 "${key}" 缺少扩展项名称` }
      if (!profile.extensions || !(extKey in profile.extensions)) {
        return { profile, error: `扩展项 "${extKey}" 不存在，无法删除` }
      }
      delete profile.extensions[extKey]
      if (Object.keys(profile.extensions).length === 0) delete profile.extensions
    } else if ((CHARACTER_PROFILE_DIMENSIONS as readonly string[]).includes(key)) {
      delete profile[key as CharacterProfileDimension]
    } else {
      return {
        profile,
        error: `profile_remove 含未知维度 "${key}"（合法：appearance/speech/tone/personality/mannerism/extensions 或 extensions.<名称>）`,
      }
    }
  }
  return { profile }
}
