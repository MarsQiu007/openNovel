import { For, Show, createMemo } from "solid-js"
import type {
  Character,
  CharacterMapPin,
  WorldEntry,
  UpdateCharacterMapPinInput,
  UpdateWorldMapFeatureInput,
  WorldMapAggregate,
  WorldMapFeature,
  WorldMapPoint,
} from "@opennovel-ai/schema/novel"
import type { Accessor } from "solid-js"
import { pinPlacementError, type EditorTool } from "./editor-model"
import type { MapSelection } from "./local-plane-map"

export type SaveFailure = { key: string; message: string }

export type MapEditorPanelProps = {
  aggregate: Accessor<WorldMapAggregate>
  characters: Accessor<readonly Character[]>
  worldEntries: Accessor<readonly WorldEntry[]>
  editing: Accessor<boolean>
  tool: Accessor<EditorTool>
  selection: Accessor<MapSelection | undefined>
  drawing: Accessor<readonly WorldMapPoint[]>
  pinCharacterId: Accessor<string>
  notice: Accessor<string | undefined>
  pendingSaves: Accessor<number>
  failures: Accessor<readonly SaveFailure[]>
  onToolChange: (tool: EditorTool) => void
  onPinCharacterChange: (characterId: string) => void
  onCompleteDrawing: () => void
  onCancelDrawing: () => void
  onFeatureField: (featureId: string, patch: UpdateWorldMapFeatureInput) => void
  onPinField: (pinId: string, patch: UpdateCharacterMapPinInput) => void
  onDeleteFeature: (feature: WorldMapFeature) => void
  onDeletePin: (pin: CharacterMapPin) => void
  onRetry: (key: string) => void
}

const TOOLS: Array<{ id: EditorTool; label: string }> = [
  { id: "select", label: "选择" },
  { id: "region", label: "区域" },
  { id: "place", label: "地点" },
  { id: "pin", label: "图钉" },
]

