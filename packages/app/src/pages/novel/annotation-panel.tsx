import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useAnnotations,
  useBoundNovelSessions,
  useChapterDetail,
  useUpdateAnnotation,
  useDeleteAnnotation,
  useExecutionRounds,
  useCreateExecutionRound,
  useUpdateExecutionRound,
} from "@/context/novel-queries"
import { executeAnnotationExecution, groupHistoryRounds, type AnnotationExecutionSnapshot } from "./annotation-execution"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"

type AnnotationPanelProps = {
  novelID: Accessor<string>
  chapterID: Accessor<string | null>
  onExecute?: (args: { prompt: string; roundID: string }) => Promise<string | null | undefined> | string | null | undefined
  onSessionFocused?: (sessionID: string | null | undefined) => void
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

type Annotation = {
  readonly id: string
  readonly status: string
  readonly source: "user" | "ai"
  readonly paragraphIndex?: number | null | undefined
  readonly startOffset?: number | null | undefined
  readonly endOffset?: number | null | undefined
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null | undefined
  readonly executionRoundId?: string | null | undefined
}

export function AnnotationPanel(props: AnnotationPanelProps) {
  const language = useLanguage()
  const annotations = useAnnotations(
    props.novelID,
    createMemo(() => props.chapterID() ?? ""),
  )
  const boundSessions = useBoundNovelSessions(props.novelID)
  const chapter = useChapterDetail(props.novelID, createMemo(() => props.chapterID() ?? ""))
  const sync = useSync()
  const rounds = useExecutionRounds(
    props.novelID,
    createMemo(() => props.chapterID() ?? ""),
  )
  const updateAnnotation = useUpdateAnnotation()
  const deleteAnnotation = useDeleteAnnotation()
  const createExecutionRound = useCreateExecutionRound()
  const updateExecutionRound = useUpdateExecutionRound()
  const [tab, setTab] = createSignal<"current" | "history">("current")
  const [isExecuting, setIsExecuting] = createSignal(false)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editComment, setEditComment] = createSignal("")
  const [editReplacement, setEditReplacement] = createSignal("")

  const activeAnnotations = createMemo(() => (annotations.data ?? []).filter((ann) => !ann.executionRoundId))
  const openCount = createMemo(() => activeAnnotations().filter((a) => a.status === "open").length)
  const sessionBusy = createMemo(() =>
    (boundSessions.data ?? []).some((session) => sync().data.session_working(session.sessionID)),
  )
  const canExecute = createMemo(
    () => !isExecuting() && !sessionBusy() && activeAnnotations().length > 0 && openCount() === 0,
  )

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

  async function execute() {
    const chapterID = props.chapterID()
    if (!chapterID || !canExecute()) return
    setIsExecuting(true)
    try {
      const paragraphs = (chapter.data?.content ?? "").split(/\n\n+/).filter(Boolean)
      const sessionID = await executeAnnotationExecution(
        {
          chapterID,
          chapterTitle: chapter.data?.title,
          paragraphs,
          annotations: activeAnnotations(),
        },
        {
          createRound: ({ promptSnapshot, annotationsSnapshot }) =>
            createExecutionRound.mutateAsync({
              novelID: props.novelID(),
              chapterID,
              promptSnapshot,
              annotationsSnapshot,
            }),
          sendPrompt: async ({ prompt, roundID }) => await props.onExecute?.({ prompt, roundID }),
          associateAnnotations: ({ roundID, annotations }) =>
            Promise.all(
              annotations.map((ann) =>
                updateAnnotation.mutateAsync({
                  novelID: props.novelID(),
                  annotationID: ann.id,
                  chapterID,
                  executionRoundId: roundID,
                }),
              ),
            ).then(() => undefined),
          completeRound: ({ roundID, resultSummary }) =>
            updateExecutionRound.mutateAsync({
              novelID: props.novelID(),
              chapterID,
              roundID,
              status: "completed",
              resultSummary,
            }).then(() => undefined),
          failRound: ({ roundID, resultSummary }) =>
            updateExecutionRound.mutateAsync({
              novelID: props.novelID(),
              chapterID,
              roundID,
              status: "failed",
              resultSummary,
            }).then(() => undefined),
        },
      )
      props.onSessionFocused?.(sessionID)
    } catch (error) {
      console.error("annotation execution failed", error)
    } finally {
      setIsExecuting(false)
    }
  }

  function reactivate(ids: readonly string[]) {
    const chapterID = props.chapterID()
    if (!chapterID || ids.length === 0) return
    for (const id of ids) {
      updateAnnotation.mutate({ novelID: props.novelID(), annotationID: id, chapterID, status: "open", executionRoundId: null })
    }
  }

  function startEdit(ann: Annotation) {
    setEditingId(ann.id)
    setEditComment(ann.comment)
    setEditReplacement(ann.suggestedReplacement ?? "")
  }

  function saveEdit() {
    const id = editingId()
    if (!id || !editComment().trim()) return
    updateAnnotation.mutate({
      novelID: props.novelID(),
      annotationID: id,
      chapterID: props.chapterID() ?? "",
      comment: editComment().trim(),
      suggestedReplacement: editReplacement().trim() || undefined,
    })
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex items-center justify-between p-4 pb-2 shrink-0">
        <h3 class="text-sm font-semibold text-v2-text-text-base">{language.t("novel.panel.annotations")}</h3>
        <div class="flex gap-1">
          <TabButton active={tab() === "current"} onClick={() => setTab("current")}>
            {language.t("novel.annotations.tab.current")}
          </TabButton>
          <TabButton active={tab() === "history"} onClick={() => setTab("history")}>
            {language.t("novel.annotations.tab.history")}
          </TabButton>
        </div>
      </div>

      <Show when={tab() === "current"}>
        <CurrentTab
          props={props}
          annotations={annotations}
          activeAnnotations={activeAnnotations}
          executing={isExecuting() || sessionBusy()}
          setStatus={setStatus}
          remove={remove}
          canExecute={canExecute}
          execute={execute}
          editingId={editingId}
          editComment={editComment}
          editReplacement={editReplacement}
          setEditComment={setEditComment}
          setEditReplacement={setEditReplacement}
          startEdit={startEdit}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
        />
      </Show>

      <Show when={tab() === "history"}>
        <HistoryTab rounds={rounds} reactivate={reactivate} />
      </Show>
    </div>
  )
}

