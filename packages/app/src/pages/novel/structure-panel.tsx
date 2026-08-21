import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useStoryArcs,
  useStructure,
  useCreateArc,
  useCreateBeat,
  useEditorialReports,
  useCreateEditorialReport,
  useVolumeReviews,
} from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"

type StructurePanelProps = {
  novelID: Accessor<string>
  selectedVolumeId: Accessor<string | null>
}

const arcTypeLabel: Record<string, string> = {
  narrative: "主线",
  character: "角色弧",
  subplot: "支线",
}

const arcStatusLabel: Record<string, string> = {
  planned: "规划中",
  active: "进行中",
  completed: "已完成",
  abandoned: "已弃用",
}

const beatKindLabel: Record<string, string> = {
  setup: "开场",
  rising: "升温",
  turn: "转折",
  midpoint: "中点",
  crisis: "危机",
  climax: "高潮",
  resolution: "结局",
  note: "备注",
}

const beatKindColor: Record<string, string> = {
  setup: "bg-v2-bg-secondary",
  rising: "bg-blue-500/20 text-blue-300",
  turn: "bg-amber-500/20 text-amber-300",
  midpoint: "bg-purple-500/20 text-purple-300",
  crisis: "bg-orange-500/20 text-orange-300",
  climax: "bg-red-500/20 text-red-300",
  resolution: "bg-green-500/20 text-green-300",
  note: "bg-v2-bg-secondary text-v2-text-muted",
}

const arcStatusColor: Record<string, string> = {
  planned: "text-v2-text-muted",
  active: "text-blue-400",
  completed: "text-green-400",
  abandoned: "text-red-400",
}

