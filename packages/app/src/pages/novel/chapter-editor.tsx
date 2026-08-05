import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import {
  useChapterDetail,
  useUpdateChapterContent,
  useChapterVersions,
  useRestoreChapterVersion,
} from "@/context/novel-queries"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

// ─── Constants ───

const TARGET_LENGTH = 3000
const LOWER_BOUND = Math.floor(TARGET_LENGTH * 0.85)
const UPPER_BOUND = Math.ceil(TARGET_LENGTH * 1.15)

// ─── Props ───

type ChapterEditorProps = {
  novelID: string
  chapterID: string
  onExit: () => void
}

// ─── Component ───

export default function ChapterEditor(props: ChapterEditorProps) {
  const language = useLanguage()
  const chapterQuery = useChapterDetail(
    () => props.novelID,
    () => props.chapterID,
  )
  const updateMutation = useUpdateChapterContent()
  const versionsQuery = useChapterVersions(
    () => props.novelID,
    () => props.chapterID,
  )
  const restoreMutation = useRestoreChapterVersion()

  const [content, setContent] = createSignal("")
  const [hasChanged, setHasChanged] = createSignal(false)
  const [showHistory, setShowHistory] = createSignal(false)
  const [previewVersion, setPreviewVersion] = createSignal<number | null>(null)
  const [confirmRestore, setConfirmRestore] = createSignal<number | null>(null)
  const [lastAutoSave, setLastAutoSave] = createSignal<number | null>(null)

  // Load initial content when chapter detail arrives
  createEffect(() => {
    const data = chapterQuery.data
    if (data) {
      setContent(data.content)
      setHasChanged(false)
    }
  })

  // Auto-save 2s after the last edit; never exits the editor
  createEffect(() => {
    const current = content()
    if (!hasChanged() || current === (chapterQuery.data?.content ?? "")) return
    const timer = setTimeout(() => {
      void updateMutation
        .mutateAsync({ novelID: props.novelID, chapterID: props.chapterID, content: current })
        .then(() => {
          setHasChanged(false)
          setLastAutoSave(Date.now())
        })
        .catch(() => {})
    }, 2000)
    onCleanup(() => clearTimeout(timer))
  })

  const charCount = () => content().length

  const targetStatus = createMemo(() => {
    const count = charCount()
    if (count >= LOWER_BOUND && count <= UPPER_BOUND) return "good"
    if (count < LOWER_BOUND) return "short"
    return "long"
  })

  const isUnchanged = () => {
    return !hasChanged() || content() === (chapterQuery.data?.content ?? "")
  }

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        novelID: props.novelID,
        chapterID: props.chapterID,
        content: content(),
      })
      setHasChanged(false)
      showToast(language.t("novel.editor.saveSuccess"))
      props.onExit()
    } catch {
      showToast(language.t("novel.error.saveFailed"))
    }
  }

  const handleRestore = async (version: number) => {
    try {
      await restoreMutation.mutateAsync({ novelID: props.novelID, chapterID: props.chapterID, version })
      setConfirmRestore(null)
      setPreviewVersion(null)
      showToast(language.t("novel.editor.restoreSuccess"))
    } catch {
      showToast(language.t("novel.error.saveFailed"))
    }
  }

  const versions = createMemo(() => versionsQuery.data ?? [])
  const previewing = createMemo(() => versions().find((v) => v.version === previewVersion()))

  // Keyboard shortcut: Ctrl/Cmd+S
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault()
      if (!isUnchanged() && !updateMutation.isPending) {
        void handleSave()
      }
    }
  }

  // ─── Target indicator bar color ───

  const barColor = () => {
    switch (targetStatus()) {
      case "good":
        return "bg-v2-state-fg-success"
      case "short":
        return "bg-v2-state-fg-warning"
      case "long":
        return "bg-v2-state-fg-danger"
    }
  }

  return (
    <Show
      when={!chapterQuery.isLoading}
      fallback={
        <div class="flex flex-col items-center justify-center flex-1 min-h-0">
          <Spinner />
        </div>
      }
    >
      <Show
        when={!chapterQuery.isError}
        fallback={
          <div class="flex flex-col items-center justify-center flex-1 min-h-0 px-6 text-center">
            <p class="text-sm text-v2-state-fg-danger">
              {chapterQuery.error instanceof Error ? chapterQuery.error.message : String(chapterQuery.error)}
            </p>
          </div>
        }
      >
        <div class="flex flex-col h-full">
          {/* Header bar */}
          <div class="flex items-center justify-between px-6 py-3 border-b border-v2-border-border-base shrink-0">
            <h2 class="text-lg font-semibold text-v2-text-text-base truncate min-w-0">{chapterQuery.data?.title}</h2>

            <div class="flex items-center gap-4 shrink-0">
              {/* Word count */}
              <span class="text-xs tabular-nums text-v2-text-text-faint">
                {language.t("novel.editor.charCount", {
                  count: charCount(),
                  target: TARGET_LENGTH,
                })}
              </span>

              {/* Auto-save status */}
              <Show when={lastAutoSave()}>
                {(ts) => (
                  <span class="text-[10px] text-v2-text-text-faint">
                    {language.t("novel.editor.autoSaved", {
                      time: new Date(ts()).toLocaleTimeString(),
                    })}
                  </span>
                )}
              </Show>

              {/* Target indicator bar */}
              <div class="flex items-center gap-1.5">
                <div class="w-16 h-1.5 bg-v2-overlay-simple-overlay-hover rounded-full overflow-hidden">
                  <div
                    class={`h-full rounded-full transition-all ${barColor()}`}
                    style={{
                      width: `${Math.min((charCount() / TARGET_LENGTH) * 100, 150)}%`,
                    }}
                  />
                </div>
                <span class="text-[10px] text-v2-text-text-faint tabular-nums">{TARGET_LENGTH}</span>
              </div>

              {/* History toggle */}
              <ButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                data-expanded={showHistory() ? "" : undefined}
                onClick={() => {
                  setShowHistory(!showHistory())
                  setPreviewVersion(null)
                  setConfirmRestore(null)
                }}
              >
                {language.t("novel.editor.history")}
              </ButtonV2>

              {/* Save button */}
              <ButtonV2
                type="button"
                variant="contrast"
                size="small"
                disabled={isUnchanged() || updateMutation.isPending}
                onClick={handleSave}
              >
                {updateMutation.isPending ? language.t("novel.editor.saving") : language.t("novel.editor.save")}
              </ButtonV2>

              {/* Exit button */}
              <ButtonV2 type="button" variant="ghost-muted" size="small" onClick={props.onExit}>
                {language.t("novel.editor.exit")}
              </ButtonV2>
            </div>
          </div>

          {/* Textarea editor + history panel */}
          <div class="flex-1 flex overflow-hidden">
            <div class="flex-1 min-h-0 overflow-y-auto">
              <textarea
                class="w-full h-full p-6 bg-transparent text-v2-text-text-base font-serif text-base leading-relaxed resize-none outline-none"
                value={content()}
                onInput={(e) => {
                  setContent(e.currentTarget.value)
                  setHasChanged(true)
                }}
                onKeyDown={handleKeyDown}
              />
            </div>

            <Show when={showHistory()}>
              <div class="w-72 shrink-0 border-l border-v2-border-border-base flex flex-col">
                <div class="px-4 py-2 border-b border-v2-border-border-base text-xs font-medium text-v2-text-text-muted">
                  {language.t("novel.editor.history")}
                </div>
                <div class="flex-1 overflow-y-auto">
                  <Show
                    when={versions().length > 0}
                    fallback={
                      <p class="px-4 py-3 text-xs text-v2-text-text-faint">{language.t("novel.editor.noVersions")}</p>
                    }
                  >
                    <For each={versions()}>
                      {(v) => (
                        <div class="px-4 py-2 border-b border-v2-border-border-base last:border-b-0">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-xs font-medium text-v2-text-text-base">v{v.version}</span>
                            <span class="text-[10px] text-v2-text-text-faint">
                              {new Date(v.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div class="mt-0.5 flex items-center justify-between gap-2">
                            <span class="text-[10px] text-v2-text-text-faint">
                              {v.createdBy} · {language.t("novel.chapter.wordCount", { count: v.wordCount })}
                            </span>
                            <div class="flex items-center gap-1">
                              <button
                                type="button"
                                class="text-[10px] text-v2-text-text-muted hover:text-v2-text-text-base underline"
                                onClick={() => setPreviewVersion(previewVersion() === v.version ? null : v.version)}
                              >
                                {language.t("novel.editor.preview")}
                              </button>
                              <Show
                                when={confirmRestore() === v.version}
                                fallback={
                                  <button
                                    type="button"
                                    class="text-[10px] text-v2-text-text-accent hover:underline"
                                    onClick={() => setConfirmRestore(v.version)}
                                  >
                                    {language.t("novel.editor.restore")}
                                  </button>
                                }
                              >
                                <button
                                  type="button"
                                  class="px-1.5 h-4 rounded bg-v2-background-bg-accent text-v2-text-text-contrast text-[10px] leading-none disabled:opacity-50"
                                  disabled={restoreMutation.isPending}
                                  onClick={() => void handleRestore(v.version)}
                                >
                                  {language.t("common.action.confirm")}
                                </button>
                                <button
                                  type="button"
                                  class="px-1.5 h-4 rounded border border-v2-border-border-base text-[10px] leading-none"
                                  onClick={() => setConfirmRestore(null)}
                                >
                                  {language.t("common.action.cancel")}
                                </button>
                              </Show>
                            </div>
                          </div>
                          <Show when={previewVersion() === v.version && previewing()}>
                            {(pv) => (
                              <div class="mt-2 max-h-48 overflow-y-auto rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2">
                                <p class="whitespace-pre-wrap text-[11px] leading-relaxed text-v2-text-text-muted">
                                  {pv().content}
                                </p>
                              </div>
                            )}
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Show>
  )
}
