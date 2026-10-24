/**
 * 设定树节点模型与存档序列化（design D1/D4）。
 *
 * 节点是判别联合，类型层保证「按节点类型声明显示标签组」可穷尽；
 * 持久化形态为字符串（settingsNode 存档只存字符串），读取时解析，
 * 非法值按未选中回落，不阻塞工作台加载。
 */

export type SettingsNode =
  | { kind: "book-info" }
  | { kind: "world" }
  | { kind: "world-entry"; entryId: string }
  | { kind: "foreshadow" }
  | { kind: "style" }
  | { kind: "soul" }
  | { kind: "techniques" }
  | { kind: "organization" }
  | { kind: "memory" }
  | { kind: "characters" }
  | { kind: "character"; characterId: string }

// 显示标签的取值：内容 / 编辑 / 图（可视化视图）/ 画廊 / 列表 / 地图
export type SettingsTab = "content" | "edit" | "graph" | "gallery" | "list" | "map"

/**
 * 按节点类型声明显示标签组（design D2）。
 * 单页节点（书籍信息 / 伏笔 / 风格 / 灵魂 / 技法库 / 整理）返回 null——中央区不渲染标签条。
 */
export function displayTabs(node: SettingsNode): SettingsTab[] | null {
  switch (node.kind) {
    case "world-entry":
      return ["content", "edit", "gallery"]
    case "character":
      return ["content", "edit", "graph", "gallery"]
    case "world":
      return ["list", "map"]
    case "characters":
      return ["list", "graph"]
    default:
      return null
  }
}

/** 节点的持久化字符串形态。 */
export function serializeSettingsNode(node: SettingsNode): string {
  switch (node.kind) {
    case "world-entry":
      return `world-entry:${node.entryId}`
    case "character":
      return `character:${node.characterId}`
    default:
      return node.kind
  }
}

/** 解析存档字符串；空值与非法形态（损坏存档、未知 kind）一律返回 null。 */
export function parseSettingsNode(raw: string | null | undefined): SettingsNode | null {
  if (!raw) return null
  if (raw.startsWith("world-entry:")) {
    const entryId = raw.slice("world-entry:".length).trim()
    return entryId ? { kind: "world-entry", entryId } : null
  }
  if (raw.startsWith("character:")) {
    const characterId = raw.slice("character:".length).trim()
    return characterId ? { kind: "character", characterId } : null
  }
  switch (raw) {
    case "book-info":
    case "world":
    case "foreshadow":
    case "style":
    case "soul":
    case "techniques":
    case "organization":
    case "memory":
    case "characters":
      return { kind: raw }
    default:
      return null
  }
}

/**
 * 旧字段只读迁移（design D4）：worldEntryId → 世界观条目节点；relationCharacterId → 角色节点。
 * 仅在 settingsNode 存档不存在时启用（`??` 语义）；迁移值指向的数据存在性由失效补校验负责。
 */
export function migrateLegacySettingsNode(saved: {
  worldEntryId?: string
  relationCharacterId?: string
}): SettingsNode | null {
  if (saved.worldEntryId) return { kind: "world-entry", entryId: saved.worldEntryId }
  if (saved.relationCharacterId) return { kind: "character", characterId: saved.relationCharacterId }
  return null
}