function CurrentTab(props: {
  props: AnnotationPanelProps
  annotations: { data: readonly Annotation[] | undefined; isLoading: boolean }
  activeAnnotations: Accessor<readonly Annotation[]>
  executing: boolean
  setStatus: (id: string, status: "open" | "resolved" | "wontfix" | "applied") => void
  remove: (id: string) => void
  canExecute: Accessor<boolean>
  execute: () => Promise<void>
  editingId: Accessor<string | null>
  editComment: Accessor<string>
  editReplacement: Accessor<string>
  setEditComment: (v: string) => void
  setEditReplacement: (v: string) => void
  startEdit: (ann: Annotation) => void
  saveEdit: () => void
  cancelEdit: () => void
}) {
  const language = useLanguage()

  return (
    <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
      <div class="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 pt-2 pb-4">
        <Show when={props.annotations.isLoading}>
          <Spinner />
        </Show>

        <Show when={!props.annotations.isLoading && props.activeAnnotations().length === 0}>
          <p class="text-v2-text-text-faint py-4 text-center text-xs">{language.t("novel.annotations.empty")}</p>
        </Show>

        <For each={props.activeAnnotations()}>
          {(ann) => (
            <AnnotationCard
              ann={ann}
              setStatus={props.setStatus}
              remove={props.remove}
              editingId={props.editingId}
              editComment={props.editComment}
              editReplacement={props.editReplacement}
              setEditComment={props.setEditComment}
              setEditReplacement={props.setEditReplacement}
              startEdit={props.startEdit}
              saveEdit={props.saveEdit}
              cancelEdit={props.cancelEdit}
            />
          )}
        </For>
      </div>

      <div class="border-t border-v2-border-border-muted bg-v2-background-bg-base px-4 pt-3 pb-4">
        <p class="text-v2-text-text-faint text-center text-xs">
          {props.executing
            ? language.t("novel.workspace.writingInProgress")
            : props.canExecute()
              ? language.t("novel.annotations.execute.hint")
              : language.t("novel.annotations.execute.pending")}
        </p>
        <div class="mt-2 flex justify-center">
          <button
            type="button"
            disabled={!props.canExecute()}
            onClick={() => void props.execute()}
            class="flex items-center justify-center font-medium transition-opacity"
            style={{
              height: "32px",
              "min-width": "96px",
              padding: "0 16px",
              "border-radius": "6px",
              "font-size": "13px",
              "line-height": "20px",
              "background-color": props.executing || props.canExecute() ? "#2563eb" : "#3f3f46",
              color: props.executing || props.canExecute() ? "#ffffff" : "#a1a1aa",
              opacity: props.executing ? "0.7" : props.canExecute() ? "1" : "0.6",
              cursor: props.executing ? "progress" : props.canExecute() ? "pointer" : "not-allowed",
            }}
          >
            {props.executing ? language.t("novel.workspace.writingInProgress") : language.t("novel.annotations.execute") || "执行"}
          </button>
        </div>
      </div>
    </div>
  )
}

