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
import { useLanguage } from "@/context/language"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"

type StructurePanelProps = {
  novelID: Accessor<string>
  selectedVolumeId: Accessor<string | null>
}

type Translator = { t: (key: string, params?: Record<string, string | number>) => string }

// 枚举值翻译:字典缺失时回退到原始枚举值
function enumLabel(language: Translator, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = language.t(key)
  return translated === key ? value : translated
}

const beatKindColor: Record<string, string> = {
  setup: "bg-v2-background-bg-layer-01",
  rising: "bg-v2-state-bg-info text-v2-state-fg-info",
  turn: "bg-v2-state-bg-warning text-v2-state-fg-warning",
  midpoint: "bg-v2-background-bg-accent text-v2-text-text-accent",
  crisis: "bg-v2-state-bg-danger text-v2-state-fg-danger",
  climax: "bg-v2-state-bg-danger text-v2-state-fg-danger",
  resolution: "bg-v2-state-bg-success text-v2-state-fg-success",
  note: "bg-v2-background-bg-layer-01 text-v2-text-text-faint",
}

const arcStatusColor: Record<string, string> = {
  planned: "text-v2-text-text-faint",
  active: "text-v2-state-fg-info",
  completed: "text-v2-state-fg-success",
  abandoned: "text-v2-state-fg-danger",
}

