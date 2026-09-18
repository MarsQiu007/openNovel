import { describe, expect, test } from "bun:test"
import { buildMapLayerModel, worldToLatLng, WORLD_SIZE } from "./view-model"
import type { WorldMapAggregate } from "@opennovel-ai/schema/novel"

function aggregateFixture(): WorldMapAggregate {
  return {
    map: {
      id: "map-1",
      novelId: "novel-1",
      title: "九州图",
      description: "",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    },
    features: [
      {
        id: "f-region",
        mapId: "map-1",
        novelId: "novel-1",
        worldEntryId: "entry-1",
        kind: "region",
        name: "西荒",
        description: "沙漠地带",
        color: "#e11d48",
        polygon: [
          { x: 0, y: 0 },
          { x: WORLD_SIZE, y: 0 },
          { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 },
        ],
      },
      {
        id: "f-place",
        mapId: "map-1",
        novelId: "novel-1",
        kind: "place",
        name: "青石城",
        description: "",
        color: "#0ea5e9",
        x: 1200,
        y: 3400,
        polygon: [],
      },
    ],
    pins: [
      {
        id: "pin-1",
        mapId: "map-1",
        novelId: "novel-1",
        characterId: "char-1",
        featureId: "f-place",
        x: 1200,
        y: 3400,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  }
}

describe("worldToLatLng", () => {
  test("y 轴翻转：世界左上角映射到 CRS.Simple 左上角", () => {
    expect(worldToLatLng(0, 0)).toEqual([WORLD_SIZE, 0])
  })

  test("y 轴翻转：世界右下角映射到 CRS.Simple 右下角", () => {
    expect(worldToLatLng(WORLD_SIZE, WORLD_SIZE)).toEqual([0, WORLD_SIZE])
  })
})

describe("buildMapLayerModel", () => {
  test("按 kind 分组 region 与 place，多边形做坐标映射", () => {
    const model = buildMapLayerModel({ aggregate: aggregateFixture(), characters: [], worldEntries: [] })
    expect(model.regions).toHaveLength(1)
    expect(model.places).toHaveLength(1)
    expect(model.regions[0].latlngs).toHaveLength(3)
    expect(model.regions[0].latlngs[0]).toEqual([WORLD_SIZE, 0])
    expect(model.places[0].latlng).toEqual([WORLD_SIZE - 3400, 1200])
  })

  test("图钉合并角色名，缺失时回退为角色 ID", () => {
    const model = buildMapLayerModel({
      aggregate: aggregateFixture(),
      characters: [{ id: "char-1", name: "林九" }],
      worldEntries: [],
    })
    expect(model.pins[0].characterName).toBe("林九")

    const fallback = buildMapLayerModel({ aggregate: aggregateFixture(), characters: [], worldEntries: [] })
    expect(fallback.pins[0].characterName).toBe("char-1")
  })

  test("关联的世界观条目与要素名称正确解析", () => {
    const model = buildMapLayerModel({
      aggregate: aggregateFixture(),
      characters: [{ id: "char-1", name: "林九" }],
      worldEntries: [{ id: "entry-1", name: "西荒志" }],
    })
    expect(model.regions[0].worldEntryName).toBe("西荒志")
    expect(model.pins[0].featureName).toBe("青石城")
  })
})
