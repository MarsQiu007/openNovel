import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useAnnotations,
  useUpdateAnnotation,
  useDeleteAnnotation,
} from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

type AnnotationPanelProps = {
  novelID: Accessor<string>
  chapterID: Accessor<string | null>
}

const statusLabel: Record<string, string> = {
  open: "待处理",
  resolved: "已解决",
  wontfix: "不处理",
  applied: "已采纳",
}

const statusColor: Record<string, string> = {
  open: "text-amber-400",
  resolved: "text-green-400",
  wontfix: "text-v2-text-muted",
  applied: "text-blue-400",
}

export function AnnotationPanel(props: AnnotationPanelProps) {
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
        <h3 class="text-sm font-semibold text-v2-text-primary">批注</h3>
        <div class="flex gap-1">
          <FilterButton active={filter() === "all"} onClick={() => setFilter("all")}>
            全部
          </FilterButton>
          <FilterButton active={filter() === "open"} onClick={() => setFilter("open")}>
            待处理
          </FilterButton>
          <FilterButton active={filter() === "resolved"} onClick={() => setFilter("resolved")}>
            已解决
          </FilterButton>
        </div>
      </div>

      <Show when={annotations.isLoading}>
        <Spinner />
      </Show>

      <Show when={!annotations.isLoading && filtered().length === 0}>
        <p class="text-xs text-v2-text-muted py-4 text-center">暂无批注</p>
      </Show>

      <For each={filtered()}>
        {(ann) => (
          <div class="rounded border border-v2-border-default p-2 flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>
                  {statusLabel[ann.status] ?? ann.status}
                </span>
                <Show when={ann.source === "ai"}>
                  <span class="text-xs px-1 py-0.5 rounded bg-v2-bg-secondary text-v2-text-muted">AI</span>
                </Show>
                <Show when={ann.suggestedReplacement}>
                  <span class="text-xs px-1 py-0.5 rounded bg-blue-500/20 text-blue-300">润色</span>
                </Show>
              </div>
              <Show when={ann.paragraphIndex != null}>
                <span class="text-xs text-v2-text-muted">P{ann.paragraphIndex! + 1}</span>
              </Show>
            </div>

            <Show when={ann.quote}>
              <blockquote class="text-xs text-v2-text-muted border-l-2 border-v2-border-default pl-2 italic truncate">
                {ann.quote}
              </blockquote>
            </Show>

            <p class="text-xs text-v2-text-primary">{ann.comment}</p>

            <Show when={ann.suggestedReplacement}>
              <div class="rounded bg-v2-bg-secondary p-1.5 text-xs text-v2-text-secondary">
                <span class="text-v2-text-muted">建议: </span>
                {ann.suggestedReplacement}
              </div>
            </Show>

            <Show when={ann.status === "open"}>
              <div class="flex gap-1 mt-1">
                <Show when={ann.suggestedReplacement}>
                  <ButtonV2 size="small" variant="contrast" onClick={() => setStatus(ann.id, "applied")}>
                    采纳
                  </ButtonV2>
                </Show>
                <ButtonV2 size="small" variant="outline" onClick={() => setStatus(ann.id, "resolved")}>
                  解决
                </ButtonV2>
                <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "wontfix")}>
                  忽略
                </ButtonV2>
                <ButtonV2 size="small" variant="ghost" onClick={() => remove(ann.id)}>
                  删除
                </ButtonV2>
              </div>
            </Show>

            <Show when={ann.status !== "open"}>
              <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "open")}>
                重新打开
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
          ? "bg-v2-bg-secondary text-v2-text-primary"
          : "text-v2-text-muted hover:text-v2-text-primary"
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}