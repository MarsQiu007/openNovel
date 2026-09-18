import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, onCleanup, type Accessor, Show } from "solid-js"
import { Dialog } from "@opennovel-ai/ui/dialog"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { useBindSession, useNovelClient } from "@/context/novel-queries"
import { useSDK } from "@/context/sdk"
import { buildMapLayerModel } from "./map/view-model"
import { LocalPlaneMap, type MapSelection } from "./map/local-plane-map"
import { MapEditorPanel } from "./map/map-editor-panel"
import { MapAiGeneratePanel } from "./map/ai-generate-panel"
import {
  addDrawingPoint,
  clampPoint,
  completeDrawing,
  createEditorSaveQueue,
  deriveDraftCommands,
  pinPlacementError,
  replaceVertex,
  type EditorTool,
} from "./map/editor-model"
import type {
  CreateCharacterMapPinInput,
  CreateWorldMapFeatureInput,
  UpdateCharacterMapPinInput,
  UpdateWorldMapFeatureInput,
  WorldMapPoint,
} from "@opennovel-ai/schema/novel"

export default function MapView(props: { novelID: Accessor<string> }) {
  const client = useNovelClient()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const [view, setView] = createSignal<"active" | "draft">("active")
  const [editing, setEditing] = createSignal(false)
  const [tool, setTool] = createSignal<EditorTool>("select")
  const [selection, setSelection] = createSignal<MapSelection | undefined>()
  const [drawing, setDrawing] = createSignal<WorldMapPoint[]>([])
  const [pinCharacterId, setPinCharacterId] = createSignal("")
  const [notice, setNotice] = createSignal<string | undefined>()
  const [saveTick, setSaveTick] = createSignal(0)
  const saveQueue = createEditorSaveQueue(() => setSaveTick((tick) => tick + 1))
  const bindSession = useBindSession()
  const [aiPanelOpen, setAiPanelOpen] = createSignal(false)
  const [aiInstruction, setAiInstruction] = createSignal("")
  const [aiSelectedIds, setAiSelectedIds] = createSignal<Set<string> | undefined>()
  const [aiGenerating, setAiGenerating] = createSignal(false)
  const [aiError, setAiError] = createSignal<string | undefined>()

  const directory = () => sdk().directory
  const location = () => ({ directory: directory() })
  const draftMapID = () => draftQuery.data?.map.id
  const pendingSaves = createMemo(() => (saveTick(), saveQueue.size))
  const saveFailures = createMemo(() => (saveTick(), saveQueue.failures()))

  const activeQuery = useQuery(() => ({
    queryKey: ["world-map", "active", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"]["active-world-map"]({
        novelID: props.novelID(),
        location: location(),
      }),
    enabled: !!props.novelID(),
  }))

  const draftQuery = useQuery(() => ({
    queryKey: ["world-map", "draft", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"]["draft-world-map"]({
        novelID: props.novelID(),
        location: location(),
      }),
    enabled: !!props.novelID(),
  }))

  const charactersQuery = useQuery(() => ({
    queryKey: ["map-characters", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"].characters({
        novelID: props.novelID(),
        location: location(),
      }),
    enabled: !!props.novelID(),
  }))

  const worldEntriesQuery = useQuery(() => ({
    queryKey: ["map-world-entries", directory(), props.novelID()],
    queryFn: () =>
      client()["server.novel"]["world-entries"]({
        novelID: props.novelID(),
        location: location(),
      }),
    enabled: !!props.novelID(),
  }))

  const mapAiEntries = createMemo(() =>
    (worldEntriesQuery.data ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      content: entry.content,
    })),
  )
  createEffect(() => {
    const entries = mapAiEntries()
    if (worldEntriesQuery.isSuccess && aiSelectedIds() === undefined) {
      setAiSelectedIds(new Set(entries.map((entry) => entry.id)))
    }
  })

  const invalidateDraft = async () => {
    await queryClient.invalidateQueries({ queryKey: ["world-map", "draft", directory(), props.novelID()] })
  }

  const requireDraftMapID = () => {
    const mapID = draftMapID()
    if (!mapID) throw new Error("草稿尚未就绪")
    return mapID
  }

  const randomSaveKey = (prefix: string) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`

  const scheduleCreateFeature = (input: CreateWorldMapFeatureInput) => {
    saveQueue.schedule(randomSaveKey("create-feature"), async () => {
      await client()["server.novel"]["create-world-map-feature"]({
        novelID: props.novelID(),
        mapID: requireDraftMapID(),
        location: location(),
        ...input,
      })
      await invalidateDraft()
    })
  }

  const scheduleCreatePin = (input: CreateCharacterMapPinInput) => {
    saveQueue.schedule(randomSaveKey("create-pin"), async () => {
      await client()["server.novel"]["create-character-map-pin"]({
        novelID: props.novelID(),
        mapID: requireDraftMapID(),
        location: location(),
        ...input,
      })
      await invalidateDraft()
    })
  }

  const scheduleFeatureUpdate = (featureID: string, patch: UpdateWorldMapFeatureInput) => {
    const fields = Object.keys(patch).sort().join("+")
    saveQueue.schedule(`feature:${featureID}:${fields}`, async () => {
      await client()["server.novel"]["update-world-map-feature"]({
        novelID: props.novelID(),
        mapID: requireDraftMapID(),
        featureID,
        location: location(),
        ...patch,
      })
      await invalidateDraft()
    })
  }

  const schedulePinUpdate = (pinID: string, patch: UpdateCharacterMapPinInput) => {
    const fields = Object.keys(patch).sort().join("+")
    saveQueue.schedule(`pin:${pinID}:${fields}`, async () => {
      await client()["server.novel"]["update-character-map-pin"]({
        novelID: props.novelID(),
        mapID: requireDraftMapID(),
        pinID,
        location: location(),
        ...patch,
      })
      await invalidateDraft()
    })
  }

  const createBlankMutation = useMutation(() => ({
    mutationFn: async () => {
      await client()["server.novel"]["create-world-map"]({
        novelID: props.novelID(),
        location: location(),
        title: "未命名地图",
        description: "",
        status: "draft",
      })
      await invalidateDraft()
    },
    onSuccess: () => {
      setView("draft")
      setEditing(true)
      resetEditorState()
    },
    onError: (error) => setNotice(error.message),
  }))

  const deriveMutation = useMutation(() => ({
    mutationFn: async () => {
      const active = activeQuery.data
      if (!active) throw new Error("没有可派生的正式地图")
      const draft = await client()["server.novel"]["create-world-map"]({
        novelID: props.novelID(),
        location: location(),
        title: active.map.title || "未命名地图",
        description: active.map.description,
        status: "draft",
      })
      try {
        for (const command of deriveDraftCommands(active)) {
          if (command.kind === "feature") {
            await client()["server.novel"]["create-world-map-feature"]({
              novelID: props.novelID(),
              mapID: draft.id,
              location: location(),
              ...command.input,
            })
          } else {
            await client()["server.novel"]["create-character-map-pin"]({
              novelID: props.novelID(),
              mapID: draft.id,
              location: location(),
              ...command.input,
            })
          }
        }
      } catch (error) {
        await client()["server.novel"]["delete-world-map"]({
          novelID: props.novelID(),
          mapID: draft.id,
          location: location(),
        })
        throw error
      }
      await invalidateDraft()
    },
    onSuccess: () => {
      setView("draft")
      setEditing(true)
      resetEditorState()
    },
    onError: (error) => setNotice(error.message),
  }))

  const deleteItemMutation = useMutation(() => ({
    mutationFn: async (input: { kind: "feature" | "pin"; id: string }) => {
      if (input.kind === "feature") {
        await client()["server.novel"]["delete-world-map-feature"]({
          novelID: props.novelID(),
          mapID: requireDraftMapID(),
          featureID: input.id,
          location: location(),
        })
      } else {
        await client()["server.novel"]["delete-character-map-pin"]({
          novelID: props.novelID(),
          mapID: requireDraftMapID(),
          pinID: input.id,
          location: location(),
        })
      }
      await invalidateDraft()
    },
    onSuccess: () => setSelection(undefined),
    onError: (error) => setNotice(error.message),
  }))

  const abandonMutation = useMutation(() => ({
    mutationFn: async (mapID: string) => {
      saveQueue.clear()
      await client()["server.novel"]["delete-world-map"]({
        novelID: props.novelID(),
        mapID,
        location: location(),
      })
      await invalidateDraft()
    },
    onSuccess: () => {
      setEditing(false)
      setView("active")
      resetEditorState()
    },
    onError: (error) => setNotice(error.message),
  }))

  const promoteMutation = useMutation(() => ({
    mutationFn: (mapID: string) =>
      client()["server.novel"]["promote-world-map"]({
        novelID: props.novelID(),
        mapID,
        location: location(),
      }),
    onSuccess: () => {
      saveQueue.clear()
      void queryClient.invalidateQueries({ queryKey: ["world-map", "active", directory(), props.novelID()] })
      void invalidateDraft()
      setEditing(false)
      setView("active")
      resetEditorState()
    },
    onError: (error) => setNotice(error.message),
  }))

  let hadDraft = false
  createEffect(() => {
    if (!draftQuery.isSuccess) return
    const draft = draftQuery.data
    if (draft && !hadDraft) {
      setView("draft")
      setEditing(true)
      resetEditorState()
    }
    hadDraft = !!draft
  })

  createEffect(() => {
    saveTick()
    if (saveQueue.size === 0) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    onCleanup(() => window.removeEventListener("beforeunload", handleBeforeUnload))
  })

  function resetEditorState() {
    setSelection(undefined)
    setDrawing([])
    setTool("select")
    setPinCharacterId("")
    setNotice(undefined)
  }

  const switchView = (target: "active" | "draft") => {
    setView(target)
    setEditing(target === "draft" && !!draftQuery.data)
    resetEditorState()
  }

  const handleToolChange = (nextTool: EditorTool) => {
    setTool(nextTool)
    setDrawing([])
    setSelection(undefined)
    setNotice(undefined)
  }

  const handleMapClick = (worldPoint: ReturnType<typeof clampPoint>) => {
    setNotice(undefined)
    if (tool() === "select") {
      setSelection(undefined)
      return
    }
    const point = clampPoint(worldPoint)
    if (tool() === "region") {
      setDrawing(addDrawingPoint(drawing(), point))
      return
    }
    if (tool() === "place") {
      scheduleCreateFeature({
        kind: "place",
        name: "未命名地点",
        description: "",
        color: "#4f46e5",
        worldEntryId: null,
        x: point.x,
        y: point.y,
      })
      return
    }
    const characterId = pinCharacterId()
    if (!characterId) {
      setNotice("请先选择要安放图钉的角色")
      return
    }
    const placementError = pinPlacementError(characterId, draftQuery.data?.pins ?? [])
    if (placementError) {
      setNotice(placementError)
      return
    }
    scheduleCreatePin({ characterId, featureId: null, x: point.x, y: point.y })
  }

  const handleEscape = () => {
    if (drawing().length > 0) {
      setDrawing([])
      return
    }
    setTool("select")
    setSelection(undefined)
  }

  const handleCompleteDrawing = () => {
    const result = completeDrawing(drawing())
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    scheduleCreateFeature({
      kind: "region",
      name: "未命名区域",
      description: "",
      color: "#22c55e",
      worldEntryId: null,
      polygon: result.polygon,
    })
    setDrawing([])
  }

  const handleFeatureField = (featureID: string, patch: UpdateWorldMapFeatureInput) => {
    setNotice(undefined)
    if (patch.name !== undefined && !patch.name.trim()) {
      setNotice("要素名称不能为空")
      return
    }
    scheduleFeatureUpdate(featureID, patch)
  }

  const handlePinField = (pinID: string, patch: UpdateCharacterMapPinInput) => {
    setNotice(undefined)
    schedulePinUpdate(pinID, patch)
  }

  const showConfirm = (input: {
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
  }) => {
    dialog.show(() => (
      <Dialog size="normal" transition>
        <div class="flex flex-col gap-4 p-6">
          <div class="flex flex-col gap-2">
            <h3 class="text-base font-medium text-v2-text-text-base">{input.title}</h3>
            <p class="text-sm text-v2-text-text-muted">{input.message}</p>
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
              class={
                "rounded-md px-3 py-1.5 text-sm text-white hover:opacity-90 " +
                (input.danger ? "bg-red-600 hover:bg-red-500" : "bg-v2-background-bg-invert")
              }
              onClick={() => {
                dialog.close()
                input.onConfirm()
              }}
            >
              {input.confirmLabel}
            </button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const selectedAiEntryIds = createMemo(() => aiSelectedIds() ?? new Set(mapAiEntries().map((entry) => entry.id)))

  const toggleAiEntry = (id: string) => {
    const next = new Set(selectedAiEntryIds())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setAiSelectedIds(next)
  }

  const selectAllAiEntries = () => setAiSelectedIds(new Set(mapAiEntries().map((entry) => entry.id)))

  const draftSignature = (aggregate?: { map: { id: string }; features: readonly unknown[]; pins: readonly unknown[] } | null) =>
    aggregate
      ? `${aggregate.map.id}:${JSON.stringify(aggregate.features)}:${JSON.stringify(aggregate.pins)}`
      : ""

  const buildMapAiPrompt = () => {
    const selectedIds = selectedAiEntryIds()
    const entries = mapAiEntries().filter((entry) => selectedIds.has(entry.id))
    const entryLines = entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category || "未分类",
      summary: entry.content.replace(/\s+/g, " ").trim().slice(0, 600),
    }))
    const sections = [
      "请基于小说世界观条目生成一个 0..10000 平面坐标世界地图草稿，并调用 write_world_map_draft 写入。",
      "\n## 画布约定\n"
        + "- x 向东增大，y 向南增大，坐标必须是 0..10000。\n"
        + "- region 必须提供至少 3 个顶点的 polygon；place 必须提供 x/y。\n"
        + "- 保持区域和地点合理间距，方位关系要符合设定和用户指令。\n"
        + "- 不要生成角色图钉。\n"
        + "- worldEntryId 只能使用下列条目 ID；没有对应条目时用 null。",
      "\n## 世界观条目\n"
        + (entryLines.length > 0
          ? entryLines.map((entry, index) => `${index + 1}. ${JSON.stringify(entry)}`).join("\n")
          : "-（当前小说暂无世界观条目，请基于小说类型生成基础地理轮廓）"),
      `\n## 用户布局指令\n${aiInstruction().trim() || "无"}`,
      `\n## 目标小说\nnovel_id: ${props.novelID()}\nallow_replace: true}`,
      "\n## 写入规则\n"
        + "- title 和 description 使用简体中文，description 为一句话地图概述。\n"
        + "- features 是 region/place 数组；name、description、color、worldEntryId 必须明确。\n"
        + "- 调用 write_world_map_draft 时把完整地图数据放进 features_json。\n"
        + "- 如果写入工具返回校验失败，根据错误修正后最多自动重试一次；第二次失败必须停止并说明原因。",
    ]
    return sections.join("\n")
  }

  const generateAiDraft = async () => {
    setAiGenerating(true)
    setAiError(undefined)
    const before = draftSignature(draftQuery.data)
    try {
      const sessionResponse = await sdk().client.v2.session.create({ location: { directory: directory() } })
      const session = sessionResponse.data?.data
      if (!session) throw new Error("创建生成会话失败")
      await bindSession.mutateAsync({ novelID: props.novelID(), sessionID: session.id })
      await sdk().client.v2.session.prompt({
        sessionID: session.id,
        prompt: { text: buildMapAiPrompt() },
      })
      await sdk().client.v2.session.wait({ sessionID: session.id })
      await invalidateDraft()
      const after = draftQuery.data
      if (!after || draftSignature(after) === before) {
        throw new Error("AI 未写入新的地图草稿，请查看会话输出后重试")
      }
      setAiPanelOpen(false)
      setView("draft")
      setEditing(true)
      resetEditorState()
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error))
    } finally {
      setAiGenerating(false)
    }
  }

  const submitAiGeneration = () => {
    setAiError(undefined)
    const draft = draftQuery.data
    if (!draft || (draft.features.length === 0 && draft.pins.length === 0)) {
      void generateAiDraft()
      return
    }
    showConfirm({
      title: "覆盖现有地图草稿？",
      message: `AI 生成将替换当前草稿的 ${draft.features.length} 个要素和 ${draft.pins.length} 个图钉，正式地图不受影响。此操作无法恢复。`,
      confirmLabel: "确认生成",
      danger: true,
      onConfirm: () => void generateAiDraft(),
    })
  }

  const openPromoteConfirm = () => {
    const draft = draftQuery.data
    if (!draft) return
    const active = activeQuery.data
    showConfirm({
      title: "确认生效地图草稿？",
      message: active
        ? `将替换正式地图「${active.map.title || "未命名地图"}」（${active.features.length} 个要素、${active.pins.length} 个角色图钉）。替换后旧正式地图无法恢复，请确认。`
        : "当前没有正式世界地图，草稿将直接成为正式地图。",
      confirmLabel: "确认生效",
      onConfirm: () => promoteMutation.mutate(draft.map.id),
    })
  }

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

  return (
    <div class="flex flex-1 flex-col min-h-0 gap-3">
      <Show when={activeQuery.isSuccess || draftQuery.isSuccess} fallback={<MapLoading />}>
        <Show
          when={activeQuery.data || draftQuery.data}
          fallback={
            <div class="relative flex flex-1 min-h-0">
              <EmptyMapState
                creating={createBlankMutation.isPending}
                generating={aiGenerating()}
                onCreate={() => createBlankMutation.mutate()}
                onGenerate={() => setAiPanelOpen(true)}
              />
              <Show when={aiPanelOpen()}>
                <MapAiGeneratePanel
                  entries={mapAiEntries()}
                  selectedEntryIds={selectedAiEntryIds}
                  instruction={aiInstruction}
                  generating={aiGenerating}
                  error={aiError}
                  onClose={() => !aiGenerating() && setAiPanelOpen(false)}
                  onToggleEntry={toggleAiEntry}
                  onSelectAll={selectAllAiEntries}
                  onClear={() => setAiSelectedIds(new Set<string>())}
                  onInstructionChange={setAiInstruction}
                  onSubmit={submitAiGeneration}
                />
              </Show>
            </div>
          }
        >
          <div class="flex items-center justify-between shrink-0">
            <div class="flex items-center gap-1 rounded-lg border border-v2-border-border-base p-0.5">
              <MapTabButton active={view() === "active"} onClick={() => switchView("active")} label="正式地图" />
              <MapTabButton active={view() === "draft"} onClick={() => switchView("draft")} label="草稿" />
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                disabled={aiGenerating()}
                class="rounded-md border border-v2-border-border-base px-3 py-1.5 text-sm text-v2-text-text-base hover:bg-v2-background-bg-layer-01 disabled:opacity-50"
                onClick={() => setAiPanelOpen(true)}
              >
                AI 生成
              </button>
              <Show when={!draftQuery.data && activeQuery.data}>
                <button
                  type="button"
                  disabled={deriveMutation.isPending}
                  class="rounded-md bg-v2-background-bg-invert px-3 py-1.5 text-sm text-v2-text-text-invert hover:opacity-90 disabled:opacity-50"
                  onClick={() => deriveMutation.mutate()}
                >
                  从正式地图派生草稿
                </button>
              </Show>
              <Show when={draftQuery.data}>
                <Show
                  when={editing()}
                  fallback={
                    <button
                      type="button"
                      class="rounded-md bg-v2-background-bg-invert px-3 py-1.5 text-sm text-v2-text-text-invert hover:opacity-90"
                      onClick={() => switchView("draft")}
                    >
                      编辑草稿
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="rounded-md border border-v2-border-border-base px-3 py-1.5 text-sm text-v2-text-text-base hover:bg-v2-background-bg-layer-01"
                    onClick={() => switchView("active")}
                  >
                    退出编辑
                  </button>
                </Show>
                <button
                  type="button"
                  disabled={promoteMutation.isPending || pendingSaves() > 0}
                  class="rounded-md bg-v2-background-bg-invert px-3 py-1.5 text-sm text-v2-text-text-invert hover:opacity-90 disabled:opacity-50"
                  onClick={openPromoteConfirm}
                >
                  确认生效
                </button>
                <button
                  type="button"
                  disabled={abandonMutation.isPending}
                  class="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                  onClick={() => {
                    const draft = draftQuery.data
                    if (!draft) return
                    showConfirm({
                      title: "放弃草稿？",
                      message: "将删除草稿及其全部要素和图钉，正式地图不受影响。此操作无法恢复。",
                      confirmLabel: "放弃草稿",
                      danger: true,
                      onConfirm: () => abandonMutation.mutate(draft.map.id),
                    })
                  }}
                >
                  放弃草稿
                </button>
              </Show>
            </div>
          </div>
          <div class="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-v2-border-border-base">
            <Show when={aiPanelOpen()}>
              <MapAiGeneratePanel
                entries={mapAiEntries()}
                selectedEntryIds={selectedAiEntryIds}
                instruction={aiInstruction}
                generating={aiGenerating}
                error={aiError}
                onClose={() => !aiGenerating() && setAiPanelOpen(false)}
                onToggleEntry={toggleAiEntry}
                onSelectAll={selectAllAiEntries}
                onClear={() => setAiSelectedIds(new Set<string>())}
                onInstructionChange={setAiInstruction}
                onSubmit={submitAiGeneration}
              />
            </Show>
            <Show when={layerModel()} fallback={<MapLoading />}>
              {(model) => (
                <>
                  <LocalPlaneMap
                    model={model}
                    editing={editing}
                    tool={tool}
                    drawing={drawing}
                    selection={selection}
                    onMapClick={handleMapClick}
                    onEscape={handleEscape}
                    onFeatureClick={(featureId) => {
                      setNotice(undefined)
                      setSelection({ kind: "feature", id: featureId })
                    }}
                    onPinClick={(pinId) => {
                      setNotice(undefined)
                      setSelection({ kind: "pin", id: pinId })
                    }}
                    onPlaceMove={(featureId, point) => scheduleFeatureUpdate(featureId, { x: point.x, y: point.y })}
                    onPinMove={(pinId, point) => schedulePinUpdate(pinId, { x: point.x, y: point.y })}
                    onVertexMove={(featureId, index, point) => {
                      const feature = draftQuery.data?.features.find((item) => item.id === featureId)
                      if (!feature) return
                      scheduleFeatureUpdate(featureId, { polygon: replaceVertex(feature.polygon, index, point) })
                    }}
                  />
                  <MapEditorPanel
                    aggregate={() => draftQuery.data ?? activeQuery.data!}
                    characters={() => charactersQuery.data ?? []}
                    worldEntries={() => worldEntriesQuery.data ?? []}
                    editing={editing}
                    tool={tool}
                    selection={selection}
                    drawing={drawing}
                    pinCharacterId={pinCharacterId}
                    notice={notice}
                    pendingSaves={pendingSaves}
                    failures={saveFailures}
                    onToolChange={handleToolChange}
                    onPinCharacterChange={(characterId) => {
                      setPinCharacterId(characterId)
                      setNotice(undefined)
                    }}
                    onCompleteDrawing={handleCompleteDrawing}
                    onCancelDrawing={() => setDrawing([])}
                    onFeatureField={handleFeatureField}
                    onPinField={handlePinField}
                    onDeleteFeature={(feature) => {
                      showConfirm({
                        title: `删除${feature.kind === "region" ? "区域" : "地点"}？`,
                        message: `「${feature.name}」将从草稿中删除，此操作无法恢复。`,
                        confirmLabel: "删除",
                        danger: true,
                        onConfirm: () => deleteItemMutation.mutate({ kind: "feature", id: feature.id }),
                      })
                    }}
                    onDeletePin={(pin) => {
                      const character = charactersQuery.data?.find((item) => item.id === pin.characterId)
                      showConfirm({
                        title: "删除图钉？",
                        message: `将移除「${character?.name ?? pin.characterId}」的地图图钉，此操作无法恢复。`,
                        confirmLabel: "删除",
                        danger: true,
                        onConfirm: () => deleteItemMutation.mutate({ kind: "pin", id: pin.id }),
                      })
                    }}
                    onRetry={(key) => void saveQueue.retry(key)}
                  />
                </>
              )}
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
  return <div class="flex h-full items-center justify-center text-sm text-v2-text-text-muted">地图加载中…</div>
}

