import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import {
  CharacterTable,
  NovelTable,
  WorldEntryTable,
  createCharacterMapPin,
  createWorldMap,
  createWorldMapFeature,
  getDb,
  getWorldMapAggregate,
} from "../src/index.js"

let projectDir: string

beforeEach(() => {
  projectDir = join(tmpdir(), `world-map-copy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(projectDir, ".novel"), { recursive: true })
})

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Windows 下连接释放可能稍有延迟，尽力清理
  }
})

describe("world map draft copy", () => {
  test("派生草稿完整复制要素和图钉，且不修改正式地图", async () => {
    const db = getDb(projectDir)
    const novelId = "novel-map-copy"
    const characterId = crypto.randomUUID()
    const entryId = crypto.randomUUID()
    await db
      .insert(NovelTable)
      .values({
        id: novelId,
        title: "地图书",
        genre: "玄幻",
        synopsis: "",
        status: "draft",
        created_at: 1,
        updated_at: 1,
      })
      .run()
    await db
      .insert(CharacterTable)
      .values({
        id: characterId,
        novel_id: novelId,
        name: "主角",
        role: "protagonist",
        status: "active",
        created_at: 1,
      })
      .run()
    await db
      .insert(WorldEntryTable)
      .values({ id: entryId, novel_id: novelId, category: "地点", title: "青岚城", content: "", created_at: 1 })
      .run()

    const active = await createWorldMap(novelId, { status: "active", title: "正式地图" }, projectDir)
    const regionInput = {
      kind: "region" as const,
      name: "青岚盆地",
      description: "大陆东部盆地",
      color: "#22c55e",
      worldEntryId: null,
      polygon: [
        { x: 100, y: 200 },
        { x: 3000, y: 400 },
        { x: 1600, y: 2400 },
      ],
    }
    const placeInput = {
      kind: "place" as const,
      name: "青岚城",
      description: "商业重镇",
      color: "#4f46e5",
      worldEntryId: entryId,
      x: 1200,
      y: 1800,
    }
    const activeRegion = await createWorldMapFeature(novelId, active.id, regionInput, projectDir)
    const activePlace = await createWorldMapFeature(novelId, active.id, placeInput, projectDir)
    const activePin = await createCharacterMapPin(
      novelId,
      active.id,
      { characterId, featureId: activePlace.id, x: 1200, y: 1800 },
      projectDir,
    )

    const draft = await createWorldMap(novelId, { status: "draft", title: active.title }, projectDir)
    const sourceFeatures = [
      { source: activeRegion, input: regionInput },
      { source: activePlace, input: placeInput },
    ]
    const featureIds = new Map<string, string>()
    for (const item of sourceFeatures) {
      const copied = await createWorldMapFeature(novelId, draft.id, item.input, projectDir)
      featureIds.set(item.source.id, copied.id)
    }
    const draftPin = await createCharacterMapPin(
      novelId,
      draft.id,
      { characterId, featureId: featureIds.get(activePlace.id), x: activePin.x, y: activePin.y },
      projectDir,
    )

    const draftAggregate = await getWorldMapAggregate(novelId, "draft", projectDir)
    expect(draftAggregate?.map.id).toBe(draft.id)
    expect(draftAggregate?.features).toHaveLength(2)

    const draftRegion = draftAggregate?.features.find((feature) => feature.kind === "region")
    const draftPlace = draftAggregate?.features.find((feature) => feature.kind === "place")
    expect(draftRegion?.name).toBe("青岚盆地")
    expect(draftRegion?.description).toBe("大陆东部盆地")
    expect(draftRegion?.color).toBe("#22c55e")
    expect(draftRegion?.world_entry_id).toBeNull()
    expect(draftRegion?.polygon_json).toEqual(regionInput.polygon)
    expect(draftPlace?.name).toBe("青岚城")
    expect(draftPlace?.world_entry_id).toBe(entryId)
    expect(draftPlace?.x).toBe(1200)
    expect(draftPlace?.y).toBe(1800)

    expect(draftAggregate?.pins).toHaveLength(1)
    expect(draftAggregate?.pins[0]?.id).toBe(draftPin.id)
    expect(draftAggregate?.pins[0]?.character_id).toBe(characterId)
    expect(draftAggregate?.pins[0]?.feature_id).toBe(featureIds.get(activePlace.id))
    expect(draftAggregate?.pins[0]?.map_id).toBe(draft.id)

    const activeAggregate = await getWorldMapAggregate(novelId, "active", projectDir)
    expect(activeAggregate?.map.id).toBe(active.id)
    expect(activeAggregate?.features.map((feature) => feature.id)).toEqual([activeRegion.id, activePlace.id])
    expect(activeAggregate?.pins.map((pin) => pin.id)).toEqual([activePin.id])
    expect(activeAggregate?.pins[0]?.feature_id).toBe(activePlace.id)
  })
})
