/**
 * 设定中心 — 世界观条目详情（内容阅读 / 划选批注 / 编辑）。
 *
 * 从 world-reader.tsx 抽出为独立模块（setting-center-tree）；编辑态支持受控驱动：
 * 设定树「内容 / 编辑」标签传入 editing + onEditingChange，不传时回落内部自持
 * （rail 与 relations-view 抽屉用法零改动）。
 */
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useConfirmDelete } from "./confirm-dialog"
import { showToast } from "@/utils/toast"
import {
  useCreateAnnotation,
  useDeleteWorldEntry,
  useAnnotations,
  useUpdateWorldEntry,
  useWorldEntries,
} from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { annotationInterval, closestParagraphElement, getSelectionAnchor, hasOverlap, paragraphDecorationAnnotations, segmentParagraph } from "./annotation-utils"
import { AnnotationCreateForm, AnnotationPanel } from "./annotation-panel"

export type WorldEntryDetailProps = {
  novelID: Accessor<string>
  selectedEntryId: Accessor<string | null>
  onEntryDeleted: () => void
  /** 受控编辑态：设定树标签驱动；缺省回落内部自持 */
  editing?: () => boolean
  onEditingChange?: (editing: boolean) => void
  onExecute?: (args: { prompt: string; roundID: string }) => Promise<string | null | undefined> | string | null | undefined
  onSessionFocused?: (sessionID: string | null | undefined) => void
}

