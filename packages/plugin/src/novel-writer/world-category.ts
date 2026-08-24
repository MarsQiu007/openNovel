/**
 * 世界观条目分类白名单 — 结构固定、内容自由
 *
 * category 是导览导航和 P5 快照组装的结构字段，必须使用受控词汇，
 * 否则不同 agent 自造分类会导致设定导航逐渐碎裂（曾出现 architect 用"重要设定"、
 * observer 用"组织"、context 注释用"核心设定"的漂移）。
 * 条目内容（content）保持自由，不在此约束范围内。
 *
 * 支持 "主分类/子分类" 形式（如 "地点/城市"），仅校验主分类。
 */

export const WORLD_ENTRY_CATEGORIES = [
  "核心设定",
  "世界背景",
  "力量体系",
  "社会制度",
  "势力",
  "地理",
  "历史",
  "文化",
  "生物",
  "物品",
  "功法",
  "科技",
  "地点",
] as const

/** 供工具描述/prompt 引用的分类说明文本 */
export const WORLD_ENTRY_CATEGORY_HINT = `标准分类：${WORLD_ENTRY_CATEGORIES.join(" / ")}；支持"主分类/子分类"形式（如"地点/城市"）`

/**
 * 校验世界观条目分类；合法返回 null，非法返回给 agent 可读的错误消息。
 */
export function validateWorldCategory(category: string): string | null {
  const top = category.split("/")[0].trim()
  if ((WORLD_ENTRY_CATEGORIES as readonly string[]).includes(top)) return null
  return `世界观分类「${category.trim() || "（空）"}」不在标准列表。${WORLD_ENTRY_CATEGORY_HINT}。请改用标准分类；确需新增分类时显式传 allow_new_category=true`
}
