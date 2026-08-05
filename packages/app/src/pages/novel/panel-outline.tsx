import { Marked } from "marked"

const marked = new Marked()
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useOutline, useUpdateOutline } from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"

type Props = {
  novelID: Accessor<string>
}

type EditTarget = { section: "master" | "volume" | "chapter"; id?: string } | null

function sanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
}

export function PanelOutline(props: Props) {
  const language = useLanguage()
  const outline = useOutline(props.novelID)
  const updateOutline = useUpdateOutline()
  const [editing, setEditing] = createSignal<EditTarget>(null)
  const [draft, setDraft] = createSignal("")

  const startEdit = (section: "master" | "volume" | "chapter", id: string | undefined, current: string) => {
    setEditing({ section, id })
    setDraft(current)
  }

  const saveEdit = async () => {
    const target = editing()
    if (!target) return
    await updateOutline.mutateAsync({
      novelID: props.novelID(),
      section: target.section,
      id: target.id,
      markdown: draft(),
    })
    setEditing(null)
    setDraft("")
  }

  const cancelEdit = () => {
    setEditing(null)
    setDraft("")
  }

  const masterHtml = createMemo(() => {
    if (!outline.data?.master) return ""
    const raw = marked.parse(outline.data.master, { async: false }) as string
    return sanitize(raw)
  })

  const volumeHtml = createMemo(() => {
    return (
      outline.data?.volumes.map((v) => ({
        volumeId: v.volumeId,
        html: sanitize(marked.parse(v.markdown, { async: false }) as string),
      })) ?? []
    )
  })

  const chapterHtml = createMemo(() => {
    return (
      outline.data?.chapters.map((c) => ({
        chapterId: c.chapterId,
        html: sanitize(marked.parse(c.markdown, { async: false }) as string),
      })) ?? []
    )
  })

  const editorUI = (
    <div class="flex flex-col gap-2">
      <TextareaV2 fluid value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} rows={12} />
      <div class="flex gap-2">
        <ButtonV2 variant="contrast" size="small" onClick={saveEdit} disabled={updateOutline.isPending}>
          {language.t("novel.panel.outline.save")}
        </ButtonV2>
        <ButtonV2 variant="ghost-muted" size="small" onClick={cancelEdit}>
          {language.t("novel.panel.outline.cancel")}
        </ButtonV2>
      </div>
    </div>
  )

  return (
    <Show
      when={!outline.isLoading}
      fallback={
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-6 h-6 text-v2-text-text-muted" />
        </div>
      }
    >
      <Show
        when={!!outline.data}
        fallback={
          <div class="px-4 py-6 text-sm text-v2-text-text-muted text-center">
            {language.t("novel.workspace.status.saving")}
          </div>
        }
      >
        <div class="px-4 py-4 space-y-6">
          <h2 class="text-base font-semibold text-v2-text-text-base">{language.t("novel.panel.outline")}</h2>

          {/* Master outline */}
          <section>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-medium text-v2-text-text-accent">{language.t("novel.panel.outline.master")}</h3>
              <Show when={editing()?.section !== "master"}>
                <ButtonV2
                  variant="ghost-muted"
                  size="small"
                  onClick={() => startEdit("master", undefined, outline.data!.master)}
                >
                  {language.t("novel.panel.outline.edit")}
                </ButtonV2>
              </Show>
            </div>
            <Show
              when={editing()?.section === "master"}
              fallback={
                outline.data!.master && (
                  <div
                    class="prose prose-sm max-w-none text-v2-text-text-muted [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm"
                    innerHTML={masterHtml()}
                  />
                )
              }
            >
              {editorUI}
            </Show>
          </section>

          {/* Volumes */}
          {volumeHtml().length > 0 && (
            <section>
              <h3 class="text-sm font-medium text-v2-text-text-accent mb-2">
                {language.t("novel.panel.outline.volumeOutline")}
              </h3>
              <div class="space-y-4">
                <For each={volumeHtml()}>
                  {(v) => (
                    <div class="pl-3 border-l-2 border-v2-border-border-base">
                      <div class="flex items-center justify-end mb-1">
                        <Show when={!(editing()?.section === "volume" && editing()?.id === v.volumeId)}>
                          <ButtonV2
                            variant="ghost-muted"
                            size="small"
                            onClick={() =>
                              startEdit(
                                "volume",
                                v.volumeId,
                                outline.data!.volumes.find((x) => x.volumeId === v.volumeId)?.markdown ?? "",
                              )
                            }
                          >
                            {language.t("novel.panel.outline.edit")}
                          </ButtonV2>
                        </Show>
                      </div>
                      <Show
                        when={editing()?.section === "volume" && editing()?.id === v.volumeId}
                        fallback={
                          <div
                            class="prose prose-sm max-w-none text-v2-text-text-muted [&_h1]:text-sm [&_h2]:text-sm"
                            innerHTML={v.html}
                          />
                        }
                      >
                        {editorUI}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}

          {/* Chapters */}
          {chapterHtml().length > 0 && (
            <section>
              <h3 class="text-sm font-medium text-v2-text-text-accent mb-2">
                {language.t("novel.panel.outline.chapterOutline")}
              </h3>
              <div class="space-y-2">
                <For each={chapterHtml()}>
                  {(c) => (
                    <div class="pl-3 border-l border-v2-border-border-base/50">
                      <div class="flex items-center justify-end mb-1">
                        <Show when={!(editing()?.section === "chapter" && editing()?.id === c.chapterId)}>
                          <ButtonV2
                            variant="ghost-muted"
                            size="small"
                            onClick={() =>
                              startEdit(
                                "chapter",
                                c.chapterId,
                                outline.data!.chapters.find((x) => x.chapterId === c.chapterId)?.markdown ?? "",
                              )
                            }
                          >
                            {language.t("novel.panel.outline.edit")}
                          </ButtonV2>
                        </Show>
                      </div>
                      <Show
                        when={editing()?.section === "chapter" && editing()?.id === c.chapterId}
                        fallback={
                          <div
                            class="prose prose-sm max-w-none text-v2-text-text-muted [&_h1]:text-sm [&_h2]:text-sm"
                            innerHTML={c.html}
                          />
                        }
                      >
                        {editorUI}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </div>
      </Show>
    </Show>
  )
}
