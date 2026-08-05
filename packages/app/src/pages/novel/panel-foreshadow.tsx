import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import {
  useCreateForeshadowing,
  useDeleteForeshadowing,
  useForeshadowing,
  useUpdateForeshadowing,
} from "@/context/novel-queries"
import type { ServerNovelForeshadowingOutput } from "@opennovel-ai/client"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { SelectV2 } from "@opennovel-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"

type PanelForeshadowProps = {
  novelID: Accessor<string>
  selectedChapterId: Accessor<string | null>
  chapters: ReadonlyArray<{ id: string; order: number; title: string }>
}

const stateOrder: Record<string, number> = {
  planted: 0,
  hinted: 1,
  resolved: 2,
  abandoned: 3,
}

const stateLabelKey: Record<string, string> = {
  planted: "novel.panel.foreshadow.planted",
  hinted: "novel.panel.foreshadow.hinted",
  resolved: "novel.panel.foreshadow.resolved",
  abandoned: "novel.panel.foreshadow.abandoned",
}

const stateColor: Record<string, string> = {
  planted: "text-v2-state-fg-info",
  hinted: "text-v2-state-fg-warning",
  resolved: "text-v2-state-fg-success",
  abandoned: "text-v2-text-text-muted",
}

const states = ["planted", "hinted", "resolved", "abandoned"]

export function PanelForeshadow(props: PanelForeshadowProps) {
  const language = useLanguage()
  const query = useForeshadowing(props.novelID)
  const createForeshadow = useCreateForeshadowing()
  const updateForeshadow = useUpdateForeshadowing()
  const deleteForeshadow = useDeleteForeshadowing()
  const [isAdding, setIsAdding] = createSignal(false)
  const [content, setContent] = createSignal("")

  const chapterOrder = (id: string | undefined | null) => {
    if (!id) return ""
    return props.chapters.find((c) => c.id === id)?.order ?? ""
  }

  const sorted = createMemo(() => {
    const data = query.data
    if (!data) return [] as ServerNovelForeshadowingOutput
    return [...data].sort((a, b) => {
      const oa = stateOrder[a.state] ?? 99
      const ob = stateOrder[b.state] ?? 99
      if (oa !== ob) return oa - ob
      return b.createdAt - a.createdAt
    })
  })

  const currentChapterEntries = createMemo(() => {
    const id = props.selectedChapterId()
    if (!id) return []
    return sorted().filter((e) => e.plantedChapterId === id || e.resolvedChapterId === id)
  })

  return (
    <div class="flex flex-col gap-3">
      <Show when={query.isLoading}>
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-5 h-5 text-v2-text-text-muted" />
        </div>
      </Show>

      <Show when={query.error}>
        <p class="text-sm text-v2-state-fg-danger px-3 py-2">{String(query.error)}</p>
      </Show>

      <Show when={currentChapterEntries().length > 0}>
        <div class="px-3 py-2 rounded bg-v2-background-bg-layer-02 space-y-1.5">
          <h4 class="text-[11px] font-medium text-v2-text-text-muted uppercase tracking-wider">
            {language.t("novel.panel.currentChapter", { chapter: chapterOrder(props.selectedChapterId()) })}
          </h4>
          <For each={currentChapterEntries()}>
            {(entry) => (
              <div>
                <p class="text-sm text-v2-text-text-base">{entry.content}</p>
                <div class="flex gap-2 text-[11px] text-v2-text-text-muted">
                  <Show when={entry.plantedChapterId === props.selectedChapterId()}>
                    <span>
                      {language.t("novel.panel.foreshadow.plantedIn", {
                        chapter: chapterOrder(entry.plantedChapterId),
                      })}
                    </span>
                  </Show>
                  <Show when={entry.resolvedChapterId === props.selectedChapterId()}>
                    <span>
                      {language.t("novel.panel.foreshadow.resolvedIn", {
                        chapter: chapterOrder(entry.resolvedChapterId),
                      })}
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="px-3">
        <Show
          when={isAdding()}
          fallback={
            <ButtonV2 variant="ghost" size="small" onClick={() => setIsAdding(true)}>
              + {language.t("novel.panel.foreshadow.add")}
            </ButtonV2>
          }
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!content().trim()) return
              await createForeshadow.mutateAsync({
                novelID: props.novelID(),
                content: content(),
              })
              setContent("")
              setIsAdding(false)
            }}
            class="flex gap-2"
          >
            <div class="flex-1 min-w-0">
              <TextInputV2 value={content()} onInput={(e) => setContent(e.currentTarget.value)} fluid />
            </div>
            <ButtonV2 type="submit" variant="contrast" size="small">
              {language.t("novel.panel.foreshadow.add")}
            </ButtonV2>
            <ButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              onClick={() => {
                setContent("")
                setIsAdding(false)
              }}
            >
              ✕
            </ButtonV2>
          </form>
        </Show>
      </div>

      <Show when={query.data && query.data.length === 0 && !isAdding()}>
        <p class="text-sm text-v2-text-text-muted px-3 py-8 text-center">
          {language.t("novel.panel.foreshadow.empty")}
        </p>
      </Show>

      <Show when={sorted().length > 0}>
        <For each={sorted()}>
          {(entry) => (
            <div class="flex flex-col gap-1 px-3 py-2 rounded hover:bg-v2-background-bg-layer-02 transition-colors">
              <div class="flex items-center justify-between gap-2">
                <SelectV2
                  options={states}
                  current={entry.state}
                  label={(state) => language.t(stateLabelKey[state])}
                  onSelect={(state) => {
                    if (!state) return
                    updateForeshadow.mutate({
                      novelID: props.novelID(),
                      entryID: entry.id,
                      state,
                    })
                  }}
                  appearance="inline"
                  valueClass={stateColor[entry.state] ?? "text-v2-text-text-muted"}
                />
                <ButtonV2
                  variant="danger"
                  size="small"
                  onClick={() =>
                    deleteForeshadow.mutate({
                      novelID: props.novelID(),
                      entryID: entry.id,
                    })
                  }
                >
                  {language.t("novel.panel.foreshadow.delete")}
                </ButtonV2>
              </div>
              <p class="text-sm text-v2-text-text-base">{entry.content}</p>
              <div class="flex gap-2 text-[11px] text-v2-text-text-muted">
                <Show when={entry.plantedChapterId}>
                  <span>
                    {language.t("novel.panel.foreshadow.plantedIn", { chapter: chapterOrder(entry.plantedChapterId) })}
                  </span>
                </Show>
                <Show when={entry.resolvedChapterId}>
                  <span>
                    {language.t("novel.panel.foreshadow.resolvedIn", {
                      chapter: chapterOrder(entry.resolvedChapterId),
                    })}
                  </span>
                </Show>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