function AnnotationCard(props: {
  ann: Annotation
  setStatus: (id: string, status: "open" | "resolved" | "wontfix" | "applied") => void
  remove: (id: string) => void
  editingId: Accessor<string | null>
  editComment: Accessor<string>
  editReplacement: Accessor<string>
  setEditComment: (v: string) => void
  setEditReplacement: (v: string) => void
  startEdit: (ann: Annotation) => void
  saveEdit: () => void
  cancelEdit: () => void
}) {
  const language = useLanguage()
  const ann = props.ann
  const isEditing = createMemo(() => props.editingId() === ann.id)

  return (
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

<Show when={!isEditing()} fallback={
        <div class="flex flex-col gap-1.5">
          <textarea
            class="w-full rounded border border-v2-border-border-base bg-v2-background-bg-base p-2 text-xs text-v2-text-text-base resize-none"
            rows={3}
            value={props.editComment()}
            onInput={(e) => props.setEditComment(e.currentTarget.value)}
          />
          <input
            class="w-full rounded border border-v2-border-border-base bg-v2-background-bg-base p-2 text-xs text-v2-text-text-base"
            placeholder={language.t("novel.annotations.editSuggestion")}
            value={props.editReplacement()}
            onInput={(e) => props.setEditReplacement(e.currentTarget.value)}
          />
          <div class="flex gap-1 justify-end">
            <ButtonV2 size="small" variant="ghost" onClick={props.cancelEdit}>
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2 size="small" variant="contrast" disabled={!props.editComment().trim()} onClick={props.saveEdit}>
              {language.t("novel.annotations.save")}
            </ButtonV2>
          </div>
        </div>
      }>
        <p class="text-xs text-v2-text-text-base">{ann.comment}</p>
        <Show when={ann.suggestedReplacement}>
          <div class="rounded bg-v2-background-bg-layer-01 p-1.5 text-xs text-v2-text-text-muted">
            <span class="text-v2-text-text-faint">{language.t("novel.annotations.suggestion")} </span>
            {ann.suggestedReplacement}
          </div>
        </Show>
      </Show>

      <Show when={ann.status === "open" && !isEditing()}>
        <div class="flex gap-1 mt-1">
          <Show when={ann.suggestedReplacement}>
            <ButtonV2 size="small" variant="contrast" title={language.t("novel.annotations.adopt.hint")} onClick={() => props.setStatus(ann.id, "applied")}>
              {language.t("novel.annotations.apply")}
            </ButtonV2>
          </Show>
          <ButtonV2 size="small" variant="outline" onClick={() => props.setStatus(ann.id, "resolved")}>
            {language.t("novel.annotations.resolve")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.startEdit(ann)}>
            {language.t("novel.annotations.edit")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(ann.id, "wontfix")}>
            {language.t("novel.annotations.dismiss")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.remove(ann.id)}>
            {language.t("common.delete")}
          </ButtonV2>
        </div>
      </Show>

      <Show when={ann.status !== "open" && !isEditing()}>
        <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(ann.id, "open")}>
          {language.t("novel.annotations.reopen")}
        </ButtonV2>
      </Show>
    </div>
  )
}

