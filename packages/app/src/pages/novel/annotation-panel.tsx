import { annotationParagraphRangeLabel } from "./annotation-utils"
import { Accessor, createMemo, createSignal, For, Show } from "solid-js"
import {
  useAnnotations,
  useBoundNovelSessions,
  useChapterDetail,
  useUpdateAnnotation,
  useDeleteAnnotation,
  useAnnotationRounds,
  useCreateAnnotationRound,
  useUpdateAnnotationRound,
} from "@/context/novel-queries"
import { executeAnnotationExecution, groupHistoryRounds, type AnnotationExecutionSnapshot } from "./annotation-execution"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { isAnySessionWorking } from "@/context/novel-approval"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opennovel-ai/ui/v2/textarea-v2"

type AnnotationPanelProps = {
  novelID: Accessor<string>
  targetType: "chapter" | "world_entry"
  targetID: Accessor<string | null>
  targetTitle?: Accessor<string>
  content?: Accessor<string>
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

const statusLabel: Record<string, string> = {
  open: "待处理",
  resolved: "已解决",
  wontfix: "不处理",
  applied: "已采纳",
}

type Annotation = {
  readonly id: string
  readonly status: string
  readonly source: "user" | "ai"
  readonly paragraphIndex?: number | null | undefined
  readonly startOffset?: number | null | undefined
  readonly endOffset?: number | null | undefined
  readonly endParagraphIndex?: number | null | undefined
  readonly quote: string
  readonly comment: string
  readonly suggestedReplacement?: string | null | undefined
  readonly executionRoundId?: string | null | undefined
}

export function AnnotationPanel(props: AnnotationPanelProps) {
  const language = useLanguage()
  const targetId = createMemo(() => props.targetID() ?? "")
  const targetType = () => props.targetType
  const annotations = useAnnotations(props.novelID, targetType, targetId)
  const boundSessions = useBoundNovelSessions(props.novelID)
  const chapter = useChapterDetail(
    props.novelID,
    createMemo(() => (props.targetType === "chapter" ? targetId() : "")),
  )
  const sync = useSync()
  const rounds = useAnnotationRounds(props.novelID, targetType, targetId)
  const updateAnnotation = useUpdateAnnotation()
  const deleteAnnotation = useDeleteAnnotation()
  const createRound = useCreateAnnotationRound()
  const updateRound = useUpdateAnnotationRound()
  const [tab, setTab] = createSignal<"current" | "history">("current")
  const [isExecuting, setIsExecuting] = createSignal(false)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editComment, setEditComment] = createSignal("")
  const [editReplacement, setEditReplacement] = createSignal("")

  const activeAnnotations = createMemo(() => (annotations.data ?? []).filter((ann) => !ann.executionRoundId))
  const openCount = createMemo(() => activeAnnotations().filter((a) => a.status === "open").length)
  const sessionBusy = createMemo(() =>
    isAnySessionWorking(
      (boundSessions.data ?? []).map((session) => session.sessionID),
      (sessionID) => sync().data.session_working(sessionID),
    ),
  )
  const canExecute = createMemo(
    () => !isExecuting() && !sessionBusy() && activeAnnotations().length > 0 && openCount() === 0,
  )

  function targetRef() {
    return { targetType: props.targetType, targetId: targetId() }
  }

  function setStatus(id: string, status: "open" | "resolved" | "wontfix" | "applied") {
    if (!targetId()) return
    updateAnnotation.mutate({ novelID: props.novelID(), annotationID: id, ...targetRef(), status })
  }

  function remove(id: string) {
    if (!targetId()) return
    deleteAnnotation.mutate({ novelID: props.novelID(), annotationID: id, ...targetRef() })
  }

  function reactivate(ids: readonly string[]) {
    if (!targetId() || ids.length === 0) return
    for (const id of ids) {
      updateAnnotation.mutate({ novelID: props.novelID(), annotationID: id, ...targetRef(), status: "open", executionRoundId: null })
    }
  }

  async function execute() {
    if (!targetId() || !canExecute()) return
    setIsExecuting(true)
    try {
      // 与对应阅读器一致的分段规则：正文按空行、设定按单行
      const paragraphs =
        props.targetType === "chapter"
          ? (chapter.data?.content ?? "").split(/\n\n+/).filter(Boolean)
          : (props.content?.() ?? "").split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
      const sessionID = await executeAnnotationExecution(
        {
          targetType: props.targetType,
          targetID: targetId(),
          targetTitle: props.targetType === "chapter" ? chapter.data?.title : props.targetTitle?.(),
          paragraphs,
          annotations: activeAnnotations(),
        },
        {
          createRound: ({ promptSnapshot, annotationsSnapshot }) =>
            createRound.mutateAsync({
              novelID: props.novelID(),
              ...targetRef(),
              promptSnapshot,
              annotationsSnapshot,
            }),
          updateRoundPrompt: ({ roundID, promptSnapshot }) =>
            updateRound.mutateAsync({
              novelID: props.novelID(),
              ...targetRef(),
              roundID,
              promptSnapshot,
            }).then(() => undefined),
          sendPrompt: async ({ prompt, roundID }) => await props.onExecute?.({ prompt, roundID }),
          associateAnnotations: ({ roundID, annotations: linked }) =>
            Promise.all(
              linked.map((ann) =>
                updateAnnotation.mutateAsync({
                  novelID: props.novelID(),
                  annotationID: ann.id,
                  ...targetRef(),
                  executionRoundId: roundID,
                }),
              ),
            ).then(() => undefined),
          failRound: ({ roundID, resultSummary }) =>
            updateRound.mutateAsync({
              novelID: props.novelID(),
              ...targetRef(),
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
      ...targetRef(),
      comment: editComment().trim(),
      suggestedReplacement: editReplacement().trim() || undefined,
    })
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  return (
    <Show
      when={props.targetType === "chapter"}
      fallback={
        <div class="flex h-full min-h-0 flex-col border-t border-v2-border-border-base">
          <div class="flex items-center justify-between px-4 py-2">
            <h3 class="text-sm font-semibold text-v2-text-text-base">设定批注</h3>
            <div class="flex gap-1">
              <button
                class={`rounded px-2 py-0.5 text-xs ${tab() === "current" ? "bg-v2-background-bg-layer-01 font-semibold" : "text-v2-text-text-muted"}`}
                onClick={() => setTab("current")}
              >
                当前
              </button>
              <button
                class={`rounded px-2 py-0.5 text-xs ${tab() === "history" ? "bg-v2-background-bg-layer-01 font-semibold" : "text-v2-text-text-muted"}`}
                onClick={() => setTab("history")}
              >
                历史
              </button>
            </div>
          </div>

          <Show when={tab() === "current"}>
            <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
              <Show when={annotations.isLoading}>
                <Spinner />
              </Show>
              <Show when={!annotations.isLoading && activeAnnotations().length === 0}>
                <p class="py-3 text-center text-xs text-v2-text-text-faint">选中设定文字可创建批注。</p>
              </Show>
              <For each={activeAnnotations()}>
                {(ann) => (
                  <div class="rounded border border-v2-border-border-base p-2">
                    <div class="flex items-center justify-between">
                      <span class={`text-xs font-medium ${statusColor[ann.status] ?? ""}`}>{statusLabel[ann.status] ?? ann.status}</span>
                      <Show when={ann.paragraphIndex != null}>
                        <span class="text-xs text-v2-text-text-faint">第 {annotationParagraphRangeLabel(ann)} 段</span>
                      </Show>
                    </div>
                    <p class="mt-1 text-xs text-v2-text-text-base">{ann.comment}</p>
                    <Show when={ann.quote}>
                      <p class="mt-1 line-clamp-2 text-xs text-v2-text-text-faint">{ann.quote}</p>
                    </Show>
                    <Show when={ann.suggestedReplacement}>
                      <p class="mt-1 line-clamp-2 text-xs text-v2-text-text-muted">建议：{ann.suggestedReplacement}</p>
                    </Show>
                    <div class="mt-2 flex flex-wrap justify-end gap-1">
                      <Show when={ann.status === "open"}>
                        <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "resolved")}>已解决</ButtonV2>
                        <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "applied")}>采纳</ButtonV2>
                        <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "wontfix")}>不处理</ButtonV2>
                      </Show>
                      <Show when={ann.status !== "open"}>
                        <ButtonV2 size="small" variant="ghost" onClick={() => setStatus(ann.id, "open")}>重新打开</ButtonV2>
                      </Show>
                      <ButtonV2 size="small" variant="ghost" onClick={() => remove(ann.id)}>删除</ButtonV2>
                    </div>
                  </div>
                )}
              </For>
              <ButtonV2 class="mt-2" size="small" variant="contrast" onClick={() => void execute()} disabled={!canExecute()}>
                {isExecuting() || sessionBusy() ? "执行中..." : "执行批注"}
              </ButtonV2>
            </div>
          </Show>

          <Show when={tab() === "history"}>
            <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
              <Show when={rounds.isLoading}>
                <Spinner />
              </Show>
              <Show when={!rounds.isLoading && (rounds.data ?? []).length === 0}>
                <p class="py-3 text-center text-xs text-v2-text-text-faint">还没有执行历史。</p>
              </Show>
              <For each={rounds.data ?? []}>
                {(round) => (
                  <div class="rounded border border-v2-border-border-base p-2">
                    <div class="flex items-center justify-between">
                      <span class={`text-xs font-medium ${
                        round.status === "completed"
                          ? "text-v2-state-fg-success"
                          : round.status === "failed" || round.status === "interrupted"
                            ? "text-v2-state-fg-warning"
                            : "text-v2-state-fg-info"
                      }`}>
                        {round.status === "completed" ? "已完成" : round.status === "failed" ? "执行失败" : round.status === "interrupted" ? "已中断" : "执行中"}
                      </span>
                      <span class="text-xs text-v2-text-text-faint">{new Date(round.createdAt).toLocaleString()}</span>
                    </div>
                    <p class="mt-1 text-xs text-v2-text-text-base">{round.resultSummary || "等待 AI 回填结果。"}</p>
                    <p class="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-v2-text-text-faint">{round.promptSnapshot}</p>
                    <div class="mt-2 flex justify-end">
                      <ButtonV2 size="small" variant="ghost" onClick={() => reactivate(round.annotationsSnapshot.map((ann) => ann.id))}>
                        重新激活
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      }
    >
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
          <HistoryTab rounds={rounds} targetType={props.targetType} reactivate={reactivate} />
        </Show>
      </div>
    </Show>
  )
}

