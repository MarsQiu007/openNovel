import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, type Accessor, Show } from "solid-js"
import { Dialog } from "@opennovel-ai/ui/dialog"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { useNovelClient } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { buildMapLayerModel } from "./map/view-model"
import { LocalPlaneMap } from "./map/local-plane-map"

export default function MapView(props: { novelID: Accessor<string> }) {
  const client = useNovelClient()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const [view, setView] = createSignal<"active" | "draft">("active")

  const directory = () => sdk().directory

  const activeQuery = useQuery(() => ({
    queryKey: ["world-map", "active", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"]["active-world-map"]({
        novelID: props.novelID(),
        location: { directory: directory() },
      }),
    enabled: !!props.novelID(),
  }))

  const draftQuery = useQuery(() => ({
    queryKey: ["world-map", "draft", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"]["draft-world-map"]({
        novelID: props.novelID(),
        location: { directory: directory() },
      }),
    enabled: !!props.novelID(),
  }))

  const charactersQuery = useQuery(() => ({
    queryKey: ["map-characters", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"].characters({
        novelID: props.novelID(),
        location: { directory: directory() },
      }),
    enabled: !!props.novelID(),
  }))

  const worldEntriesQuery = useQuery(() => ({
    queryKey: ["map-world-entries", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"]["world-entries"]({
        novelID: props.novelID(),
        location: { directory: directory() },
      }),
    enabled: !!props.novelID(),
  }))

  const promoteMutation = useMutation(() => ({
    mutationFn: (mapID: string) =>
      client()["server.novel"]["promote-world-map"]({
        novelID: props.novelID(),
        mapID,
        location: { directory: directory() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["world-map", "active"] })
      void queryClient.invalidateQueries({ queryKey: ["world-map", "draft"] })
      setView("active")
    },
  }))

  createEffect(() => {
    if (!activeQuery.isSuccess || !draftQuery.isSuccess) return
    if (!activeQuery.data && draftQuery.data) setView("draft")
  })

  const currentAggregate = createMemo(() => (view() === "active" ? activeQuery.data : draftQuery.data))

  const layerModel = createMemo(() => {
    const aggregate = currentAggregate()
    if (!aggregate) return undefined
    return buildMapLayerModel({
      aggregate,
      characters: charactersQuery.data ?? [],
      worldEntries: (worldEntriesQuery.data ?? []).map((entry) => ({ id: entry.id, name: entry.title })),
    })
  })

  const openPromoteConfirm = () => {
    const draft = draftQuery.data
    if (!draft) return
    const active = activeQuery.data
    dialog.show(() => (
      <Dialog size="normal" transition>
        <div class="flex flex-col gap-4 p-6">
          <div class="flex flex-col gap-2">
            <h3 class="text-base font-medium text-v2-text-text-base">确认生效地图草稿？</h3>
            <Show
              when={active}
              fallback={<p class="text-sm text-v2-text-text-muted">当前没有正式世界地图，草稿将直接成为正式地图。</p>}
            >
              {(activeAggregate) => (
                <p class="text-sm text-v2-text-text-muted">
                  将替换正式地图「{activeAggregate().map.title || "未命名地图"}」（
                  {activeAggregate().features.length} 个要素、{activeAggregate().pins.length} 个角色图钉）。
                  替换后旧正式地图无法恢复，请确认。
                </p>
              )}
            </Show>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-md border border-v2-border-border-base px-3 py-1.5 text-sm text-v2-text-text-base hover:bg-v2-background-bg-layer-01"
              onClick={() => dialog.close()}
            >
              取消
            </button>
            <button
              type="button"
              disabled={promoteMutation.isPending}
              class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50"
              onClick={() => promoteMutation.mutate(draft.map.id)}
            >
              确认生效
            </button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <div class="flex flex-1 flex-col min-h-0 gap-3">
      <Show when={activeQuery.isSuccess || draftQuery.isSuccess} fallback={<MapLoading />}>
        <Show when={activeQuery.data || draftQuery.data} fallback={<EmptyMapState />}>
          <div class="flex items-center justify-between shrink-0">
            <div class="flex items-center gap-1 rounded-lg border border-v2-border-border-base p-0.5">
              <MapTabButton active={view() === "active"} onClick={() => setView("active")} label="正式地图" />
              <MapTabButton active={view() === "draft"} onClick={() => setView("draft")} label="草稿" />
            </div>
            <Show when={view() === "draft" && draftQuery.data}>
              <div class="flex items-center gap-3">
                <span class="text-xs text-v2-text-text-muted">当前查看草稿，正式地图不受影响</span>
                <button
                  type="button"
                  class="rounded-md bg-v2-background-bg-invert px-3 py-1.5 text-sm text-v2-text-text-invert hover:opacity-90"
                  onClick={openPromoteConfirm}
                >
                  确认生效
                </button>
              </div>
            </Show>
          </div>
          <div class="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-v2-border-border-base">
            <Show when={layerModel()} fallback={<MapLoading />}>
              {(model) => <LocalPlaneMap model={model} />}
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function MapTabButton(props: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={
        "rounded-md px-3 py-1 text-sm transition-colors " +
        (props.active
          ? "bg-v2-background-bg-layer-02 text-v2-text-text-base"
          : "text-v2-text-text-muted hover:text-v2-text-text-base")
      }
    >
      {props.label}
    </button>
  )
}

function MapLoading() {
  return (
    <div class="flex h-full items-center justify-center text-sm text-v2-text-text-muted">地图加载中…</div>
  )
}

function EmptyMapState() {
  return (
    <div class="flex flex-1 items-center justify-center min-h-0">
      <div class="text-center max-w-sm px-6">
        <div class="mx-auto mb-4 w-16 h-16 rounded-full bg-v2-background-bg-layer-01 border border-v2-border-border-base flex items-center justify-center text-2xl text-v2-text-text-faint">
          ◈
        </div>
        <h3 class="text-base font-medium text-v2-text-text-base mb-1">还没有世界地图</h3>
        <p class="text-sm text-v2-text-text-muted">
          地图创建能力将在后续版本提供，届时可手动绘制或由 AI 生成世界地图草稿。
        </p>
      </div>
    </div>
  )
}