export function MapEditorPanel(props: MapEditorPanelProps) {
  const selectedFeature = createMemo(() => {
    const selection = props.selection()
    if (selection?.kind !== "feature") return undefined
    return props.aggregate().features.find((feature) => feature.id === selection.id)
  })

  const selectedPin = createMemo(() => {
    const selection = props.selection()
    if (selection?.kind !== "pin") return undefined
    return props.aggregate().pins.find((pin) => pin.id === selection.id)
  })

  const selectedCharacter = createMemo(() =>
    props.characters().find((character) => character.id === props.pinCharacterId()),
  )

  return (
    <Show when={props.editing()}>
      <div class="pointer-events-none absolute inset-0 z-[1000]">
        <div class="pointer-events-auto absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01/95 p-2 shadow-lg">
          <div class="flex items-center gap-1">
            <For each={TOOLS}>
              {(tool) => (
                <button
                  type="button"
                  class={
                    "rounded-md px-2.5 py-1 text-xs transition-colors " +
                    (props.tool() === tool.id
                      ? "bg-v2-background-bg-layer-03 text-v2-text-text-base"
                      : "text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base")
                  }
                  onClick={() => props.onToolChange(tool.id)}
                >
                  {tool.label}
                </button>
              )}
            </For>
          </div>

          <Show when={props.tool() === "region"}>
            <div class="flex items-center gap-1 border-l border-v2-border-border-base pl-2">
              <button
                type="button"
                disabled={props.drawing().length < 3}
                class="rounded-md bg-v2-background-bg-invert px-2 py-1 text-xs text-v2-text-text-invert hover:opacity-90 disabled:opacity-40"
                onClick={props.onCompleteDrawing}
              >
                闭合区域（{props.drawing().length}）
              </button>
              <Show when={props.drawing().length > 0}>
                <button
                  type="button"
                  class="rounded-md border border-v2-border-border-base px-2 py-1 text-xs text-v2-text-text-base hover:bg-v2-background-bg-layer-01"
                  onClick={props.onCancelDrawing}
                >
                  取消
                </button>
              </Show>
            </div>
          </Show>

          <Show when={props.tool() === "pin"}>
            <div class="flex items-center gap-2 border-l border-v2-border-border-base pl-2">
              <select
                data-testid="pin-character-select"
                class="h-7 w-40 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-xs text-v2-text-text-base"
                value={props.pinCharacterId()}
                onChange={(event) => props.onPinCharacterChange(event.currentTarget.value)}
              >
                <option value="">选择角色</option>
                <For each={props.characters()}>
                  {(character) => (
                    <option
                      value={character.id}
                      disabled={pinPlacementError(character.id, props.aggregate().pins) !== undefined}
                    >
                      {character.name}
                    </option>
                  )}
                </For>
              </select>
              <Show when={selectedCharacter() && pinPlacementError(props.pinCharacterId(), props.aggregate().pins)}>
                <span class="text-xs text-red-500">该角色已有图钉</span>
              </Show>
            </div>
          </Show>
        </div>

        <div class="pointer-events-auto absolute right-3 top-3 flex max-h-[calc(100%-24px)] w-72 flex-col overflow-hidden rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01/95 shadow-lg">
          <div class="border-b border-v2-border-border-base px-3 py-2 text-sm font-medium text-v2-text-text-base">
            属性
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <Show
              when={props.notice()}
              fallback={<p class="text-xs text-v2-text-text-muted">选择地图要素或图钉以编辑属性。</p>}
            >
              {(message) => <div class="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{message()}</div>}
            </Show>

            <Show when={selectedFeature()} fallback={<Show when={selectedPin()}>{(pin) => pinEditor(pin())}</Show>}>
              {(feature) => featureEditor(feature())}
            </Show>
          </div>
        </div>

        <Show when={props.failures().length > 0}>
          <div class="pointer-events-auto absolute bottom-12 left-3 w-80 rounded-lg border border-red-500/40 bg-red-950/95 p-3 shadow-lg">
            <div class="mb-2 text-sm font-medium text-red-200">保存失败</div>
            <div class="flex max-h-32 flex-col gap-2 overflow-y-auto">
              <For each={props.failures()}>
                {(failure) => (
                  <div class="flex items-start justify-between gap-2">
                    <span class="min-w-0 flex-1 break-words text-xs text-red-100">{failure.message}</span>
                    <button
                      type="button"
                      class="rounded border border-red-400/60 px-2 py-0.5 text-xs text-red-100 hover:bg-red-900"
                      onClick={() => props.onRetry(failure.key)}
                    >
                      重试
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={props.pendingSaves() > 0}>
          <div class="pointer-events-none absolute bottom-3 left-3 rounded-md bg-v2-background-bg-layer-01/95 px-2 py-1 text-xs text-v2-text-text-muted">
            保存中（{props.pendingSaves()}）
          </div>
        </Show>
      </div>
    </Show>
  )

  function featureEditor(feature: WorldMapFeature) {
    return (
      <>
        <EditorField label="名称">
          <input
            type="text"
            class={inputClass}
            value={feature.name}
            onInput={(event) => {
              const name = event.currentTarget.value.trim()
              if (name) props.onFeatureField(feature.id, { name })
            }}
          />
        </EditorField>
        <EditorField label="描述">
          <textarea
            class={`${inputClass} h-20 resize-none`}
            value={feature.description}
            onInput={(event) => props.onFeatureField(feature.id, { description: event.currentTarget.value })}
          />
        </EditorField>
        <EditorField label="颜色">
          <input
            type="color"
            class="h-8 w-full cursor-pointer rounded border border-v2-border-border-base bg-transparent"
            value={feature.color}
            onInput={(event) => props.onFeatureField(feature.id, { color: event.currentTarget.value })}
          />
        </EditorField>
        <EditorField label="世界观条目">
          <select
            class={inputClass}
            value={feature.worldEntryId ?? ""}
            onChange={(event) => props.onFeatureField(feature.id, { worldEntryId: event.currentTarget.value || null })}
          >
            <option value="">未关联</option>
            <For each={props.worldEntries()}>{(entry) => <option value={entry.id}>{entry.title}</option>}</For>
          </select>
        </EditorField>
        <Show when={feature.kind === "place"}>
          <div class="grid grid-cols-2 gap-2">
            <EditorField label="X">
              <input
                type="number"
                min="0"
                max="10000"
                class={inputClass}
                value={feature.x ?? 0}
                onChange={(event) => {
                  const x = event.currentTarget.valueAsNumber
                  if (Number.isFinite(x)) props.onFeatureField(feature.id, { x: Math.min(10000, Math.max(0, x)) })
                }}
              />
            </EditorField>
            <EditorField label="Y">
              <input
                type="number"
                min="0"
                max="10000"
                class={inputClass}
                value={feature.y ?? 0}
                onChange={(event) => {
                  const y = event.currentTarget.valueAsNumber
                  if (Number.isFinite(y)) props.onFeatureField(feature.id, { y: Math.min(10000, Math.max(0, y)) })
                }}
              />
            </EditorField>
          </div>
        </Show>
        <button
          type="button"
          class="mt-2 rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10"
          onClick={() => props.onDeleteFeature(feature)}
        >
          删除{feature.kind === "region" ? "区域" : "地点"}
        </button>
      </>
    )
  }

  function pinEditor(pin: CharacterMapPin) {
    const character = props.characters().find((item) => item.id === pin.characterId)
    return (
      <>
        <EditorField label="角色">
          <div class={inputClass + " opacity-80"}>{character?.name ?? pin.characterId}</div>
        </EditorField>
        <EditorField label="所在要素">
          <select
            class={inputClass}
            value={pin.featureId ?? ""}
            onChange={(event) => props.onPinField(pin.id, { featureId: event.currentTarget.value || null })}
          >
            <option value="">不关联</option>
            <For each={props.aggregate().features}>
              {(feature) => <option value={feature.id}>{feature.name}</option>}
            </For>
          </select>
        </EditorField>
        <div class="text-xs text-v2-text-text-muted">
          X {pin.x} · Y {pin.y}，可直接拖拽图钉调整位置。
        </div>
        <button
          type="button"
          class="mt-2 rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10"
          onClick={() => props.onDeletePin(pin)}
        >
          删除图钉
        </button>
      </>
    )
  }
}

const inputClass =
  "h-8 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-sm text-v2-text-text-base"

function EditorField(props: { label: string; children: import("solid-js").JSX.Element }) {
  return (
    <label class="flex flex-col gap-1">
      <span class="text-xs text-v2-text-text-muted">{props.label}</span>
      {props.children}
    </label>
  )
}
