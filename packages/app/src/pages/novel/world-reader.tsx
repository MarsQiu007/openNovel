/**
 * 设定中心 — 中央阅读器
 *
 * 顶部子 tab：[世界观] [写作风格]
 * - 世界观: 选中条目的详情 / 编辑 / 删除；未选中显示提示
 * - 写作风格: style guide 表单（tone / pov / tense / rules）
 */
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useConfirmDelete } from "./confirm-dialog"
import { showToast } from "@/utils/toast"
import {
  useCreateSettingAnnotation,
  useDeleteWorldEntry,
  useSettingAnnotations,
  useSoul,
  useStyleGuide,
  useUpdateSoul,
  useUpdateStyleGuide,
  useUpdateWorldEntry,
  useWorldEntries,
} from "@/context/novel-queries"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opennovel-ai/ui/v2/segmented-control-v2"
import { SoulEditor } from "@/components/soul-editor"
import { SettingOrganizationPanel } from "./setting-organization"
import { getSelectionAnchor, hasOverlap, segmentParagraph } from "./annotation-utils"
import { SettingAnnotationCreateForm, SettingAnnotationPanel } from "./setting-annotation-panel"

type WorldSubTab = "entries" | "style" | "soul" | "organization"

type WorldReaderProps = {
  novelID: Accessor<string>
  selectedEntryId: Accessor<string | null>
  onEntryDeleted: () => void
  onExecute?: (args: { prompt: string; roundID: string }) => Promise<string | null | undefined> | string | null | undefined
  onSessionFocused?: (sessionID: string | null | undefined) => void
}

export function WorldReader(props: WorldReaderProps) {
  const language = useLanguage()
  const [subTab, setSubTab] = createSignal<WorldSubTab>("entries")
  return (
    <div class="flex flex-col flex-1 min-h-0">
      <div class="flex border-b border-v2-border-border-base px-6 py-2">
        <SegmentedControlV2
          class="segmented-control-v2--full-width"
          value={subTab()}
          onChange={(value) => {
            if (value === "entries" || value === "style" || value === "soul" || value === "organization") setSubTab(value)
          }}
        >
          <SegmentedControlItemV2 value="entries">
            {language.t("novel.settings.tabEntries")}
          </SegmentedControlItemV2>
          <SegmentedControlItemV2 value="style">{language.t("novel.settings.tabStyle")}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="soul">{language.t("novel.settings.tabSoul")}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="organization">整理</SegmentedControlItemV2>
        </SegmentedControlV2>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Show when={subTab() === "entries"}>
          <WorldEntryDetail
            novelID={props.novelID}
            selectedEntryId={props.selectedEntryId}
            onEntryDeleted={props.onEntryDeleted}
            onExecute={props.onExecute}
            onSessionFocused={props.onSessionFocused}
          />
        </Show>
        <Show when={subTab() === "style"}>
          <StyleGuideEditor novelID={props.novelID} />
        </Show>
        <Show when={subTab() === "soul"}>
          <NovelSoulEditor novelID={props.novelID} />
        </Show>
        <Show when={subTab() === "organization"}>
          <SettingOrganizationPanel novelID={props.novelID} />
        </Show>
      </div>
    </div>
  )
}

type WorldEntryDetailProps = {
  novelID: Accessor<string>
  selectedEntryId: Accessor<string | null>
  onEntryDeleted: () => void
  onExecute?: (args: { prompt: string; roundID: string }) => Promise<string | null | undefined> | string | null | undefined
  onSessionFocused?: (sessionID: string | null | undefined) => void
}

