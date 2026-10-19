import { describe, expect, test } from "bun:test"
import {
  displayTabs,
  migrateLegacySettingsNode,
  parseSettingsNode,
  serializeSettingsNode,
  type SettingsNode,
} from "./settings-node"

describe("serializeSettingsNode / parseSettingsNode", () => {
  test("单页与板块 root 节点原样往返", () => {
    const nodes: SettingsNode[] = [
      { kind: "book-info" },
      { kind: "world" },
      { kind: "foreshadow" },
      { kind: "style" },
      { kind: "soul" },
      { kind: "techniques" },
      { kind: "organization" },
      { kind: "characters" },
    ]
    for (const node of nodes) {
      expect(parseSettingsNode(serializeSettingsNode(node))).toEqual(node)
    }
  })

  test("带 id 节点序列化为 kind:id 形态", () => {
    expect(serializeSettingsNode({ kind: "world-entry", entryId: "e1" })).toBe("world-entry:e1")
    expect(serializeSettingsNode({ kind: "character", characterId: "c1" })).toBe("character:c1")
    expect(parseSettingsNode("world-entry:e1")).toEqual({ kind: "world-entry", entryId: "e1" })
    expect(parseSettingsNode("character:c1")).toEqual({ kind: "character", characterId: "c1" })
  })

  test("空值与非法形态返回 null（损坏存档按未选中回落）", () => {
    expect(parseSettingsNode(undefined)).toBeNull()
    expect(parseSettingsNode(null)).toBeNull()
    expect(parseSettingsNode("")).toBeNull()
    expect(parseSettingsNode("nonsense")).toBeNull()
    expect(parseSettingsNode("world-entry:")).toBeNull()
    expect(parseSettingsNode("character:   ")).toBeNull()
    expect(parseSettingsNode("world-entry :e1")).toBeNull()
  })
})

describe("migrateLegacySettingsNode", () => {
  test("worldEntryId 迁移为世界观条目节点", () => {
    expect(migrateLegacySettingsNode({ worldEntryId: "e9" })).toEqual({ kind: "world-entry", entryId: "e9" })
  })

  test("relationCharacterId 迁移为角色节点", () => {
    expect(migrateLegacySettingsNode({ relationCharacterId: "c9" })).toEqual({
      kind: "character",
      characterId: "c9",
    })
  })

  test("无旧字段返回 null", () => {
    expect(migrateLegacySettingsNode({})).toBeNull()
  })
})

describe("displayTabs", () => {
  test("条目 / 角色 / 板块 root 的标签组", () => {
    expect(displayTabs({ kind: "world-entry", entryId: "e" })).toEqual(["content", "edit", "gallery"])
    expect(displayTabs({ kind: "character", characterId: "c" })).toEqual(["content", "edit", "graph", "gallery"])
    expect(displayTabs({ kind: "world" })).toEqual(["list", "map"])
    expect(displayTabs({ kind: "characters" })).toEqual(["list", "graph"])
  })

  test("单页节点不渲染标签条", () => {
    for (const node of [
      { kind: "book-info" },
      { kind: "foreshadow" },
      { kind: "style" },
      { kind: "soul" },
      { kind: "techniques" },
      { kind: "organization" },
    ] as const) {
      expect(displayTabs(node)).toBeNull()
    }
  })
})