export function WorldEntryDetail(props: WorldEntryDetailProps) {
  const language = useLanguage()
  const query = useWorldEntries(props.novelID)
  const updateEntry = useUpdateWorldEntry()
  const deleteEntry = useDeleteWorldEntry()
  const createAnnotation = useCreateAnnotation()
  const annotations = useAnnotations(
    props.novelID,
    () => "world_entry",
    createMemo(() => props.selectedEntryId() ?? ""),
  )
  const confirmDelete = useConfirmDelete()

  const entry = createMemo(() => {
    const id = props.selectedEntryId()
    if (!id) return null
    return query.data?.find((e) => e.id === id) ?? null
  })

  const [innerEditing, setInnerEditing] = createSignal(false)
  const isEditing = () => (props.editing !== undefined ? props.editing() : innerEditing())
  function setEditing(value: boolean) {
    if (props.editing !== undefined) props.onEditingChange?.(value)
    else setInnerEditing(value)
  }
  const [draftCategory, setDraftCategory] = createSignal("")
  const [draftTitle, setDraftTitle] = createSignal("")
  const [draftContent, setDraftContent] = createSignal("")
  const [selectedAnchor, setSelectedAnchor] = createSignal<ReturnType<typeof getSelectionAnchor> | null>(null)
  const [annotationComment, setAnnotationComment] = createSignal("")
  const [annotationReplacement, setAnnotationReplacement] = createSignal("")
  const paragraphSegments = createMemo(() => {
    const content = entry()?.content ?? ""
    const all = annotations.data ?? []
    const paragraphs = content.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
    return paragraphs.map((paragraph, idx) =>
      segmentParagraph(paragraph, paragraphDecorationAnnotations(idx, paragraph.length, paragraphs.length, all)),
    )
  })

  // 切换条目 / 数据变更时重置草稿与编辑态
  createEffect(() => {
    const current = entry()
    setEditing(false)
    setDraftCategory(current?.category ?? "")
    setDraftTitle(current?.title ?? "")
    setDraftContent(current?.content ?? "")
  })

  function handleSelection() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (selection?.isCollapsed) setSelectedAnchor(null)
      return
    }
    const range = selection.getRangeAt(0)
    const startElement = closestParagraphElement(range.startContainer)
    const endElement = closestParagraphElement(range.endContainer)
    if (!startElement || !endElement) return
    const paragraphIndex = Number(startElement.dataset.paragraphIndex)
    const endParagraphIndex = Number(endElement.dataset.paragraphIndex)
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return
    if (!Number.isInteger(endParagraphIndex) || endParagraphIndex < 0) return
    const anchor = getSelectionAnchor(startElement, paragraphIndex, selection, endElement, endParagraphIndex)
    const interval = annotationInterval(anchor)
    if (!interval) return
    const isOverlap = (annotations.data ?? []).some((item) => {
      if (item.status !== "open") return false
      const other = annotationInterval(item)
      return other != null && hasOverlap(interval, other)
    })
    if (isOverlap) {
      showToast({ variant: "error", title: "该区域已有待处理批注，请编辑现有批注" })
      return
    }
    setAnnotationComment("")
    setAnnotationReplacement("")
    setSelectedAnchor(anchor)
  }

  async function saveAnnotation() {
    const current = entry()
    const anchor = selectedAnchor()
    if (!current || !anchor) return
    try {
      await createAnnotation.mutateAsync({
        novelID: props.novelID(),
        targetType: "world_entry",
        targetId: current.id,
        field: "content",
        source: "user",
        anchorType: "paragraph",
        paragraphIndex: anchor.paragraphIndex,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        endParagraphIndex: anchor.endParagraphIndex,
        quote: anchor.quote,
        comment: annotationComment().trim(),
        suggestedReplacement: annotationReplacement().trim() || undefined,
      })
      setSelectedAnchor(null)
      showToast({ variant: "success", title: "批注已保存" })
    } catch (error) {
      showToast({
        variant: "error",
        title: error instanceof Error ? error.message : "批注保存失败",
      })
    }
  }

  function startEdit() {
    const current = entry()
    if (!current) return
    setDraftCategory(current.category)
    setDraftTitle(current.title)
    setDraftContent(current.content)
    setEditing(true)
  }

  function cancelEdit() {
    const current = entry()
    setDraftCategory(current?.category ?? "")
    setDraftTitle(current?.title ?? "")
    setDraftContent(current?.content ?? "")
    setEditing(false)
  }

  async function saveEdit() {
    const current = entry()
    if (!current) return
    if (!draftTitle().trim()) return
    await updateEntry.mutateAsync({
      novelID: props.novelID(),
      entryID: current.id,
      category: draftCategory().trim() || language.t("novel.panel.world.uncategorized"),
      title: draftTitle().trim(),
      content: draftContent(),
    })
    setEditing(false)
  }

  return (
    <div class="flex flex-col h-full">
      <Show
        when={props.selectedEntryId()}
        fallback={
          <div class="flex items-center justify-center flex-1 min-h-0 text-sm text-v2-text-text-muted">
            {language.t("novel.settings.selectEntry")}
          </div>
        }
      >
        <Show
          when={entry()}
          fallback={
            <Show
              when={!query.isLoading}
              fallback={
                <div class="flex items-center justify-center py-8">
                  <Spinner class="w-5 h-5 text-v2-text-text-muted" />
                </div>
              }
            >
              <div class="flex items-center justify-center flex-1 min-h-0 text-sm text-v2-text-text-faint">
                {language.t("novel.settings.entryNotFound")}
              </div>
            </Show>
          }
        >
          {(current) => (
            <div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
              <Show
                when={!isEditing()}
                fallback={
                  <div class="flex flex-col gap-3">
                    <TextInputV2
                      value={draftCategory()}
                      onInput={(e) => setDraftCategory(e.currentTarget.value)}
                      placeholder={language.t("novel.panel.world.category")}
                      fluid
                    />
                    <TextInputV2
                      value={draftTitle()}
                      onInput={(e) => setDraftTitle(e.currentTarget.value)}
                      placeholder={language.t("novel.panel.world.title")}
                      fluid
                    />
                    <TextareaV2
                      fluid
                      value={draftContent()}
                      onInput={(e) => setDraftContent(e.currentTarget.value)}
                      placeholder={language.t("novel.panel.world.content")}
                      rows={12}
                      class="font-mono"
                    />
                    <div class="flex items-center gap-2">
                      <ButtonV2
                        variant="contrast"
                        size="small"
                        onClick={() => void saveEdit()}
                        disabled={updateEntry.isPending || !draftTitle().trim()}
                      >
                        {updateEntry.isPending
                          ? language.t("novel.settings.entry.saving")
                          : language.t("novel.settings.entry.save")}
                      </ButtonV2>
                      <ButtonV2 variant="ghost-muted" size="small" onClick={cancelEdit}>
                        {language.t("novel.settings.entry.cancel")}
                      </ButtonV2>
                    </div>
                  </div>
                }
              >
                <div class="flex flex-col gap-2">
                  <Show when={current().category}>
                    <span class="text-xs font-medium text-v2-text-text-muted uppercase tracking-wider">
                      {current().category}
                    </span>
                  </Show>
                  <h2 class="text-xl font-bold text-v2-text-text-base">{current().title}</h2>
                  <Show
                    when={current().content}
                    fallback={<p class="text-sm text-v2-text-text-muted mt-2">—</p>}
                  >
                    <div class="mt-2 max-w-none space-y-3 text-sm leading-relaxed text-v2-text-text-base select-text">
                      <For each={paragraphSegments()}>
                        {(segments, idx) => (
                          <p data-paragraph-index={idx()} onMouseUp={handleSelection}>
                            <For each={segments}>
                              {(segment) => (
                                <Show
                                  when={segment.annotation}
                                  fallback={segment.text}
                                >
                                  {(annotation) => (
                                    <mark
                                      class="rounded-sm bg-v2-state-bg-info text-v2-text-text-base"
                                      title={annotation().comment}
                                    >
                                      {segment.text}
                                    </mark>
                                  )}
                                </Show>
                              )}
                            </For>
                          </p>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <Show when={selectedAnchor()}>
                  <AnnotationCreateForm
                    quote={() => selectedAnchor()?.quote ?? ""}
                    comment={annotationComment}
                    replacement={annotationReplacement}
                    pending={createAnnotation.isPending}
                    onComment={setAnnotationComment}
                    onReplacement={setAnnotationReplacement}
                    onSubmit={() => void saveAnnotation()}
                    onCancel={() => setSelectedAnchor(null)}
                  />
                </Show>
                <AnnotationPanel
                  novelID={props.novelID}
                  targetType="world_entry"
                  targetID={() => current().id}
                  targetTitle={() => current().title}
                  content={() => current().content}
                  onExecute={props.onExecute}
                  onSessionFocused={props.onSessionFocused}
                />
                <div class="flex items-center gap-2 mt-4">
                  <ButtonV2 variant="neutral" size="small" onClick={startEdit}>
                    {language.t("novel.settings.entry.edit")}
                  </ButtonV2>
                  <ButtonV2
                    variant="danger"
                    size="small"
                    onClick={() =>
                      confirmDelete({
                        title: language.t("novel.settings.entry.delete"),
                        message: language.t("novel.settings.entry.deleteConfirm", { title: current().title }),
                        onConfirm: async () => {
                          await deleteEntry.mutateAsync({ novelID: props.novelID(), entryID: current().id })
                          props.onEntryDeleted()
                        },
                      })
                    }
                  >
                    {language.t("novel.settings.entry.delete")}
                  </ButtonV2>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