export function AnnotationCreateForm(props: {
  quote: Accessor<string>
  comment: Accessor<string>
  replacement: Accessor<string>
  pending: boolean
  onComment: (value: string) => void
  onReplacement: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div class="rounded border border-v2-border-border-base p-3">
      <p class="line-clamp-2 text-xs text-v2-text-text-faint">{props.quote()}</p>
      <TextareaV2
        class="mt-2"
        rows={3}
        fluid
        value={props.comment()}
        onInput={(event) => props.onComment(event.currentTarget.value)}
        placeholder="批注意见"
      />
      <TextInputV2
        class="mt-2"
        fluid
        value={props.replacement()}
        onInput={(event) => props.onReplacement(event.currentTarget.value)}
        placeholder="可选替换建议（纯文本）"
      />
      <div class="mt-2 flex justify-end gap-2">
        <ButtonV2 size="small" variant="ghost-muted" onClick={props.onCancel}>取消</ButtonV2>
        <ButtonV2 size="small" variant="contrast" onClick={props.onSubmit} disabled={props.pending || !props.comment().trim()}>
          保存批注
        </ButtonV2>
      </div>
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
  const isEditing = () => props.editingId() === props.ann.id

  return (
    <div class="rounded border border-v2-border-border-base p-2 flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class={`text-xs font-medium ${statusColor[props.ann.status] ?? ""}`}>
          {enumLabel(language, "novel.annotations.status", props.ann.status)}
        </span>
        <Show when={props.ann.paragraphIndex != null}>
          <span class="text-v2-text-text-faint text-xs">P{annotationParagraphRangeLabel(props.ann)}</span>
        </Show>
      </div>

      <Show
        when={isEditing()}
        fallback={
          <>
            <p class="text-v2-text-text-base text-xs">{props.ann.comment}</p>
            <Show when={props.ann.quote}>
              <p class="text-v2-text-text-faint line-clamp-2 text-xs">{props.ann.quote}</p>
            </Show>
            <Show when={props.ann.suggestedReplacement}>
              <p class="text-v2-text-text-muted line-clamp-2 text-xs">
                {language.t("novel.annotations.suggestion")}: {props.ann.suggestedReplacement}
              </p>
            </Show>
          </>
        }
      >
        <textarea
          class="bg-v2-background-bg-layer-01 text-v2-text-text-base rounded p-1 text-xs w-full"
          rows={2}
          value={props.editComment()}
          onInput={(event) => props.setEditComment(event.currentTarget.value)}
        />
        <input
          class="bg-v2-background-bg-layer-01 text-v2-text-text-base rounded p-1 text-xs w-full"
          value={props.editReplacement()}
          onInput={(event) => props.setEditReplacement(event.currentTarget.value)}
          placeholder={language.t("novel.annotations.suggestionPlaceholder")}
        />
      </Show>

      <div class="flex flex-wrap justify-end gap-1">
        <Show when={!isEditing()}>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.startEdit(props.ann)}>
            {language.t("novel.annotations.edit")}
          </ButtonV2>
        </Show>
        <Show when={isEditing()}>
          <ButtonV2 size="small" variant="ghost" onClick={props.saveEdit}>
            {language.t("novel.annotations.save")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={props.cancelEdit}>
            {language.t("novel.annotations.cancel")}
          </ButtonV2>
        </Show>
        <Show when={props.ann.status === "open"}>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(props.ann.id, "resolved")}>
            {language.t("novel.annotations.resolve")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(props.ann.id, "applied")}>
            {language.t("novel.annotations.apply")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(props.ann.id, "wontfix")}>
            {language.t("novel.annotations.wontfix")}
          </ButtonV2>
        </Show>
        <Show when={props.ann.status !== "open" && !isEditing()}>
          <ButtonV2 size="small" variant="ghost" onClick={() => props.setStatus(props.ann.id, "open")}>
            {language.t("novel.annotations.reopen")}
          </ButtonV2>
        </Show>
      </div>
    </div>
  )
}