function HistoryTab(props: {
  rounds: {
    data:
      | ReadonlyArray<{
          readonly id: string
          readonly promptSnapshot: string
          readonly status: string
          readonly annotationsSnapshot: readonly AnnotationExecutionSnapshot[]
          readonly resultSummary: string
          readonly createdAt: number
        }>
      | undefined
    isLoading: boolean
  }
  reactivate: (ids: readonly string[]) => void
}) {
  const language = useLanguage()
  const roundList = createMemo(() => props.rounds.data ?? [])
  const historyGroups = createMemo(() => groupHistoryRounds(roundList()))

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4 pt-2">
      <Show when={props.rounds.isLoading}>
        <Spinner />
      </Show>

      <Show when={!props.rounds.isLoading && historyGroups().length === 0}>
        <p class="text-v2-text-text-faint py-4 text-center text-xs">{language.t("novel.annotations.history.empty")}</p>
      </Show>

      <For each={historyGroups()}>
        {(group) => (
          <div class="rounded border border-v2-border-border-base p-2 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-v2-text-text-base text-xs font-semibold">{language.t("novel.annotations.history.round")}</span>
              <span class="text-v2-text-text-faint text-xs">{new Date(group.createdAt).toLocaleString()}</span>
            </div>
            <Show when={group.resultSummary}>
              <div class="flex items-center gap-2">
                <span class="text-v2-text-text-faint text-xs">{group.resultSummary}</span>
              </div>
            </Show>
            <p class="text-v2-text-text-faint line-clamp-2 text-xs whitespace-pre-wrap">{group.promptSnapshot}</p>
            <div class="flex justify-end">
              <ButtonV2 size="small" variant="ghost" onClick={() => props.reactivate(group.annotations.map((ann) => ann.id))}>
                {language.t("novel.annotations.reactivate")}
              </ButtonV2>
            </div>

            <For each={group.annotations}>
              {(ann) => (
                <div class="rounded bg-v2-background-bg-layer-01 p-2 flex flex-col gap-1">
                  <div class="flex items-center justify-between">
                    <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>
                      {enumLabel(language, "novel.annotations.status", ann.status)}
                    </span>
                    <Show when={ann.paragraphIndex != null}>
                      <span class="text-v2-text-text-faint text-xs">P{ann.paragraphIndex! + 1}</span>
                    </Show>
                  </div>
                  <p class="text-v2-text-text-base text-xs">{ann.comment}</p>
                  <Show when={ann.quote}>
                    <p class="text-v2-text-text-faint line-clamp-2 text-xs">{ann.quote}</p>
                  </Show>
                  <div class="flex justify-end">
                    <ButtonV2 size="small" variant="ghost" onClick={() => props.reactivate([ann.id])}>
                      {language.t("novel.annotations.reactivate")}
                    </ButtonV2>
                  </div>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      class={`text-xs px-2 py-0.5 rounded transition-colors ${
        props.active
          ? "bg-v2-background-bg-layer-01 text-v2-text-text-base font-semibold"
          : "text-v2-text-text-faint hover:text-v2-text-text-base"
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
