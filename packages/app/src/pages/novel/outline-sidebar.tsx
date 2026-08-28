import { createMemo, For, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { useOutline } from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import type { ServerNovelVolumesOutput, ServerNovelChaptersOutput } from "@opennovel-ai/client"

export type OutlineTarget = { section: "master" | "volume" | "chapter"; id?: string }

type OutlineSidebarProps = {
  novelID: string
  volumes: ServerNovelVolumesOutput
  chapters: ServerNovelChaptersOutput
  selectedOutline: Accessor<OutlineTarget | null>
  onSelectOutline: (target: OutlineTarget) => void
}

function isSelected(current: OutlineTarget | null, section: string, id?: string): boolean {
  if (!current) return false
  return current.section === section && current.id === id
}

export function OutlineSidebar(props: OutlineSidebarProps) {
  const language = useLanguage()
  const outline = useOutline(() => props.novelID)

  const volumesSorted = createMemo(() => [...props.volumes].sort((a, b) => a.order - b.order))

  const chaptersByVolume = createMemo(() => {
    const map = new Map<string, ServerNovelChaptersOutput>()
    for (const ch of props.chapters) {
      if (ch.volumeId) {
        const existing = map.get(ch.volumeId) ?? []
        map.set(ch.volumeId, [...existing, ch])
      }
    }
    for (const [id, list] of map) {
      map.set(
        id,
        [...list].sort((a, b) => a.order - b.order),
      )
    }
    const ungrouped = [...props.chapters].filter((ch) => !ch.volumeId).sort((a, b) => a.order - b.order)
    return { grouped: map, ungrouped }
  })

  const hasOutline = createMemo(() => {
    const data = outline.data
    if (!data) return false
    return data.master.length > 0 || data.volumes.length > 0 || data.chapters.length > 0
  })

  return (
    <div class="flex flex-col flex-1 min-h-0">
      <div class="flex items-center justify-between px-4 py-3 border-b border-v2-border-border-base">
        <h2 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.workspace.modeOutlines")}</h2>
      </div>

      <div class="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Show when={outline.isLoading}>
          <div class="flex items-center justify-center py-8">
            <Spinner class="w-5 h-5 text-v2-text-text-muted" />
          </div>
        </Show>

        <Show when={outline.error}>
          <p class="px-4 py-3 text-sm text-v2-state-fg-danger">{String(outline.error)}</p>
        </Show>

        <Show when={!outline.isLoading && !hasOutline()}>
          <p class="px-4 py-8 text-sm text-v2-text-text-muted text-center">{language.t("novel.panel.outline.empty")}</p>
        </Show>

        <Show when={!outline.isLoading && hasOutline()}>
          <div class="py-1">
            {/* Master outline */}
            <Show when={outline.data?.master.length ?? 0 > 0}>
              <button
                onClick={() => props.onSelectOutline({ section: "master" })}
                class={
                  isSelected(props.selectedOutline(), "master")
                    ? "w-full text-left px-4 py-2 bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
                    : "w-full text-left px-4 py-2.5 hover:bg-v2-overlay-simple-overlay-hover text-v2-text-text-base transition-colors"
                }
                type="button"
              >
                <span class="text-sm font-medium truncate">{language.t("novel.panel.outline.master")}</span>
              </button>
            </Show>

            {/* Volume outlines */}
            <For each={volumesSorted()}>
              {(volume) => {
                const hasVolumeOutline = createMemo(
                  () => outline.data?.volumes.some((v) => v.volumeId === volume.id) ?? false,
                )
                const volumeChapters = chaptersByVolume().grouped.get(volume.id) ?? []
                return (
                  <Show when={hasVolumeOutline() || volumeChapters.length > 0}>
                    <div class="px-4 pt-3 pb-1.5 text-xs font-medium text-v2-text-text-muted">{volume.title}</div>
                    <Show when={hasVolumeOutline()}>
                      <button
                        onClick={() => props.onSelectOutline({ section: "volume", id: volume.id })}
                        class={
                          isSelected(props.selectedOutline(), "volume", volume.id)
                            ? "w-full text-left px-4 py-2 bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
                            : "w-full text-left px-4 py-2.5 hover:bg-v2-overlay-simple-overlay-hover text-v2-text-text-base transition-colors"
                        }
                        type="button"
                      >
                        <span class="text-sm truncate">{language.t("novel.panel.outline.volumeOutline")}</span>
                      </button>
                    </Show>
                    <For each={volumeChapters}>
                      {(chapter) => {
                        const hasChapterOutline = createMemo(
                          () => outline.data?.chapters.some((c) => c.chapterId === String(chapter.order)) ?? false,
                        )
                        return (
                          <Show when={hasChapterOutline()}>
                            <button
                              onClick={() => props.onSelectOutline({ section: "chapter", id: String(chapter.order) })}
                              class={
                                isSelected(props.selectedOutline(), "chapter", String(chapter.order))
                                  ? "w-full text-left px-4 pl-6 py-2 bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
                                  : "w-full text-left px-4 pl-6 py-2.5 hover:bg-v2-overlay-simple-overlay-hover text-v2-text-text-base transition-colors"
                              }
                              type="button"
                            >
                              <span class="text-sm truncate">
                                {chapter.title}
                              </span>
                            </button>
                          </Show>
                        )
                      }}
                    </For>
                  </Show>
                )
              }}
            </For>

            {/* Ungrouped chapter outlines */}
            <Show when={chaptersByVolume().ungrouped.length > 0}>
              <div class="px-4 pt-3 pb-1.5 text-xs font-medium text-v2-text-text-muted">
                {language.t("novel.chapter.ungrouped")}
              </div>
              <For each={chaptersByVolume().ungrouped}>
                {(chapter) => {
                  const hasChapterOutline = createMemo(
                    () => outline.data?.chapters.some((c) => c.chapterId === String(chapter.order)) ?? false,
                  )
                  return (
                    <Show when={hasChapterOutline()}>
                      <button
                        onClick={() => props.onSelectOutline({ section: "chapter", id: String(chapter.order) })}
                        class={
                          isSelected(props.selectedOutline(), "chapter", String(chapter.order))
                            ? "w-full text-left px-4 py-2 bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
                            : "w-full text-left px-4 py-2.5 hover:bg-v2-overlay-simple-overlay-hover text-v2-text-text-base transition-colors"
                        }
                        type="button"
                      >
                        <span class="text-sm truncate">
                          {chapter.title}
                        </span>
                      </button>
                    </Show>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
