import { describe, expect, test } from "bun:test"
import type { WorldMapAggregate, WorldMapPoint } from "@opennovel-ai/schema/novel"
import {
  addDrawingPoint,
  clampPoint,
  completeDrawing,
  createEditorSaveQueue,
  deriveDraftCommands,
  latlngToWorldPoint,
  pinPlacementError,
  replaceVertex,
} from "./editor-model"

function aggregateFixture(): WorldMapAggregate {
  return {
    map: {
      id: "active",
      novelId: "novel",
      title: "正式",
      description: "",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    },
    features: [
      {
        id: "region",
        mapId: "active",
        novelId: "novel",
        worldEntryId: "entry",
        kind: "region",
        name: "区域",
        description: "",
        color: "#111111",
        polygon: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      },
      {
        id: "place",
        mapId: "active",
        novelId: "novel",
        worldEntryId: null,
        kind: "place",
        name: "地点",
        description: "",
        color: "#222222",
        x: 10,
        y: 20,
        polygon: [],
      },
    ],
    pins: [
      {
        id: "pin",
        mapId: "active",
        novelId: "novel",
        characterId: "char",
        featureId: "place",
        x: 10,
        y: 20,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  }
}

describe("地图编辑模型", () => {
  test("坐标钳制和 y 轴转换", () => {
    expect(clampPoint({ x: -1, y: 10001 })).toEqual({ x: 0, y: 10000 })
    expect(latlngToWorldPoint({ lat: 10000 - 2500, lng: -3 })).toEqual({ x: 0, y: 2500 })
  })

  test("绘制需要三个顶点，Escape 前取消不产生要素", () => {
    expect(
      completeDrawing([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual({ ok: false, error: "区域至少需要三个顶点" })
    const drawn = completeDrawing([
      { x: -1, y: 0 },
      { x: 5000, y: 5000 },
      { x: 10001, y: 9000 },
    ])
    expect(drawn.ok).toBe(true)
    if (drawn.ok)
      expect(drawn.polygon).toEqual([
        { x: 0, y: 0 },
        { x: 5000, y: 5000 },
        { x: 10000, y: 9000 },
      ])
  })

  test("绘制点击序列、Escape 取消与顶点拖拽提交", () => {
    let points: WorldMapPoint[] = []
    points = addDrawingPoint(points, { x: -1, y: 2 })
    points = addDrawingPoint(points, { x: 3000, y: 4000 })
    points = addDrawingPoint(points, { x: 6000, y: 8000 })
    expect(points).toEqual([
      { x: 0, y: 2 },
      { x: 3000, y: 4000 },
      { x: 6000, y: 8000 },
    ])

    points = []
    expect(completeDrawing(points).ok).toBe(false)

    expect(
      replaceVertex(
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        1,
        { x: 10001, y: -1 },
      ),
    ).toEqual([
      { x: 1, y: 2 },
      { x: 10000, y: 0 },
    ])
  })

  test("派生草稿先生成要素，再生成图钉", () => {
    const commands = deriveDraftCommands(aggregateFixture())
    expect(commands).toHaveLength(3)
    expect(commands.map((command) => command.kind)).toEqual(["feature", "feature", "pin"])
    expect(commands[2]).toEqual({
      kind: "pin",
      input: { characterId: "char", featureId: "place", x: 10, y: 20 },
    })
  })

  test("同一角色重复安放图钉被前置拒绝", () => {
    expect(pinPlacementError("char", aggregateFixture().pins)).toBe("该角色已有图钉")
    expect(pinPlacementError("other", aggregateFixture().pins)).toBeUndefined()
  })

  test("保存失败保留操作并支持重试", async () => {
    let attempts = 0
    const queue = createEditorSaveQueue(() => {})
    queue.schedule("failed-save", async () => {
      attempts += 1
      if (attempts === 1) throw new Error("网络中断")
    })

    await queue.retry("failed-save")
    expect(attempts).toBe(1)
    expect(queue.has("failed-save")).toBe(true)
    expect(queue.failures()).toEqual([{ key: "failed-save", message: "网络中断" }])

    await queue.retry("failed-save")
    expect(attempts).toBe(2)
    expect(queue.has("failed-save")).toBe(false)
    expect(queue.failures()).toEqual([])
  })

  test("保存队列按延迟自动触发", async () => {
    let saved = 0
    const queue = createEditorSaveQueue(() => {})
    queue.schedule("delayed-save", async () => {
      saved += 1
    })
    expect(saved).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 850))
    expect(saved).toBe(1)
    expect(queue.size).toBe(0)
  })

  test("保存队列按 key 去重并延迟触发", async () => {
    let saved = 0
    const queue = createEditorSaveQueue(() => {})
    queue.schedule("feature-1", async () => {
      saved += 1
    })
    queue.schedule("feature-1", async () => {
      saved += 10
    })
    expect(queue.size).toBe(1)
    await queue.retry("feature-1")
    expect(saved).toBe(10)
    expect(queue.size).toBe(0)
  })
})
