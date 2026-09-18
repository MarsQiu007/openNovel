import L from "leaflet"
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js"
import "leaflet/dist/leaflet.css"
import { latlngToWorldPoint, type EditorTool } from "./editor-model"
import { WORLD_SIZE, type MapLayerModel, type PinLayer, type PlaceLayer, type RegionLayer } from "./view-model"
import type { WorldMapPoint } from "@opennovel-ai/schema/novel"

export type MapSelection = { kind: "feature"; id: string } | { kind: "pin"; id: string }

export type LocalPlaneMapEvents = {
  onMapClick?: (point: WorldMapPoint) => void
  onEscape?: () => void
  onFeatureClick?: (featureId: string) => void
  onPinClick?: (pinId: string) => void
  onPlaceMove?: (featureId: string, point: WorldMapPoint) => void
  onPinMove?: (pinId: string, point: WorldMapPoint) => void
  onVertexMove?: (featureId: string, index: number, point: WorldMapPoint) => void
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function entryLine(worldEntryName: string | undefined): string {
  return worldEntryName ? `<br/><span style="opacity:.75">关联条目：${escapeHtml(worldEntryName)}</span>` : ""
}

function regionTooltip(region: RegionLayer): string {
  const description = region.description ? `<br/>${escapeHtml(region.description)}` : ""
  return `<strong>${escapeHtml(region.name)}</strong>${description}${entryLine(region.worldEntryName)}`
}

function placeTooltip(place: PlaceLayer): string {
  const description = place.description ? `<br/>${escapeHtml(place.description)}` : ""
  return `<strong>${escapeHtml(place.name)}</strong>${description}${entryLine(place.worldEntryName)}`
}

function pinTooltip(pin: PinLayer): string {
  const feature = pin.featureName
    ? `<br/><span style="opacity:.75">所在要素：${escapeHtml(pin.featureName)}</span>`
    : ""
  return `<strong>${escapeHtml(pin.characterName)}</strong>${feature}`
}

function pinBadge(characterName: string): string {
  const initial = [...characterName.trim()][0] ?? "?"
  return `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:#4f46e5;color:#fff;font-size:13px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${escapeHtml(initial)}</div>`
}

function placeBadge(place: PlaceLayer): string {
  return `<div style="width:14px;height:14px;border-radius:9999px;background:${escapeHtml(place.color)};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`
}

function vertexBadge(): string {
  return `<div style="width:12px;height:12px;border-radius:3px;background:#fff;border:2px solid #4f46e5;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`
}

function highlightPin(pin: L.Marker) {
  const badge = pin.getElement()?.firstElementChild
  if (badge instanceof HTMLElement) {
    badge.style.transform = "scale(1.18)"
    badge.style.boxShadow = "0 0 0 4px rgba(79, 70, 229, .25)"
  }
}

function resetPin(pin: L.Marker) {
  const badge = pin.getElement()?.firstElementChild
  if (badge instanceof HTMLElement) {
    badge.style.transform = ""
    badge.style.boxShadow = ""
  }
}

export function LocalPlaneMap(
  props: {
    model: Accessor<MapLayerModel>
    editing?: Accessor<boolean>
    tool?: Accessor<EditorTool>
    drawing?: Accessor<readonly WorldMapPoint[]>
    selection?: Accessor<MapSelection | undefined>
  } & LocalPlaneMapEvents,
) {
  let container: HTMLDivElement | undefined

  onMount(() => {
    if (!container) return
    const map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 1,
      attributionControl: false,
      maxBounds: L.latLngBounds([-800, -800], [WORLD_SIZE + 800, WORLD_SIZE + 800]),
    })
    const fitMap = () => {
      map.invalidateSize()
      map.fitBounds(
        [
          [0, 0],
          [WORLD_SIZE, WORLD_SIZE],
        ],
        { padding: [16, 16] },
      )
    }
    fitMap()
    let refittedAfterLayout = false
    let previousWidth = container.clientWidth
    let previousHeight = container.clientHeight
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
      if (
        !refittedAfterLayout &&
        (container.clientWidth !== previousWidth || container.clientHeight !== previousHeight)
      ) {
        refittedAfterLayout = true
        fitMap()
      }
    })
    resizeObserver.observe(container)
    const layerGroup = L.layerGroup().addTo(map)
    const drawingGroup = L.layerGroup().addTo(map)

    createEffect(() => {
      const model = props.model()
      const editing = props.editing?.() ?? false
      const selection = props.selection?.()
      layerGroup.clearLayers()

      for (const region of model.regions) {
        const layer = L.polygon(region.latlngs, {
          color: region.color,
          fillColor: region.color,
          fillOpacity: selection?.kind === "feature" && selection.id === region.id ? 0.28 : 0.15,
          weight: selection?.kind === "feature" && selection.id === region.id ? 4 : 2,
        })
          .bindTooltip(regionTooltip(region), { sticky: true, direction: "top", className: "map-detail-tooltip" })
          .addTo(layerGroup)
        layer.on("mouseover", () => layer.setStyle({ weight: 4, fillOpacity: 0.28 }))
        layer.on("mouseout", () =>
          layer.setStyle({
            weight: selection?.kind === "feature" && selection.id === region.id ? 4 : 2,
            fillOpacity: selection?.kind === "feature" && selection.id === region.id ? 0.28 : 0.15,
          }),
        )
        if (editing) {
          layer.on("click", (event) => {
            L.DomEvent.stopPropagation(event)
            props.onFeatureClick?.(region.id)
          })
          const selectedRegion = selection?.kind === "feature" && selection.id === region.id
          if (selectedRegion) {
            for (const [index, latlng] of region.latlngs.entries()) {
              const vertex = L.marker(latlng, {
                icon: L.divIcon({ className: "map-vertex-icon", html: vertexBadge(), iconSize: [12, 12] }),
                draggable: true,
              }).addTo(layerGroup)
              vertex.on("dragend", () => {
                const latlng = vertex.getLatLng()
                props.onVertexMove?.(region.id, index, latlngToWorldPoint(latlng))
              })
            }
          }
        }
      }

      for (const place of model.places) {
        const layer = L.marker(place.latlng, {
          icon: L.divIcon({ className: "map-place-icon", html: placeBadge(place), iconSize: [14, 14] }),
          draggable: editing,
          riseOnHover: true,
        })
          .bindTooltip(placeTooltip(place), { sticky: true, direction: "top", className: "map-detail-tooltip" })
          .addTo(layerGroup)
        layer.on("mouseover", () => {
          const badge = layer.getElement()?.firstElementChild
          if (badge instanceof HTMLElement) badge.style.transform = "scale(1.25)"
        })
        layer.on("mouseout", () => {
          const badge = layer.getElement()?.firstElementChild
          if (badge instanceof HTMLElement) badge.style.transform = ""
        })
        if (editing) {
          layer.on("click", (event) => {
            L.DomEvent.stopPropagation(event)
            props.onFeatureClick?.(place.id)
          })
          layer.on("dragend", () => props.onPlaceMove?.(place.id, latlngToWorldPoint(layer.getLatLng())))
        }
      }

      for (const pin of model.pins) {
        const layer = L.marker(pin.latlng, {
          icon: L.divIcon({ className: "map-pin-icon", html: pinBadge(pin.characterName), iconSize: [26, 26] }),
          draggable: editing,
          riseOnHover: true,
        })
          .bindTooltip(pinTooltip(pin), { sticky: true, direction: "top", className: "map-detail-tooltip" })
          .addTo(layerGroup)
        layer.on("mouseover", () => highlightPin(layer))
        layer.on("mouseout", () => resetPin(layer))
        if (editing) {
          layer.on("click", (event) => {
            L.DomEvent.stopPropagation(event)
            props.onPinClick?.(pin.id)
          })
          layer.on("dragend", () => props.onPinMove?.(pin.id, latlngToWorldPoint(layer.getLatLng())))
        }
      }
    })

    createEffect(() => {
      const points = props.drawing?.() ?? []
      drawingGroup.clearLayers()
      if (points.length === 0) return
      const latlngs = points.map((point) => L.latLng(WORLD_SIZE - point.y, point.x))
      if (latlngs.length > 1) L.polyline(latlngs, { color: "#4f46e5", weight: 3, dashArray: "6 6" }).addTo(drawingGroup)
      for (const latlng of latlngs) {
        L.circleMarker(latlng, { radius: 4, color: "#4f46e5", fillColor: "#4f46e5", fillOpacity: 1 }).addTo(
          drawingGroup,
        )
      }
    })

    createEffect(() => {
      const editing = props.editing?.() ?? false
      const tool = props.tool?.() ?? "select"
      const handleClick = (event: L.LeafletMouseEvent) => props.onMapClick?.(latlngToWorldPoint(event.latlng))
      const handleKeyDown = (event: L.LeafletKeyboardEvent) => {
        if (event.originalEvent.key === "Escape") props.onEscape?.()
      }
      if (!editing) return
      map.on("click", handleClick)
      map.on("keydown", handleKeyDown)
      onCleanup(() => {
        map.off("click", handleClick)
        map.off("keydown", handleKeyDown)
      })
    })

    onCleanup(() => {
      resizeObserver.disconnect()
      map.remove()
    })
  })

  return (
    <div ref={container} class="h-full w-full" style={{ background: "var(--v2-background-bg-layer-01, #101012)" }} />
  )
}