function WorldEntryDetail(props: WorldEntryDetailProps) {
  const language = useLanguage()
  const query = useWorldEntries(props.novelID)
  const updateEntry = useUpdateWorldEntry()
  const deleteEntry = useDeleteWorldEntry()
  const createAnnotation = useCreateSettingAnnotation()
  const annotations = useSettingAnnotations(
    props.novelID,
    createMemo(() => props.selectedEntryId() ?? ""),
  )
  const confirmDelete = useConfirmDelete()

  const entry = createMemo(() => {
    const id = props.selectedEntryId()
    if (!id) return null
    return query.data?.find((e) => e.id === id) ?? null
  })


  const [isEditing, setIsEditing] = createSignal(false)
  const [draftCategory, setDraftCategory] = createSignal("")
  const [draftTitle, setDraftTitle] = createSignal("")
  const [draftContent, setDraftContent] = createSignal("")
  const [selectedAnchor, setSelectedAnchor] = createSignal<{
    paragraphIndex: number
    startOffset: number
    endOffset: number
    quote: string
  } | null>(null)
  const [annotationComment, setAnnotationComment] = createSignal("")
  const [annotationReplacement, setAnnotationReplacement] = createSignal("")

  // 切换条目 / 数据变更时重置草稿与编辑态
  createEffect(() => {
    const current = entry()
    setIsEditing(false)
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
    const startElement = range.startContainer.parentElement?.closest<HTMLElement>("[data-paragraph-index]")
    const endElement = range.endContainer.parentElement?.closest<HTMLElement>("[data-paragraph-index]")
    if (!startElement || !endElement || startElement !== endElement) {
      showToast({ variant: "error", title: "请在同一段落内选择文字" })
      return
    }
    const paragraphIndex = Number(startElement.dataset.paragraphIndex)
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return
    const anchor = getSelectionAnchor(startElement, paragraphIndex, selection)
    const openAnnotations = (annotations.data ?? []).filter(
      (item) => item.paragraphIndex === paragraphIndex && item.status === "open",
    )
    if (openAnnotations.some((item) => hasOverlap(
      { start: anchor.startOffset, end: anchor.endOffset },
      { start: item.startOffset ?? 0, end: item.endOffset ?? 0 },
    ))) {
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
        entryID: current.id,
        source: "user",
        anchorType: "paragraph",
        paragraphIndex: anchor.paragraphIndex,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
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
    setIsEditing(true)
  }

  function cancelEdit() {
    const current = entry()
    setDraftCategory(current?.category ?? "")
    setDraftTitle(current?.title ?? "")
    setDraftContent(current?.content ?? "")
    setIsEditing(false)
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
    setIsEditing(false)
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
                      <For each={current().content.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)}>
                        {(paragraph, idx) => (
                          <p data-paragraph-index={idx()} onMouseUp={handleSelection}>
                            <For each={segmentParagraph(
                              paragraph,
                              (annotations.data ?? []).filter((item) => item.paragraphIndex === idx()),
                            )}>
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
                  <SettingAnnotationCreateForm
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
                <SettingAnnotationPanel
                  novelID={props.novelID}
                  entryID={() => current().id}
                  entryTitle={() => current().title}
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

type StyleGuideEditorProps = {
  novelID: Accessor<string>
}

function StyleGuideEditor(props: StyleGuideEditorProps) {
  const language = useLanguage()
  const query = useStyleGuide(props.novelID)
  const update = useUpdateStyleGuide()
  const [tone, setTone] = createSignal("")
  const [pov, setPov] = createSignal("")
  const [tense, setTense] = createSignal("")
  const [rules, setRules] = createSignal("")

  // 初次载入 / 远端变更时填充表单
  createEffect(() => {
    const data = query.data
    if (!data) return
    setTone(data.tone)
    setPov(data.pov)
    setTense(data.tense)
    setRules(
      Object.entries(data.rules ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    )
  })

  async function save() {
    const parsed = Object.fromEntries(
      rules()
        .split("\n")
        .map((line) => {
          const idx = line.search(/[:：]/)
          if (idx <= 0) return null
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const
        })
        .filter((entry): entry is readonly [string, string] => entry !== null && entry[0].length > 0),
    )
    await update.mutateAsync({
      novelID: props.novelID(),
      tone: tone().trim(),
      pov: pov().trim(),
      tense: tense().trim(),
      rules: parsed,
    })
    showToast({
      variant: "success",
      title: language.t("novel.settings.style.saved"),
    })
  }

  return (
    <div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <Spinner class="w-5 h-5 text-v2-text-text-muted" />
          </div>
        }
      >
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={tone()}
              onInput={(e) => setTone(e.currentTarget.value)}
              placeholder={language.t("novel.style.tone")}
            />
          </div>
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={pov()}
              onInput={(e) => setPov(e.currentTarget.value)}
              placeholder={language.t("novel.style.pov")}
            />
          </div>
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={tense()}
              onInput={(e) => setTense(e.currentTarget.value)}
              placeholder={language.t("novel.style.tense")}
            />
          </div>
        </div>
        <TextareaV2
          fluid
          class="font-mono"
          value={rules()}
          onInput={(e) => setRules(e.currentTarget.value)}
          placeholder={language.t("novel.style.rulesHint")}
          rows={10}
        />
        <div>
          <ButtonV2 variant="contrast" size="small" onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? language.t("novel.settings.entry.saving") : language.t("common.action.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}

type NovelSoulEditorProps = {
  novelID: Accessor<string>
}

function NovelSoulEditor(props: NovelSoulEditorProps) {
  const language = useLanguage()
  const query = useSoul(props.novelID)
  const update = useUpdateSoul()
  return (
    <SoulEditor
      value={() => query.data?.content}
      resetKey={props.novelID()}
      loading={query.isLoading}
      saving={update.isPending}
      hint={language.t("novel.settings.soul.globalHint")}
      onSave={async (content) => {
        await update.mutateAsync({ novelID: props.novelID(), content })
        showToast({ variant: "success", title: language.t("settings.soul.saved") })
      }}
    />
  )
}
