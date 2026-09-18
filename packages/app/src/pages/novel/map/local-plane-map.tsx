import L from "leaflet"
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js"
import "leaflet/dist/leaflet.css"
import { WORLD_SIZE, type MapLayerModel, type PinLayer, type PlaceLayer, type RegionLayer } from "./view-model"

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
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
  const feature = pin.featureName ? `<br/><span style="opacity:.75">所在要素：${escapeHtml(pin.featureName)}</span>` : ""
  return `<strong>${escapeHtml(pin.characterName)}</strong>${feature}`
}

function pinBadge(characterName: string): string {
  const initial = [...characterName.trim()][0] ?? "?"
  return `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:#4f46e5;color:#fff;font-size:13px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${escapeHtml(initial)}</div>`
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

export function LocalPlaneMap(props: { model: Accessor<MapLayerModel> }) {
  let container: HTMLDivElement | undefined

  onMount(() => {
    if (!container) return
    const map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 1,
      attributionControl: false,
      maxBounds: L.latLngBounds([-800, -800], [WORLD_SIZE + 800, WORLD_SIZE + 800]),
    })
    map.fitBounds(
      [
        [0, 0],
        [WORLD_SIZE, WORLD_SIZE],
      ],
      { padding: [16, 16] },
    )
    const layerGroup = L.layerGroup().addTo(map)

    createEffect(() => {
      const model = props.model()
      layerGroup.clearLayers()

      for (const region of model.regions) {
        const layer = L.polygon(region.latlngs, {
          color: region.color,
          fillColor: region.color,
          fillOpacity: 0.15,
          weight: 2,
        })
          .bindTooltip(regionTooltip(region), { sticky: true, direction: "top", className: "map-detail-tooltip" })
          .addTo(layerGroup)
        layer.on("mouseover", () => layer.setStyle({ weight: 4, fillOpacity: 0.28 }))
        layer.on("mouseout", () => layer.setStyle({ weight: 2, fillOpacity: 0.15 }))
      }

      for (const place of model.places) {
        const layer = L.circleMarker(place.latlng, {
          radius: 7,
          color: place.color,
          fillColor: place.color,
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindTooltip(placeTooltip(place), { sticky: true, direction: "top", className: "map-detail-tooltip" })
          .addTo(layerGroup)
        layer.on("mouseover", () => layer.setStyle({ radius: 9, weight: 4, fillOpacity: 1 }))
        layer.on("mouseout", () => layer.setStyle({ radius: 7, weight: 2, fillOpacity: 0.9 }))
      }

      for (const pin of model.pins) {
        const layer = L.marker(pin.latlng, {
          icon: L.divIcon({ className: "map-pin-icon", html: pinBadge(pin.characterName), iconSize: [26, 26] }),
          riseOnHover: true,
        })
          .bindTooltip(pinTooltip(pin), { sticky: true, direction: "top", className: "map-detail-tooltip" })
          .addTo(layerGroup)
        layer.on("mouseover", () => highlightPin(layer))
        layer.on("mouseout", () => resetPin(layer))
      }
    })

    onCleanup(() => {
      map.remove()
    })
  })

  return (
    <div
      ref={container}
      class="h-full w-full"
      style={{ background: "var(--v2-background-bg-layer-01, #101012)" }}
    />
  )
}
