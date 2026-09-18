import type { WorldMapAggregate, WorldMapFeature, WorldMapPoint } from "@opennovel-ai/schema/novel"

export const MAP_SAVE_DELAY_MS = 800

export type EditorTool = "select" | "region" | "place" | "pin"

export type DraftCommand = { kind: "feature"; input: CreateFeatureCommand } | { kind: "pin"; input: CreatePinCommand }

export interface CreateFeatureCommand {
  kind: "region" | "place"
  name: string
  description: string
  color: string
  worldEntryId: string | null
  x?: number
  y?: number
  polygon?: readonly WorldMapPoint[]
}

export interface CreatePinCommand {
  characterId: string
  featureId: string | null
  x: number
  y: number
}

export function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(10000, Math.max(0, value))
}

export function clampPoint(point: WorldMapPoint): WorldMapPoint {
  return { x: clampCoordinate(point.x), y: clampCoordinate(point.y) }
}

export function latlngToWorldPoint(latlng: { lat: number; lng: number }): WorldMapPoint {
  return clampPoint({ x: latlng.lng, y: 10000 - latlng.lat })
}

export function addDrawingPoint(points: readonly WorldMapPoint[], point: WorldMapPoint): WorldMapPoint[] {
  return [...points, clampPoint(point)]
}

export function cancelDrawing(): [] {
  return []
}

export function replaceVertex(polygon: readonly WorldMapPoint[], index: number, point: WorldMapPoint): WorldMapPoint[] {
  return polygon.map((vertex, vertexIndex) => (vertexIndex === index ? clampPoint(point) : vertex))
}

export function completeDrawing(
  points: readonly WorldMapPoint[],
): { ok: true; polygon: WorldMapPoint[] } | { ok: false; error: string } {
  if (points.length < 3) return { ok: false, error: "区域至少需要三个顶点" }
  return { ok: true, polygon: points.map(clampPoint) }
}

export function pinPlacementError(characterId: string, pins: readonly { characterId: string }[]): string | undefined {
  return pins.some((pin) => pin.characterId === characterId) ? "该角色已有图钉" : undefined
}

/** 复制草稿时必须保持要素顺序，图钉在全部要素之后创建，保证外键引用可用 */
export function deriveDraftCommands(active: WorldMapAggregate): DraftCommand[] {
  return [
    ...active.features.map(
      (feature: WorldMapFeature): DraftCommand => ({
        kind: "feature",
        input: {
          kind: feature.kind,
          name: feature.name,
          description: feature.description,
          color: feature.color,
          worldEntryId: feature.worldEntryId ?? null,
          ...(feature.kind === "place" ? { x: feature.x ?? 0, y: feature.y ?? 0 } : { polygon: feature.polygon }),
        },
      }),
    ),
    ...active.pins.map(
      (pin): DraftCommand => ({
        kind: "pin",
        input: { characterId: pin.characterId, featureId: pin.featureId ?? null, x: pin.x, y: pin.y },
      }),
    ),
  ]
}

export function createEditorSaveQueue(notify: () => void) {
  const pending = new Map<string, () => Promise<void>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const failures = new Map<string, string>()

  const execute = async (key: string) => {
    const operation = pending.get(key)
    if (!operation) return
    try {
      await operation()
      pending.delete(key)
      failures.delete(key)
    } catch (error) {
      failures.set(key, error instanceof Error ? error.message : String(error))
    } finally {
      notify()
    }
  }

  return {
    get size() {
      return pending.size
    },
    has(key: string) {
      return pending.has(key)
    },
    schedule(key: string, operation: () => Promise<void>) {
      pending.set(key, operation)
      failures.delete(key)
      const previous = timers.get(key)
      if (previous) clearTimeout(previous)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          void execute(key)
        }, MAP_SAVE_DELAY_MS),
      )
      notify()
    },
    failures(): Array<{ key: string; message: string }> {
      return [...failures.entries()].map(([key, message]) => ({ key, message }))
    },
    error(key: string): string | undefined {
      return failures.get(key)
    },
    async retry(key: string) {
      if (!pending.has(key)) return
      const previous = timers.get(key)
      if (previous) {
        clearTimeout(previous)
        timers.delete(key)
      }
      await execute(key)
    },
    clear() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      pending.clear()
      failures.clear()
      notify()
    },
  }
}