export default function StructurePanel(props: StructurePanelProps) {
  const structure = useStructure(props.novelID)
  const arcs = useStoryArcs(props.novelID)
  const editorial = useEditorialReports(props.novelID)
  const createArc = useCreateArc()
  const createBeat = useCreateBeat()
  const createReport = useCreateEditorialReport()
  const [showAddArc, setShowAddArc] = createSignal(false)
  const [newArcType, setNewArcType] = createSignal("narrative")
  const [newArcTitle, setNewArcTitle] = createSignal("")
  const [expandedArc, setExpandedArc] = createSignal<string | null>(null)
  const [showAddBeat, setShowAddBeat] = createSignal<string | null>(null)
  const [newBeatLabel, setNewBeatLabel] = createSignal("")
  const [newBeatKind, setNewBeatKind] = createSignal("note")

  const volumes = createMemo(() => structure.data?.volumes ?? [])
  const selectedVolume = createMemo(() =>
    volumes().find((v) => v.id === props.selectedVolumeId()),
  )

  const volumeReviews = useVolumeReviews(
    props.novelID,
    createMemo(() => selectedVolume()?.id ?? ""),
  )

  const chapterMap = createMemo(() => {
    const map = new Map<string, { order: number; title: string }>()
    for (const ch of structure.data?.chapters ?? []) {
      map.set(ch.id, { order: ch.order, title: ch.title })
    }
    return map
  })

  function handleCreateArc() {
    if (!newArcTitle().trim()) return
    createArc.mutate({
      novelID: props.novelID(),
      arcType: newArcType() as "narrative" | "character" | "subplot",
      title: newArcTitle().trim(),
    })
    setNewArcTitle("")
    setShowAddArc(false)
  }

  function handleCreateBeat(arcId: string) {
    if (!newBeatLabel().trim()) return
    createBeat.mutate({
      novelID: props.novelID(),
      arcId,
      label: newBeatLabel().trim(),
      kind: newBeatKind() as "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note",
    })
    setNewBeatLabel("")
    setShowAddBeat(null)
  }

  function runEditorialReview() {
    createReport.mutate({ novelID: props.novelID() })
  }

  return (
    <div class="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      <Show when={structure.isLoading}>
        <Spinner />
      </Show>

      <Show when={!structure.isLoading}>
        {/* 主编视角 */}
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-v2-text-primary">主编视角</h3>
            <ButtonV2 size="small" variant="outline" onClick={runEditorialReview} loading={createReport.isPending}>
              运行检查
            </ButtonV2>
          </div>
          <Show when={editorial.data?.[0]}>
            {(report) => (
              <div class="rounded border border-v2-border-default p-2 text-xs">
                <p class="text-v2-text-secondary mb-1">{report().summary}</p>
                <div class="text-v2-text-muted">
                  {report().recommendations?.length ?? 0} 条建议
                </div>
              </div>
            )}
          </Show>
        </section>

        {/* 结构线 */}
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-v2-text-primary">结构线</h3>
            <ButtonV2 size="small" variant="ghost" onClick={() => setShowAddArc(!showAddArc())}>
              {showAddArc() ? "取消" : "+ 新增"}
            </ButtonV2>
          </div>

          <Show when={showAddArc()}>
            <div class="flex flex-col gap-1.5 rounded border border-v2-border-default p-2">
              <SelectV2
                options={["narrative", "character", "subplot"]}
                current={newArcType() as "narrative" | "character" | "subplot"}
                label={(t) => arcTypeLabel[t] ?? t}
                onSelect={(t) => t && setNewArcType(t)}
              />
              <TextInputV2
                placeholder="结构线标题"
                value={newArcTitle()}
                onInput={(e) => setNewArcTitle(e.currentTarget.value)}
              />
              <ButtonV2 size="small" onClick={handleCreateArc}>创建</ButtonV2>
            </div>
          </Show>

          <Show when={arcs.data?.length === 0 && !showAddArc()}>
            <p class="text-xs text-v2-text-muted py-2">暂无结构线，点击新增开始规划。</p>
          </Show>

          <For each={arcs.data ?? []}>
            {(arc) => (
              <div class="rounded border border-v2-border-default">
                <button
                  class="w-full flex items-center justify-between p-2 text-left hover:bg-v2-bg-secondary"
                  onClick={() => setExpandedArc(expandedArc() === arc.id ? null : arc.id)}
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-xs px-1.5 py-0.5 rounded bg-v2-bg-secondary text-v2-text-muted shrink-0">
                      {arcTypeLabel[arc.arcType] ?? arc.arcType}
                    </span>
                    <span class="text-sm font-medium text-v2-text-primary truncate">{arc.title}</span>
                  </div>
                  <span class={`text-xs ${arcStatusColor[arc.status] ?? ""}`}>
                    {arcStatusLabel[arc.status] ?? arc.status}
                  </span>
                </button>

                <Show when={expandedArc() === arc.id}>
                  <div class="border-t border-v2-border-default p-2 flex flex-col gap-1.5">
                    <Show when={arc.summary}>
                      <p class="text-xs text-v2-text-secondary">{arc.summary}</p>
                    </Show>
                    <div class="flex gap-2 text-xs text-v2-text-muted">
                      <Show when={arc.plannedStartChapter != null}>
                        <span>规划: 第{arc.plannedStartChapter}-{arc.plannedEndChapter ?? "?"}章</span>
                      </Show>
                    </div>

                    {/* 节点列表 */}
                    <StructureBeats
                      beats={structure.data?.beats ?? []}
                      arcId={arc.id}
                    />

                    <Show when={showAddBeat() === arc.id}>
                      <div class="flex flex-col gap-1.5 mt-1">
                        <SelectV2
                          options={["setup", "rising", "turn", "midpoint", "crisis", "climax", "resolution", "note"]}
                          current={newBeatKind() as "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"}
                          label={(k) => beatKindLabel[k] ?? k}
                          onSelect={(k) => k && setNewBeatKind(k)}
                        />
                        <TextInputV2
                          placeholder="节点标题"
                          value={newBeatLabel()}
                          onInput={(e) => setNewBeatLabel(e.currentTarget.value)}
                        />
                        <div class="flex gap-1.5">
                          <ButtonV2 size="small" onClick={() => handleCreateBeat(arc.id)}>添加</ButtonV2>
                          <ButtonV2 size="small" variant="ghost" onClick={() => setShowAddBeat(null)}>取消</ButtonV2>
                        </div>
                      </div>
                    </Show>
                    <Show when={showAddBeat() !== arc.id}>
                      <ButtonV2 size="small" variant="ghost" onClick={() => setShowAddBeat(arc.id)}>
                        + 添加节点
                      </ButtonV2>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </section>

        {/* 卷末复盘 */}
        <Show when={selectedVolume()}>
          <section class="flex flex-col gap-2">
            <h3 class="text-sm font-semibold text-v2-text-primary">
              {selectedVolume()!.title} - 复盘
            </h3>
            <Show when={volumeReviews.data?.length}>
              <For each={volumeReviews.data ?? []}>
                {(review) => (
                  <div class="rounded border border-v2-border-default p-2 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-v2-text-secondary">第 {review.round} 轮</span>
                      <Show when={review.score != null}>
                        <span class="text-v2-text-primary font-medium">{review.score}/10</span>
                      </Show>
                    </div>
                    <p class="text-v2-text-secondary">{review.overall}</p>
                    <Show when={review.strengths?.length}>
                      <div class="mt-1">
                        <span class="text-green-400">优点: </span>
                        <span class="text-v2-text-muted">{(review.strengths ?? []).join("、")}</span>
                      </div>
                    </Show>
                    <Show when={review.weaknesses?.length}>
                      <div class="mt-1">
                        <span class="text-amber-400">不足: </span>
                        <span class="text-v2-text-muted">{(review.weaknesses ?? []).join("、")}</span>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  )
}

function StructureBeats(props: {
  beats: ReadonlyArray<{ id: string; arcId: string; chapterOrder?: number | null; label: string; kind: string; status: string }>
  arcId: string
}) {
  const beats = createMemo(() =>
    props.beats
      .filter((b) => b.arcId === props.arcId)
      .sort((a, b) => (a.chapterOrder ?? 0) - (b.chapterOrder ?? 0)),
  )

  return (
    <div class="flex flex-col gap-1">
      <For each={beats()}>
        {(beat) => (
          <div class="flex items-center gap-2 text-xs">
            <span class={`px-1.5 py-0.5 rounded shrink-0 ${beatKindColor[beat.kind] ?? "bg-v2-bg-secondary"}`}>
              {beatKindLabel[beat.kind] ?? beat.kind}
            </span>
            <span class="text-v2-text-primary truncate">{beat.label}</span>
            <Show when={beat.chapterOrder != null}>
              <span class="text-v2-text-muted ml-auto shrink-0">第{beat.chapterOrder}章</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}