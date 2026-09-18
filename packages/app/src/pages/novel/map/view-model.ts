import type { WorldMapAggregate } from "@opennovel-ai/schema/novel"

/** 世界地图局部平面坐标的边长，与数据层约定一致 */
export const WORLD_SIZE = 10000

export interface CharacterOption {
  id: string
  name: string
}

export interface WorldEntryOption {
  id: string
  name: string
}

export interface RegionLayer {
  kind: "region"
  id: string
  name: string
  description: string
  color: string
  worldEntryName: string | undefined
  latlngs: [number, number][]
}

export interface PlaceLayer {
  kind: "place"
  id: string
  name: string
  description: string
  color: string
  worldEntryName: string | undefined
  latlng: [number, number]
}

export interface PinLayer {
  id: string
  characterId: string
  characterName: string
  featureName: string | undefined
  latlng: [number, number]
}

export interface MapLayerModel {
  regions: RegionLayer[]
  places: PlaceLayer[]
  pins: PinLayer[]
}

/** 世界坐标映射为 Leaflet CRS.Simple 坐标，y 轴翻转使上方为北；只在渲染层使用，不回写 */
export function worldToLatLng(x: number, y: number): [number, number] {
  return [WORLD_SIZE - y, x]
}

/** 把聚合响应与角色、世界观条目数据合并为可渲染图层模型 */
export function buildMapLayerModel(input: {
  aggregate: WorldMapAggregate
  characters: readonly CharacterOption[]
  worldEntries: readonly WorldEntryOption[]
}): MapLayerModel {
  const characterNames = new Map(input.characters.map((character) => [character.id, character.name]))
  const entryNames = new Map(input.worldEntries.map((entry) => [entry.id, entry.name]))
  const featureNames = new Map(input.aggregate.features.map((feature) => [feature.id, feature.name]))

  const regions = input.aggregate.features
    .filter((feature) => feature.kind === "region")
    .map((feature) => ({
      kind: "region" as const,
      id: feature.id,
      name: feature.name,
      description: feature.description,
      color: feature.color,
      worldEntryName: feature.worldEntryId ? entryNames.get(feature.worldEntryId) : undefined,
      latlngs: feature.polygon.map((point) => worldToLatLng(point.x, point.y)),
    }))

  const places = input.aggregate.features
    .filter((feature) => feature.kind === "place")
    .map((feature) => ({
      kind: "place" as const,
      id: feature.id,
      name: feature.name,
      description: feature.description,
      color: feature.color,
      worldEntryName: feature.worldEntryId ? entryNames.get(feature.worldEntryId) : undefined,
      latlng: worldToLatLng(feature.x ?? 0, feature.y ?? 0),
    }))

  const pins = input.aggregate.pins.map((pin) => ({
    id: pin.id,
    characterId: pin.characterId,
    characterName: characterNames.get(pin.characterId) ?? pin.characterId,
    featureName: pin.featureId ? featureNames.get(pin.featureId) : undefined,
    latlng: worldToLatLng(pin.x, pin.y),
  }))

  return { regions, places, pins }
}