function HistoryTab(props: {
  targetType: "chapter" | "world_entry"
  rounds: {
    data:
      | ReadonlyArray<{
          readonly id: string
          readonly promptSnapshot: string
          readonly status: string
          readonly annotationsSnapshot: readonly AnnotationExecutionSnapshot[]
          readonly resultSummary: string
          readonly resultRefId?: string | null | undefined
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
            <div class="flex flex-wrap items-center gap-2">
              <span class={`text-xs font-medium ${
                group.status === "completed"
                  ? "text-v2-state-fg-success"
                  : group.status === "failed" || group.status === "interrupted"
                    ? "text-v2-state-fg-warning"
                    : "text-v2-state-fg-info"
              }`}>
                {group.status === "completed"
                  ? "已完成"
                  : group.status === "failed"
                    ? "执行失败"
                    : group.status === "interrupted"
                      ? "已中断"
                      : "执行中"}
              </span>
              <Show when={group.resultRefId}>
                <span class="text-v2-text-text-faint text-xs">
                  {props.targetType === "chapter" ? "章节版本" : "结果引用"} {group.resultRefId}
                </span>
              </Show>
            </div>
            <p class="text-v2-text-text-base text-xs">{group.resultSummary || "等待 AI 回填结果。"}</p>
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
                      <span class="text-v2-text-text-faint text-xs">P{annotationParagraphRangeLabel(ann)}</span>
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