function EmptyMapState(props: { creating: boolean; generating: boolean; onCreate: () => void; onGenerate: () => void }) {
  return (
    <div class="flex flex-1 items-center justify-center min-h-0">
      <div class="text-center max-w-sm px-6">
        <div class="mx-auto mb-4 w-16 h-16 rounded-full bg-v2-background-bg-layer-01 border border-v2-border-border-base flex items-center justify-center text-2xl text-v2-text-text-faint">
          ◈
        </div>
        <h3 class="text-base font-medium text-v2-text-text-base mb-1">还没有世界地图</h3>
        <p class="text-sm text-v2-text-text-muted mb-4">创建一个空白地图草稿，手动绘制区域、放置地点并安放角色图钉。</p>
        <div class="flex justify-center gap-2">
          <button
            type="button"
            disabled={props.creating || props.generating}
            class="rounded-md bg-v2-background-bg-invert px-4 py-2 text-sm text-v2-text-text-invert hover:opacity-90 disabled:opacity-50"
            onClick={props.onCreate}
          >
            创建地图草稿
          </button>
          <button
            type="button"
            disabled={props.generating}
            class="rounded-md border border-v2-border-border-base px-4 py-2 text-sm text-v2-text-text-base hover:bg-v2-background-bg-layer-01 disabled:opacity-50"
            onClick={props.onGenerate}
          >
            AI 生成
          </button>
        </div>
      </div>
    </div>
  )
}
