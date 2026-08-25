import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useAnnotations,
  useUpdateAnnotation,
  useDeleteAnnotation,
} from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

type AnnotationPanelProps = {
  novelID: Accessor<string>
  chapterID: Accessor<string | null>
}

type Translator = { t: (key: string, params?: Record<string, string | number>) => string }

// 枚举值翻译:字典缺失时回退到原始枚举值
function enumLabel(language: Translator, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = language.t(key)
  return translated === key ? value : translated
}

const statusColor: Record<string, string> = {
  open: "text-v2-state-fg-warning",
  resolved: "text-v2-state-fg-success",
  wontfix: "text-v2-text-text-faint",
  applied: "text-v2-state-fg-info",
}

export function AnnotationPanel(props: AnnotationPanelProps) {
  const language = useLanguage()
  const annotations = useAnnotations(
    props.novelID,
    createMemo(() => props.chapterID() ?? ""),
  )
  const updateAnnotation = useUpdateAnnotation()
  const deleteAnnotation = useDeleteAnnotation()
  const [filter, setFilter] = createSignal<"all" | "open" | "resolved">("all")

  const filtered = createMemo(() => {
    const list = annotations.data ?? []
    if (filter() === "open") return list.filter((a) => a.status === "open")
    if (filter() === "resolved") return list.filter((a) => a.status !== "open")
    return list
  })

  function setStatus(id: string, status: "open" | "resolved" | "wontfix" | "applied") {
    const chapterID = props.chapterID()
    if (!chapterID) return
    updateAnnotation.mutate({
      novelID: props.novelID(),
      annotationID: id,
      chapterID,
      status,
    })
  }

  function remove(id: string) {
    const chapterID = props.chapterID()
    if (!chapterID) return
    deleteAnnotation.mutate({ novelID: props.novelID(), annotationID: id, chapterID })
  }

  return (
    <div class="flex flex-col gap-2 p-3 overflow-y-auto h-full">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.panel.annotations")}</h3>
        <div class="flex gap-1">
          <FilterButton active={filter() === "all"} onClick={() => setFilter("all")}>
            {language.t("novel.annotations.filter.all")}
          </FilterButton>
          <FilterButton active={filter() === "open"} onClick={() => setFilter("open")}>
            {language.t("novel.annotations.status.open")}
          </FilterButton>
          <FilterButton active={filter() === "resolved"} onClick={() => setFilter("resolved")}>
            {language.t("novel.annotations.status.resolved")}
          </FilterButton>
        </div>
      </div>

      <Show when={annotations.isLoading}>
        <Spinner />
      </Show>

      <Show when={!annotations.isLoading && filtered().length === 0}>
        <p class="text-xs text-v2-text-text-faint py-4 text-center">{language.t("novel.annotations.empty")}</p>
      </Show>

      <For each={filtered()}>
        {(ann) => (
          <div class="rounded border border-v2-border-border-base p-2 flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>
                  {enumLabel(language, "novel.annotations.status", ann.status)}
                </span>
                <Show when={ann.source === "ai"}>
                  <span class="text-xs px-1 py-0.5 rounded bg-v2-background-bg-layer-01 text-v2-text-text-faint">AI</span>
                </Show>
                <Show when={ann.suggestedReplacement}>
                  <span class="text-xs px-1 py-0.5 rounded bg-v2-state-bg-info text-v2-state-fg-info">{language.t("novel.annotations.polish")}</span>
                </Show>
              </div>
              <Show when={ann.paragraphIndex != null}>
                <span class="text-xs text-v2-text-text-faint">P{ann.paragraphIndex! + 1}</span>
              </Show>
            </div>

            <Show when={ann.quote}>
              <blockquote class="text-xs text-v2-text-text-faint border-l-2 border-v2-border-border-base pl-2 italic truncate">
                {ann.quote}
              </blockquote>
            </Show>

            <p class="text-xs text-v2-text-text-base">{ann.comment}</p>

            <Show when={ann.suggestedReplacement}>
              <div class="rounded bg-v2-background-bg-layer-01 p-1.5 text-xs text-v2-text-text-muted">
                <span class="text-v2-text-text-faint">{language.t("novel.annotations.suggestion")} </span>
                {ann.suggestedReplacement}
              </div>
            </Show>

            <Show when={ann.status === "open"}>
              <div class="flex gap-1 mt-1">
                <Show when={ann.suggestedReplacement}>
                  <ButtonV2 size="small" variant="contrast" onClick={() => setStatus(ann.id, "applied")}>
                    {language.t("novel.annotations.apply")}
                  </ButtonV2>
                </Show>
                <ButtonV2 size="small" variant="outline" onClick={() => setStatus(ann.id, "resolved")}>
                  {language.t("novel.annotations.resolve")}
                </ButtonV2>
                <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "wontfix")}>
                  {language.t("novel.annotations.dismiss")}
                </ButtonV2>
                <ButtonV2 size="small" variant="ghost" onClick={() => remove(ann.id)}>
                  {language.t("common.delete")}
                </ButtonV2>
              </div>
            </Show>

            <Show when={ann.status !== "open"}>
              <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "open")}>
                {language.t("novel.annotations.reopen")}
              </ButtonV2>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

function FilterButton(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      class={`text-xs px-2 py-0.5 rounded transition-colors ${
        props.active
          ? "bg-v2-background-bg-layer-01 text-v2-text-text-base"
          : "text-v2-text-text-faint hover:text-v2-text-text-base"
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}