export default function StructurePanel(props: StructurePanelProps) {
  const language = useLanguage()
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
            <h3 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.structure.editorial")}</h3>
            <ButtonV2 size="small" variant="outline" onClick={runEditorialReview} loading={createReport.isPending}>
              {language.t("novel.structure.editorial.run")}
            </ButtonV2>
          </div>
          <Show when={editorial.data?.[0]}>
            {(report) => (
              <div class="rounded border border-v2-border-border-base p-2 text-xs">
                <p class="text-v2-text-text-muted mb-1">{report().summary}</p>
                <div class="text-v2-text-text-faint">
                  {language.t("novel.structure.editorial.recommendations", {
                    count: report().recommendations?.length ?? 0,
                  })}
                </div>
              </div>
            )}
          </Show>
        </section>

        {/* 结构线 */}
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.structure.arcs")}</h3>
            <ButtonV2 size="small" variant="ghost" onClick={() => setShowAddArc(!showAddArc())}>
              {showAddArc() ? language.t("common.cancel") : language.t("novel.structure.arcs.add")}
            </ButtonV2>
          </div>

          <Show when={showAddArc()}>
            <div class="flex flex-col gap-1.5 rounded border border-v2-border-border-base p-2">
              <SelectV2
                options={["narrative", "character", "subplot"]}
                current={newArcType() as "narrative" | "character" | "subplot"}
                label={(t) => enumLabel(language, "novel.structure.arcType", t)}
                onSelect={(t) => t && setNewArcType(t)}
              />
              <TextInputV2
                placeholder={language.t("novel.structure.arcs.titlePlaceholder")}
                value={newArcTitle()}
                onInput={(e) => setNewArcTitle(e.currentTarget.value)}
              />
              <ButtonV2 size="small" onClick={handleCreateArc}>{language.t("novel.structure.arcs.create")}</ButtonV2>
            </div>
          </Show>

          <Show when={arcs.data?.length === 0 && !showAddArc()}>
            <p class="text-xs text-v2-text-text-faint py-2">{language.t("novel.structure.arcs.empty")}</p>
          </Show>

          <For each={arcs.data ?? []}>
            {(arc) => (
              <div class="rounded border border-v2-border-border-base">
                <button
                  class="w-full flex items-center justify-between p-2 text-left hover:bg-v2-background-bg-layer-01"
                  onClick={() => setExpandedArc(expandedArc() === arc.id ? null : arc.id)}
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-xs px-1.5 py-0.5 rounded bg-v2-background-bg-layer-01 text-v2-text-text-faint shrink-0">
                      {enumLabel(language, "novel.structure.arcType", arc.arcType)}
                    </span>
                    <span class="text-sm font-medium text-v2-text-text-base truncate">{arc.title}</span>
                  </div>
                  <span class={`text-xs ${arcStatusColor[arc.status] ?? ""}`}>
                    {enumLabel(language, "novel.structure.arcStatus", arc.status)}
                  </span>
                </button>

                <Show when={expandedArc() === arc.id}>
                  <div class="border-t border-v2-border-border-base p-2 flex flex-col gap-1.5">
                    <Show when={arc.summary}>
                      <p class="text-xs text-v2-text-text-muted">{arc.summary}</p>
                    </Show>
                    <div class="flex gap-2 text-xs text-v2-text-text-faint">
                      <Show when={arc.plannedStartChapter != null}>
                        <span>
                          {language.t("novel.structure.arcs.planned", {
                            start: arc.plannedStartChapter!,
                            end: arc.plannedEndChapter ?? "?",
                          })}
                        </span>
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
                          label={(k) => enumLabel(language, "novel.structure.beatKind", k)}
                          onSelect={(k) => k && setNewBeatKind(k)}
                        />
                        <TextInputV2
                          placeholder={language.t("novel.structure.beat.titlePlaceholder")}
                          value={newBeatLabel()}
                          onInput={(e) => setNewBeatLabel(e.currentTarget.value)}
                        />
                        <div class="flex gap-1.5">
                          <ButtonV2 size="small" onClick={() => handleCreateBeat(arc.id)}>{language.t("novel.structure.beat.add")}</ButtonV2>
                          <ButtonV2 size="small" variant="ghost" onClick={() => setShowAddBeat(null)}>{language.t("common.cancel")}</ButtonV2>
                        </div>
                      </div>
                    </Show>
                    <Show when={showAddBeat() !== arc.id}>
                      <ButtonV2 size="small" variant="ghost" onClick={() => setShowAddBeat(arc.id)}>
                        {language.t("novel.structure.beat.addToArc")}
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
            <h3 class="text-sm font-semibold text-v2-text-text-base">
              {language.t("novel.structure.review.title", { title: selectedVolume()!.title })}
            </h3>
            <Show when={volumeReviews.data?.length}>
              <For each={volumeReviews.data ?? []}>
                {(review) => (
                  <div class="rounded border border-v2-border-border-base p-2 text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-v2-text-text-muted">{language.t("novel.structure.review.round", { round: review.round })}</span>
                      <Show when={review.score != null}>
                        <span class="text-v2-text-text-base font-medium">{review.score}/10</span>
                      </Show>
                    </div>
                    <p class="text-v2-text-text-muted">{review.overall}</p>
                    <Show when={review.strengths?.length}>
                      <div class="mt-1">
                        <span class="text-v2-state-fg-success">{language.t("novel.structure.review.strengths")} </span>
                        <span class="text-v2-text-text-faint">{(review.strengths ?? []).join("、")}</span>
                      </div>
                    </Show>
                    <Show when={review.weaknesses?.length}>
                      <div class="mt-1">
                        <span class="text-v2-state-fg-warning">{language.t("novel.structure.review.weaknesses")} </span>
                        <span class="text-v2-text-text-faint">{(review.weaknesses ?? []).join("、")}</span>
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
  const language = useLanguage()
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
            <span class={`px-1.5 py-0.5 rounded shrink-0 ${beatKindColor[beat.kind] ?? "bg-v2-background-bg-layer-01"}`}>
              {enumLabel(language, "novel.structure.beatKind", beat.kind)}
            </span>
            <span class="text-v2-text-text-base truncate">{beat.label}</span>
            <Show when={beat.chapterOrder != null}>
              <span class="text-v2-text-text-faint ml-auto shrink-0">
                {language.t("novel.chapter.label", { order: beat.chapterOrder! })}
              </span>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}