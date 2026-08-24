import { Marked } from "marked"
import { createMemo, createSignal, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { useOutline, useUpdateOutline } from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import type { ServerNovelVolumesOutput, ServerNovelChaptersOutput } from "@opennovel-ai/client"
import type { OutlineTarget } from "./outline-sidebar"

const marked = new Marked()

function sanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
}

type OutlineReaderProps = {
  novelID: string
  volumes: ServerNovelVolumesOutput
  chapters: ServerNovelChaptersOutput
  selectedOutline: Accessor<OutlineTarget | null>
}

export function OutlineReader(props: OutlineReaderProps) {
  const language = useLanguage()
  const outline = useOutline(() => props.novelID)
  const updateOutline = useUpdateOutline()
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")

  const target = createMemo(() => props.selectedOutline())

  const currentMarkdown = createMemo(() => {
    const t = target()
    const data = outline.data
    if (!t || !data) return ""
    if (t.section === "master") return data.master
    if (t.section === "volume") return data.volumes.find((v) => v.volumeId === t.id)?.markdown ?? ""
    return data.chapters.find((c) => c.chapterId === t.id)?.markdown ?? ""
  })

  const title = createMemo(() => {
    const t = target()
    if (!t) return ""
    if (t.section === "master") return language.t("novel.panel.outline.master")
    if (t.section === "volume") {
      const volume = props.volumes.find((v) => v.id === t.id)
      return volume
        ? `${volume.title} · ${language.t("novel.panel.outline.volumeOutline")}`
        : language.t("novel.panel.outline.volumeOutline")
    }
    const chapter = props.chapters.find((c) => String(c.order) === t.id)
    return chapter
      ? chapter.title
      : language.t("novel.panel.outline.chapterOutline")
  })

  const html = createMemo(() => {
    const md = currentMarkdown()
    if (!md) return ""
    return sanitize(marked.parse(md, { async: false }) as string)
  })

  const wordCount = createMemo(() => {
    const md = currentMarkdown()
    return md.length
  })

  const startEdit = () => {
    setDraft(currentMarkdown())
    setEditing(true)
  }

  const saveEdit = async () => {
    const t = target()
    if (!t) return
    await updateOutline.mutateAsync({
      novelID: props.novelID,
      section: t.section,
      id: t.id,
      markdown: draft(),
    })
    setEditing(false)
    setDraft("")
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft("")
  }

  return (
    <Show
      when={target()}
      fallback={
        <div class="flex flex-col items-center justify-center flex-1 min-h-0 px-6 text-center">
          <p class="text-sm text-v2-text-text-faint">{language.t("novel.outline.empty")}</p>
        </div>
      }
    >
      <Show
        when={!outline.isLoading}
        fallback={
          <div class="flex flex-col items-center justify-center flex-1 min-h-0">
            <Spinner />
          </div>
        }
      >
        <div class="flex flex-col h-full">
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-3 border-b border-v2-border-border-base shrink-0">
            <div class="flex items-center gap-3 min-w-0">
              <h2 class="text-lg font-semibold text-v2-text-text-base truncate">{title()}</h2>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="text-xs tabular-nums text-v2-text-text-faint">
                {language.t("novel.reader.wordCount", { count: wordCount() })}
              </span>
              <Show when={!editing()}>
                <ButtonV2 variant="ghost-muted" size="small" onClick={startEdit}>
                  {language.t("novel.panel.outline.edit")}
                </ButtonV2>
              </Show>
            </div>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <Show
              when={!editing()}
              fallback={
                <div class="flex flex-col gap-3 max-w-3xl mx-auto">
                  <TextareaV2
                    fluid
                    value={draft()}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    rows={20}
                    class="font-mono text-sm"
                  />
                  <div class="flex gap-2">
                    <ButtonV2
                      variant="contrast"
                      size="small"
                      onClick={() => void saveEdit()}
                      disabled={updateOutline.isPending}
                    >
                      {language.t("novel.panel.outline.save")}
                    </ButtonV2>
                    <ButtonV2 variant="ghost-muted" size="small" onClick={cancelEdit}>
                      {language.t("novel.panel.outline.cancel")}
                    </ButtonV2>
                  </div>
                </div>
              }
            >
              <div class="max-w-3xl mx-auto">
                <Show
                  when={html().length > 0}
                  fallback={<p class="text-sm text-v2-text-text-muted">{language.t("novel.outline.noContent")}</p>}
                >
                  <div
                    class="prose prose-sm max-w-none text-v2-text-text-base [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base"
                    innerHTML={html()}
                  />
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Show>
  )
}
